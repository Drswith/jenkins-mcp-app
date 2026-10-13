import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Explicit SG profile: never change the installed plugin's default connection.
const configPath = resolve('.local/jenkins-legacy/config.json');
const config = JSON.parse(await readFile(configPath, 'utf8'));
const root = new URL(config.JENKINS_URL);
assert.equal(root.href, 'https://jenkins-legacy-drs-sg.zeabur.app/');
const auth = `Basic ${Buffer.from(`${config.JENKINS_USER}:${config.JENKINS_API_TOKEN}`).toString('base64')}`;
const job = 'sg-target-queue-pipeline';
const holdSeconds=process.argv.includes('--ui-wait')?'120':'45';
const evidencePath = resolve('.local/jenkins-target-fixtures/queue-verification.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const xml = s => String(s).replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
async function native(path, options = {}) {
  const url = new URL(path, root);
  assert.equal(url.origin, root.origin);
  const r = await fetch(url, { ...options, headers: { Authorization: auth, ...options.headers }, redirect: 'manual', signal: AbortSignal.timeout(30000) });
  assert.ok(r.ok || [302, 303].includes(r.status), `SG HTTP ${r.status} for ${path}`);
  return r;
}
async function waitFor(fn, description, timeout = 240000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result;
    await sleep(800);
  }
  throw Error(`Timed out: ${description}`);
}
if (process.argv.includes('--verify')) {
  const report = JSON.parse(await readFile(evidencePath, 'utf8'));
  for (const run of report.completed) {
    const live = await (await native(`job/${job}/${run.number}/api/json?tree=number,result,queueId`)).json();
    assert.equal(live.result, 'SUCCESS');
    assert.equal(live.queueId, run.queueId);
  }
  if(report.labelWait){
    const live=await(await native(`job/${report.labelWait.job}/${report.labelWait.number}/api/json?tree=number,result,queueId`)).json();
    assert.equal(live.result,'ABORTED');
    assert.equal(live.queueId,report.labelWait.queueId);
    const queue=await(await native('queue/api/json?tree=items[id]')).json();
    assert.ok(!queue.items.some(i=>i.id===report.labelWait.nodeQueueItem.id));
  }
  console.log(`Verified ${report.completed.length} recorded SG queue-to-build transitions; no build triggered.`);
} else {
  assert.ok(process.argv.includes('--run'), 'Use --run (creates SG history) or --verify (read only).');
  const version = await native('api/json?tree=jobs[name]');
  assert.equal(version.headers.get('x-jenkins'), '2.263.1');
  const script = `pipeline {
    agent any
    options { disableConcurrentBuilds(); timeout(time: 3, unit: 'MINUTES') }
    stages {
      stage('Hold synthetic executor') { steps { sleep time: params.HOLD_SECONDS.toInteger(), unit: 'SECONDS' } }
      stage('Record queue completion') { steps { echo '[sg-target] queue fixture completed; no external operations' } }
    }
  }`;
  const definition = `<?xml version="1.0"?><flow-definition plugin="workflow-job"><description>[sg-target] Queue wait, cancellation and executable tracking; synthetic only.</description><keepDependencies>false</keepDependencies><properties><hudson.model.ParametersDefinitionProperty><parameterDefinitions><hudson.model.ChoiceParameterDefinition><name>HOLD_SECONDS</name><choices class="java.util.Arrays$ArrayList"><a class="string-array"><string>1</string><string>45</string><string>120</string></a></choices></hudson.model.ChoiceParameterDefinition><hudson.model.StringParameterDefinition><name>CASE_ID</name><defaultValue>queue-fixture</defaultValue></hudson.model.StringParameterDefinition></parameterDefinitions></hudson.model.ParametersDefinitionProperty></properties><definition class="org.jenkinsci.plugins.workflow.cps.CpsFlowDefinition" plugin="workflow-cps"><script>${xml(script)}</script><sandbox>true</sandbox></definition><triggers/><disabled>false</disabled></flow-definition>`;
  const exists = await fetch(new URL(`job/${job}/api/json?tree=description`, root), { headers: { Authorization: auth }, redirect: 'manual', signal: AbortSignal.timeout(30000) });
  assert.ok([200, 404].includes(exists.status));
  if (exists.ok) assert.ok((await exists.json()).description.startsWith('[sg-target]'));
  await native(exists.ok ? `job/${job}/config.xml` : `createItem?name=${job}`, { method: 'POST', headers: { 'Content-Type': 'application/xml' }, body: definition });
  const client = new Client({name:'sg-target-queue-verification',version:'1.0.0'});
  // Only JENKINS_CONFIG_FILE selects this private profile; credentials do not
  // appear in command arguments, output or the evidence report.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('JENKINS_')));
  env.JENKINS_CONFIG_FILE = configPath;
  const transport = new StdioClientTransport({command:process.execPath,args:[resolve('release/jenkins/dist/server.mjs')],env});
  const report = { recordedAt:new Date().toISOString(), root:root.href, mode:'api', job, waiting:[], completed:[], cancellation:null };
  const call = async (name, args={}) => {const r=await client.callTool({name,arguments:args});assert.ok(!r.isError, `${name} failed`);return r.structuredContent;};
  try {
    await client.connect(transport);
    assert.equal((await call('getJob',{jobFullName:job})).buildable,true);
    const scheduledA = await call('triggerBuild',{jobFullName:job,parameters:{HOLD_SECONDS:holdSeconds,CASE_ID:'holder'}});
    assert.ok(scheduledA.queueId);
    assert.ok(scheduledA.queueUrl.startsWith(root.href));
    const a = await waitFor(async()=>{const q=await call('getQueueItem',{queueId:Number(scheduledA.queueId)});return q.executable;},'holder executable');
    await waitFor(async()=>{const stages=await(await native(`job/${job}/${a.number}/wfapi/describe`)).json();return stages.stages.some(s=>s.name==='Hold synthetic executor'&&s.status==='IN_PROGRESS');},'holder stage');
    const scheduledB = await call('triggerBuild',{jobFullName:job,parameters:{HOLD_SECONDS:'1',CASE_ID:'wait-then-run'}});
    const bWait = await waitFor(async()=>{const q=await call('getQueueItem',{queueId:Number(scheduledB.queueId)});return !q.executable&&q.blocked&&q.why?q:null;},'blocked second build');
    report.waiting.push({case:'previous-build-running',queueId:Number(scheduledB.queueId),...bWait});
    const waitingCard=await call('uiTrackQueue',{jobFullName:job,queueId:Number(scheduledB.queueId)});
    assert.equal(waitingCard.view,'queue');assert.equal(waitingCard.queue.blocked,true);
    await mkdir('.local/jenkins-api-mode',{recursive:true,mode:0o700});
    await writeFile('.local/jenkins-api-mode/queue-live-progress.json',JSON.stringify({job,holder:a.number,waiterQueue:Number(scheduledB.queueId),waitingCard}),{mode:0o600});
    console.log(JSON.stringify({phase:'waiting',job,holder:a.number,waiterQueue:Number(scheduledB.queueId)}));
    const scheduledC = await call('triggerBuild',{jobFullName:job,parameters:{HOLD_SECONDS:'1',CASE_ID:'cancel-before-executable'}});
    const cWait = await waitFor(async()=>{const q=await call('getQueueItem',{queueId:Number(scheduledC.queueId)});return !q.executable&&q.blocked?q:null;},'blocked cancellation build');
    await native(`queue/cancelItem?id=${scheduledC.queueId}`,{method:'POST'});
    const cancelled=await waitFor(async()=>{const q=await call('getQueueItem',{queueId:Number(scheduledC.queueId)});return q.cancelled?q:null;},'cancelled queue item');
    assert.ok(!cancelled.executable);
    const cancelledCard=await call('uiTrackQueue',{jobFullName:job,queueId:Number(scheduledC.queueId)});
    assert.equal(cancelledCard.view,'queue');assert.equal(cancelledCard.queue.cancelled,true);
    await writeFile('.local/jenkins-api-mode/queue-live-progress.json',JSON.stringify({job,holder:a.number,waiterQueue:Number(scheduledB.queueId),cancelledQueue:Number(scheduledC.queueId),waitingCard,cancelledCard}),{mode:0o600});
    console.log(JSON.stringify({phase:'cancelled',cancelledQueue:Number(scheduledC.queueId)}));
    report.cancellation={queueId:Number(scheduledC.queueId),before:cWait,after:cancelled};
    const b = await waitFor(async()=>{const q=await call('getQueueItem',{queueId:Number(scheduledB.queueId)});return q.executable;},'waiter executable');
    for (const [queued, executable] of [[scheduledA,a],[scheduledB,b]]) {
      assert.ok(executable.url.startsWith(root.href));
      const completed=await waitFor(async()=>{const r=await call('getBuild',{jobFullName:job,buildNumber:executable.number});return !r.building?r:null;},'completed build');
      assert.equal(completed.result,'SUCCESS');
      assert.equal(completed.queueId,Number(queued.queueId));
      const tracked=await call('uiTrackQueue',{jobFullName:job,queueId:Number(queued.queueId)});
      assert.equal(tracked.view,'card');assert.equal(tracked.build.number,completed.number);assert.equal(tracked.build.queueId,completed.queueId);
      report.completed.push({number:completed.number,result:completed.result,queueId:completed.queueId,url:completed.url});
    }
    const all=await(await native(`job/${job}/api/json?tree=builds[number,queueId]`)).json();
    assert.ok(!all.builds.some(b=>b.queueId===Number(scheduledC.queueId)),'Cancelled queue item unexpectedly created a build');
    // A separate Pipeline waits for a deliberately absent label. Do not change
    // existing node labels or executor counts to manufacture this scenario.
    const labelJob='sg-target-queue-label';
    const labelScript="pipeline { agent { label 'sg-target-missing-agent-fixture' }; options { timeout(time: 3, unit: 'MINUTES') }; stages { stage('Await synthetic agent') { steps { echo '[sg-target] unavailable-label fixture' } } } }";
    const labelXml=`<?xml version="1.0"?><flow-definition plugin="workflow-job"><description>[sg-target] Absent-label queue fixture; abort after observing wait.</description><keepDependencies>false</keepDependencies><properties/><definition class="org.jenkinsci.plugins.workflow.cps.CpsFlowDefinition" plugin="workflow-cps"><script>${xml(labelScript)}</script><sandbox>true</sandbox></definition><triggers/><disabled>false</disabled></flow-definition>`;
    const labelExists=await fetch(new URL(`job/${labelJob}/api/json?tree=description`,root),{headers:{Authorization:auth},redirect:'manual',signal:AbortSignal.timeout(30000)});
    assert.ok([200,404].includes(labelExists.status));
    if(labelExists.ok)assert.ok((await labelExists.json()).description.startsWith('[sg-target]'));
    await native(labelExists.ok?`job/${labelJob}/config.xml`:`createItem?name=${labelJob}`,{method:'POST',headers:{'Content-Type':'application/xml'},body:labelXml});
    await call('getJob',{jobFullName:labelJob});
    const labelScheduled=await call('triggerBuild',{jobFullName:labelJob});
    const labelBuild=await waitFor(async()=>{const q=await call('getQueueItem',{queueId:Number(labelScheduled.queueId)});return q.executable;},'label Pipeline executable');
    const labelWait=await waitFor(async()=>{
      const queue=await(await native('queue/api/json?tree=items[id,why,blocked,buildable,stuck,task[name,url]]')).json();
      return queue.items.find(q=>q.why?.includes('sg-target-missing-agent-fixture'));
    },'missing-label queue reason');
    const labelItem=await call('getQueueItem',{queueId:labelWait.id});
    assert.ok(!labelItem.executable);
    await native(`job/${labelJob}/${labelBuild.number}/stop`,{method:'POST'});
    const aborted=await waitFor(async()=>{const r=await call('getBuild',{jobFullName:labelJob,buildNumber:labelBuild.number});return !r.building?r:null;},'label build aborted');
    assert.equal(aborted.result,'ABORTED');
    await waitFor(async()=>{const q=await(await native('queue/api/json?tree=items[id]')).json();return !q.items.some(i=>i.id===labelWait.id);},'label wait removed');
    report.labelWait={job:labelJob,number:labelBuild.number,queueId:Number(labelScheduled.queueId),nodeQueueItem:labelItem,result:aborted.result,url:aborted.url};
    await mkdir(resolve(evidencePath,'..'),{recursive:true,mode:0o700});
    await writeFile(evidencePath,JSON.stringify(report,null,2)+'\n',{mode:0o600});
    console.log(JSON.stringify({job,completed:report.completed,waitingVerified:true,cancellationVerified:true,labelWaitVerified:true,mode:report.mode}));
  } finally { await client.close(); }
}
