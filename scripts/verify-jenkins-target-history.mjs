import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const directory='.local/jenkins-target-fixtures';
const config=JSON.parse(await readFile('.local/jenkins-legacy/config.json','utf8'));
assert.equal(config.JENKINS_URL,'https://jenkins-legacy-drs-sg.zeabur.app/');
const originalProfile=JSON.parse(await readFile(`${directory}/baseline-profile.json`,'utf8'));
const currentProfile=await readFile(join(homedir(),'.config/jenkins-codex-plugin/config.json'));
const currentProfileSha=createHash('sha256').update(currentProfile).digest('hex');
assert.equal(currentProfileSha,originalProfile.sha256,'Default connection changed');
const parsedProfile=JSON.parse(currentProfile);
assert.equal(new URL(parsedProfile.JENKINS_URL).hostname,'jenkins-mcp-drs-sg.zeabur.app');
assert.equal(parsedProfile.JENKINS_MODE,'api');
const baseline=JSON.parse(await readFile(`${directory}/history-before.json`,'utf8'));
// Audit immutable old records only. New fixture records are allowed to grow.
const old=baseline.filter(r=>!r.job.startsWith('sg-target-'));
const encoded=Buffer.from(JSON.stringify(old)).toString('base64');
const encodedExpression=`[${encoded.match(/.{1,8000}/g).map(chunk=>`'${chunk}'`).join(',')}].join('')`;
const code=`import jenkins.model.Jenkins
import groovy.json.JsonOutput
import groovy.json.JsonSlurper
import java.security.MessageDigest
def j=Jenkins.instance
def baseline=new JsonSlurper().parseText(new String(Base64.decoder.decode(${encodedExpression}),'UTF-8'))
def hash={File f -> def d=MessageDigest.getInstance('SHA-256'); f.withInputStream {s-> byte[] b=new byte[65536]; int n; while((n=s.read(b))>0)d.update(b,0,n)}; d.digest().encodeHex().toString()}
def mismatches=[]; int checked=0
baseline.each{row-> def r=j.getItemByFullName(row.job)?.getBuildByNumber(row.number as int)
  if(!r){mismatches<<[job:row.job,number:row.number,issue:'missing build'];return}
  if(r.result?.toString()!=row.result)mismatches<<[job:row.job,number:row.number,issue:'changed result']
  row.files.each{f->def path=new File(r.rootDir,f.path); checked++; if(!path.isFile()||hash(path)!=f.sha256)mismatches<<[job:row.job,number:row.number,file:f.path,issue:'missing or changed file']}
}
def jobs=j.getAllItems(hudson.model.Job)
println JsonOutput.toJson([core:Jenkins.VERSION,oldBuilds:baseline.size(),checkedFiles:checked,mismatches:mismatches,
  current:[jobs:jobs.size(),builds:jobs.sum{it.builds.size()},artifacts:jobs.sum{job->job.builds.sum{it.artifacts.size()}?:0}],
  fixtures:jobs.findAll{it.fullName.startsWith('sg-target-')}.collect{job->[name:job.fullName,builds:job.builds.collect{[number:it.number,result:it.result?.toString(),building:it.building]}]},
  queue:j.queue.items.collect{[id:it.id,task:it.task.name]},running:jobs.collectMany{job->job.builds.findAll{it.building}.collect{[job:job.fullName,number:it.number]}},
  authorization:j.authorizationStrategy.class.name,executors:j.numExecutors])`;
const response=await fetch(new URL('scriptText',config.JENKINS_URL),{method:'POST',headers:{Authorization:`Basic ${Buffer.from(`${config.JENKINS_USER}:${config.JENKINS_API_TOKEN}`).toString('base64')}`,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({script:code}),redirect:'manual',signal:AbortSignal.timeout(60000)});
assert.ok(response.ok,`SG audit HTTP ${response.status}`);
const raw=await response.text();
let report;
try{report=JSON.parse(raw);}catch{
  await writeFile(`${directory}/history-audit-diagnostic.txt`,raw,{mode:0o600});
  throw Error('SG history audit failed; diagnostic saved privately');
}
assert.equal(report.core,'2.263.1');
report.defaultProfileUnchanged=true;
report.recordedAt=new Date().toISOString();
await writeFile(`${directory}/history-verification.json`,JSON.stringify(report,null,2)+'\n',{mode:0o600});
assert.equal(report.mismatches.length,0,'Old history changed; inspect private report');
console.log(JSON.stringify(report));
