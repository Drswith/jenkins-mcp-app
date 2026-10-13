import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const directory=resolve('.local/jenkins-api-mode');
await mkdir(directory,{recursive:true,mode:0o700});
const report={recordedAt:new Date().toISOString(),mode:'api',readOnly:true,profiles:[]};
const builds=[['sg-target-parameter-pipeline',8,'SUCCESS'],['sg-target-parameter-pipeline',9,'UNSTABLE'],['sg-target-parameter-pipeline',10,'FAILURE'],['sg-target-parameter-pipeline',11,'ABORTED'],['sg-target-parameter-pipeline',12,'SUCCESS'],['sg-target-boolean-pipeline',1,'SUCCESS'],['sg-target-boolean-pipeline',2,'SUCCESS']];
const previousQueue=JSON.parse(await readFile('.local/jenkins-target-fixtures/queue-verification.json','utf8'));
for(const profile of ['.local/jenkins-legacy/config.json','.local/jenkins-target-fixtures/reader.json']){
  const values=JSON.parse(await readFile(profile,'utf8'));
  assert.equal(values.JENKINS_URL,'https://jenkins-legacy-drs-sg.zeabur.app/');
  assert.equal(values.JENKINS_MODE,'api');
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('JENKINS_')));
  env.JENKINS_CONFIG_FILE=resolve(profile);
  const client=new Client({name:'sg-api-mode-verification',version:'1.0.0'});
  const summary={role:profile.includes('reader.json')?'reader':'admin',parameters:[],builds:[],queues:[]};
  const call=async(name,args={})=>{assert.ok(!['triggerBuild'].includes(name));const r=await client.callTool({name,arguments:args});assert.ok(!r.isError,`${name}: ${r.content?.[0]?.text}`);return r.structuredContent;};
  try{
    await client.connect(new StdioClientTransport({command:process.execPath,args:[resolve('release/jenkins/dist/server.mjs')],env}));
    const tools=(await client.listTools()).tools;
    for(const name of ['getJobParameters','getGitParameterChoices','uiGetJobParameters','uiGetGitParameterChoices','uiTrackQueue'])assert.equal(tools.find(t=>t.name===name)?.annotations.readOnlyHint,true);
    for(const jobFullName of ['sg-target-parameter-pipeline','sg-target-boolean-pipeline']){
      const definitions=await call('getJobParameters',{jobFullName});
      assert.equal(definitions.parameters.find(p=>p.name==='BRANCH').gitType,'PT_BRANCH');
      assert.equal(definitions.parameters.filter(p=>p.type==='choice').length,jobFullName.includes('boolean')?1:2);
      if(jobFullName.includes('boolean'))assert.equal(definitions.parameters.find(p=>p.name==='RUN_EXTRA_CHECKS').defaultValue,true);
      const branches=await call('getGitParameterChoices',{jobFullName,parameterName:'BRANCH'});
      assert.deepEqual(branches.choices.map(c=>c.value).sort(),['develop','master']);
      assert.deepEqual(branches.errors,[]);assert.equal(branches.truncated,false);
      assert.deepEqual(await call('uiGetJobParameters',{jobFullName}),definitions);
      assert.deepEqual(await call('uiGetGitParameterChoices',{jobFullName,parameterName:'BRANCH'}),branches);
      summary.parameters.push({job:jobFullName,types:definitions.parameters.map(p=>p.type),branches:branches.choices.map(c=>c.value)});
    }
    for(const [jobFullName,buildNumber,result] of builds){
      const build=await call('getBuild',{jobFullName,buildNumber});assert.equal(build.result,result);
      assert.ok(build.url.startsWith(values.JENKINS_URL));
      const stage=await call('uiGetBuildStages',{jobFullName,buildNumber});assert.equal(stage.available,true);assert.equal(stage.stages.length,7);
      if(buildNumber===9&&jobFullName.includes('parameter'))assert.ok(stage.stages.some(s=>s.status==='UNSTABLE'));
      if(buildNumber===10&&jobFullName.includes('parameter'))assert.ok(stage.stages.some(s=>s.status==='FAILED'));
      if(buildNumber===11&&jobFullName.includes('parameter'))assert.ok(stage.stages.some(s=>s.status==='ABORTED'));
      summary.builds.push({job:jobFullName,number:buildNumber,result,stages:stage.stages});
    }
    for(const run of previousQueue.completed){
      const queue=await call('uiTrackQueue',{jobFullName:previousQueue.job,queueId:run.queueId});
      assert.equal(queue.view,'card');assert.equal(queue.build.number,run.number);assert.equal(queue.build.queueId,run.queueId);
      summary.queues.push({queueId:run.queueId,matchedBuild:queue.build.number});
    }
    const cancelled=await call('uiTrackQueue',{jobFullName:previousQueue.job,queueId:previousQueue.cancellation.queueId});
    assert.equal(cancelled.view,'queue');assert.ok(cancelled.queue.cancelled||cancelled.queue.expired);assert.ok(!cancelled.build);
    summary.queues.push({queueId:previousQueue.cancellation.queueId,cancelledOrExpired:true});
    assert.equal((await call('getJobParameters',{jobFullName:'sg-target-queue-label'})).parameters.length,0);
    report.profiles.push(summary);
  }finally{await client.close();}
}
await writeFile(resolve(directory,'api-mode-verification.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({profiles:report.profiles.map(p=>({role:p.role,parameterJobs:p.parameters.length,builds:p.builds.length,queues:p.queues})),readOnly:true}));
