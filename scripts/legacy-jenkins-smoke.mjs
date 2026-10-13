import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { scenarioMatrix } from './seed-jenkins-legacy-demo.mjs';

if (!process.argv.includes('--run')) throw new Error('Use --run to execute the marked legacy demo jobs.');
const queueOnly=process.argv.includes('--queue-only');
const config=JSON.parse(await readFile('.local/jenkins-legacy/config.json','utf8'));
assert.equal(config.JENKINS_URL,'https://jenkins-legacy-drs-sg.zeabur.app/');
const authorization=`Basic ${Buffer.from(`${config.JENKINS_USER}:${config.JENKINS_API_TOKEN}`).toString('base64')}`;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const records=[];
async function branchSha(branch) {
  assert.ok(['master','develop'].includes(branch));
  const access=JSON.parse(await readFile('.local/jenkins-test/zeabur/gitea-access.json','utf8'));
  const url=`https://gitea-drs-sg.zeabur.app/api/v1/repos/${encodeURIComponent(access.user)}/demo-legacy-ci/branches/${branch}`;
  const r=await fetch(url,{headers:{Authorization:`Basic ${Buffer.from(`${access.user}:${access.password}`).toString('base64')}`},signal:AbortSignal.timeout(15000),redirect:'manual'});assert.ok(r.ok);
  const data=await r.json();return data.commit.id||data.commit.sha;
}
async function native(path, options={}) {
  const url=new URL(path,config.JENKINS_URL);assert.equal(url.origin,new URL(config.JENKINS_URL).origin);
  const r=await fetch(url,{...options,headers:{Authorization:authorization,...options.headers},redirect:'manual',signal:AbortSignal.timeout(30000)});
  assert.ok(r.ok,`Native request HTTP ${r.status}`);return r;
}
async function connect(root=config.JENKINS_URL) {
  const client=new Client({name:'jenkins-2.263.1-api-validation',version:'1.0.0'});
  await client.connect(new StdioClientTransport({command:process.execPath,args:[resolve('release/jenkins/dist/server.mjs')],env:{...process.env,...config,JENKINS_MODE:'api',JENKINS_URL:root,JENKINS_CONFIG_FILE:resolve('.local/jenkins-legacy/config.json')}}));return client;
}
async function call(client,name,args={}) {const r=await client.callTool({name,arguments:args});assert.ok(!r.isError,`${name} failed`);return r.structuredContent;}
async function build(client,job,parameters,expected,tag) {
  assert.ok(job.startsWith('legacy-demo-'));
  const item=await call(client,'getJob',{jobFullName:job});assert.ok(item.buildable);
  const queued=await call(client,'triggerBuild',{jobFullName:job,parameters});assert.ok(queued.scheduled);assert.ok(queued.queueId);
  let executable;const deadline=Date.now()+90000;
  while(Date.now()<deadline){const q=await call(client,'getQueueItem',{queueId:Number(queued.queueId)});if(q.executable){executable=q.executable;break;}await sleep(600);}
  assert.ok(executable,'Queued build did not become executable');
  let result;while(Date.now()<deadline){result=await call(client,'getBuild',{jobFullName:job,buildNumber:executable.number});if(!result.building)break;await sleep(600);}
  assert.equal(result?.building,false);assert.equal(result.result,expected);
  const log=await call(client,'getBuildLog',{jobFullName:job,buildNumber:result.number});assert.ok(log.log.includes('[legacy-demo]'));assert.ok(!log.log.includes(config.JENKINS_API_TOKEN));
  const path=job.split('/').map(x=>'job/'+encodeURIComponent(x)).join('/');
  const metadata=await(await native(`${path}/${result.number}/api/json?tree=actions[parameters[name,value],totalCount,failCount,skipCount],artifacts[fileName]`)).json();
  const actual=Object.fromEntries(metadata.actions.flatMap(x=>x.parameters||[]).map(x=>[x.name,x.value]));
  for(const [key,value]of Object.entries(parameters))assert.equal(actual[key],value,`${key} changed in Jenkins`);
  let selectedBranchSha;
  if(parameters.BRANCH){selectedBranchSha=await branchSha(parameters.BRANCH);assert.ok(log.log.includes(`[legacy-demo] checked out SHA: ${selectedBranchSha}`));assert.ok(log.log.includes(`[legacy-demo] selected branch: ${parameters.BRANCH}`));}
  records.push({tag,job,number:result.number,result:result.result,queueId:queued.queueId,queueUrl:queued.queueUrl,buildUrl:result.url,duration:result.duration,parametersMatched:true,selectedBranchSha,artifacts:metadata.artifacts.length,tests:metadata.actions.filter(x=>x.totalCount!==undefined).map(x=>({total:x.totalCount,failed:x.failCount,skipped:x.skipCount}))});
  await writeFile('.local/jenkins-legacy/api-smoke-progress.json',JSON.stringify(records,null,2)+'\n',{mode:0o600});
  console.log(`${tag}: ${job} #${result.number} ${result.result}, queue ${queued.queueId}`);
  return {result,log:log.log};
}
const root=await native('api/json?tree=jobs[name]');assert.equal(root.headers.get('x-jenkins'),'2.263.1');
const client=await connect();
try {
  const tools=(await client.listTools()).tools.map(x=>x.name);for(const n of ['getJobs','getJob','getBuild','getBuildLog','getQueueItem','triggerBuild'])assert.ok(tools.includes(n));
  const listed=await call(client,'getJobs');assert.ok(listed.jobs.length>=2);
  if(!queueOnly) {
  for(const [kind,scenario]of Object.entries(scenarioMatrix)){if(!scenario.history)continue;for(let i=0;i<scenario.history.length;i++){const params={...scenario.history[i]};if(kind==='declarative'&&i===0)params.DEMO_MESSAGE=scenario.parameterDefinitions.DEMO_MESSAGE;await build(client,scenario.job,params,scenario.expectedResults[i],kind);}}
  const canonical='http://legacy-canonical.example.invalid:8090/';
  async function setCanonical(url){const script=`jenkins.model.JenkinsLocationConfiguration.get().setUrl('${url}');println('LEGACY_URL_UPDATED')`;const response=await native('scriptText',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({script}).toString()});assert.ok((await response.text()).includes('LEGACY_URL_UPDATED'));}
  try {
    await setCanonical(canonical);
    const raw=await(await native('api/json?tree=jobs[url]')).json();assert.ok(raw.jobs.every(x=>x.url.startsWith(canonical)));
    const normalized=await call(client,'getJobs');assert.ok(normalized.jobs.every(x=>x.url.startsWith(config.JENKINS_URL)));
    await build(client,scenarioMatrix.declarative.job,scenarioMatrix.declarative.history[0],'SUCCESS','canonical-controller-url');
  } finally {await setCanonical(config.JENKINS_URL);}
  }
} finally {await client.close();}

// Controlled forwarding changes only response URLs. All real work runs on the
// new SG controller; no request is sent to the canonical example.invalid host.
let requests=0;
const relay=createServer(async(req,res)=>{try{
  if(!req.url.startsWith('/jenkins/')||req.url.startsWith('//')){res.writeHead(400);res.end();return;}
  const path=req.url.slice('/jenkins/'.length);const target=new URL(path,config.JENKINS_URL);assert.equal(target.origin,new URL(config.JENKINS_URL).origin);
  const chunks=[];for await(const chunk of req)chunks.push(chunk);requests++;
  const response=await fetch(target,{method:req.method,headers:{Authorization:authorization,...(req.headers['content-type']?{'Content-Type':req.headers['content-type']}:{})},body:req.method==='GET'||req.method==='HEAD'?undefined:Buffer.concat(chunks),redirect:'manual',signal:AbortSignal.timeout(30000)});
  const headers={'content-type':response.headers.get('content-type')||'text/plain'};
  const location=response.headers.get('location');if(location)headers.location='http://legacy-canonical.example.invalid:8090/jenkins'+new URL(location,config.JENKINS_URL).pathname;
  let body=await response.text();if(body&&headers['content-type'].includes('application/json')){const data=JSON.parse(body);const rewrite=v=>{if(Array.isArray(v))return v.map(rewrite);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,k==='url'&&typeof x==='string'?'http://legacy-canonical.example.invalid:8090/jenkins'+new URL(x,config.JENKINS_URL).pathname:rewrite(x)]));};body=JSON.stringify(rewrite(data));}
  res.writeHead(response.status,headers);res.end(body);
}catch{res.writeHead(502);res.end('Relay failed; sensitive details withheld');}});
await new Promise(r=>relay.listen(0,'127.0.0.1',r));
const relayRoot=`http://127.0.0.1:${relay.address().port}/jenkins/`;
let relayClient;try{relayClient=await connect(relayRoot);const result=await build(relayClient,scenarioMatrix.declarative.job,scenarioMatrix.declarative.history[3],'SUCCESS','controlled-cross-origin-queue-context');assert.ok(result.result.url.startsWith(relayRoot));const last=records.at(-1);assert.ok(last.queueUrl.startsWith(relayRoot));}finally{if(relayClient)await relayClient.close();await new Promise(r=>relay.close(r));}
await writeFile('.local/jenkins-legacy/api-smoke-results.json',JSON.stringify({recordedAt:new Date().toISOString(),core:'2.263.1',mode:'api',records,relayRequests:requests,canonicalRestored:true,relayClosed:true},null,2)+'\n',{mode:0o600});
console.log(`Verified ${records.length} real builds in API mode; controlled queue URL/context scenario passed.`);
