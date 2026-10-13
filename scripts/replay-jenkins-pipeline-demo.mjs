import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const JOBS = [
  "demo-build-display-name", "demo-command-return-status", "demo-daily-history",
  "demo-input-approved", "demo-input-rejected", "demo-multi-repository-pipeline",
  "demo-multibranch/develop", "demo-multibranch/feature%2Fwebhook-auto",
  "demo-multibranch/master", "demo-multibranch/PR-1", "demo-multibranch/PR-2",
  "demo-pipeline-catch-error", "demo-pipeline-from-scm", "demo-pipeline-parallel",
  "demo-pipeline-recovery", "demo-pipeline-release", "demo-pipeline-retry",
  "demo-pipeline-retry-exhausted", "demo-pipeline-stash", "demo-pipeline-timeout",
  "demo-platform-matrix", "demo-workspace-cleanup",
];
const branchJobs = new Set([
  "demo-multibranch/develop", "demo-multibranch/feature%2Fwebhook-auto",
  "demo-multibranch/master", "demo-multibranch/PR-1", "demo-multibranch/PR-2",
]);
const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
const args = new Set(process.argv.slice(2));

function plan() {
  return [
    ["success", "demo-build-display-name", "demo-pipeline-from-scm", "demo-pipeline-stash", "demo-workspace-cleanup"],
    ["failure + recovery", "demo-pipeline-recovery(SCENARIO=failure)", "demo-pipeline-recovery(SCENARIO=success)", "demo-pipeline-retry-exhausted(SCENARIO=failure)"],
    ["unstable / parallel", "demo-command-return-status(SCENARIO=unstable)", "demo-pipeline-catch-error(SCENARIO=unstable)", "demo-pipeline-parallel(SCENARIO=unstable)", "demo-platform-matrix(SCENARIO=unstable)"],
    ["retry / timeout", "demo-pipeline-retry", "demo-pipeline-timeout(SCENARIO=aborted)"],
    ["gates", "demo-input-approved(proceedEmpty: demoGate only)", "demo-input-rejected(abort: demoGate only)"],
    ["downstream / repository Pipeline", "demo-pipeline-release(RUN_EXTRA_CHECKS=true)", "demo-multi-repository-pipeline"],
    ["already replayed; skipped", "demo-daily-history (3 successful runs)", "demo-multibranch/* (parent handling separately)"],
  ];
}

if (isMain && (args.has("--help") || args.size === 0)) {
  console.log("Usage: node scripts/replay-jenkins-pipeline-demo.mjs --plan | --run\n--plan prints the static demo-only replay matrix. --run schedules builds on the pinned SG Jenkins 2.263.1 controller.");
  process.exit(args.has("--help") ? 0 : 2);
}
if (isMain && args.has("--plan")) {
  for (const [group, ...jobs] of plan()) console.log(`${group}: ${jobs.join(", ")}`);
  process.exit(0);
}
if (isMain && (args.size !== 1 || !args.has("--run"))) throw new Error("Choose exactly one of --plan or --run.");

const { j, jobPath, finishBuild, jenkinsUrl } = await import("./seed-jenkins-demo.mjs");
const expectedClass = "org.jenkinsci.plugins.workflow.job.WorkflowJob";
const outputPath = resolve(".local/jenkins-legacy/replay/pipeline-results.json");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];

async function verifyController() {
  const allowedHosts = new Set(["jenkins-mcp-drs-sg.zeabur.app", "jenkins-legacy-drs-sg.zeabur.app"]);
  if (jenkinsUrl.protocol !== "https:" || !allowedHosts.has(jenkinsUrl.hostname) || jenkinsUrl.username || jenkinsUrl.password || jenkinsUrl.pathname !== "/" || jenkinsUrl.search || jenkinsUrl.hash) {
    throw new Error("Replay is restricted to the SG legacy Jenkins HTTPS origin.");
  }
  const config = JSON.parse(await readFile(".local/jenkins-test/zeabur/config.json", "utf8"));
  const authorization = `Basic ${Buffer.from(`${config.JENKINS_USER}:${config.JENKINS_API_TOKEN}`).toString("base64")}`;
  const response = await fetch(new URL("api/json?tree=mode,nodeDescription", jenkinsUrl), { headers: { Authorization: authorization }, redirect: "manual", signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Jenkins preflight failed: HTTP ${response.status}`);
  if (response.headers.get("x-jenkins") !== "2.263.1") throw new Error(`Expected Jenkins 2.263.1; received ${response.headers.get("x-jenkins") || "no X-Jenkins header"}`);
}

async function inspectJobs() {
  for (const name of JOBS.filter((candidate) => candidate !== "demo-daily-history" && !branchJobs.has(candidate))) {
    const job = (await j(`${jobPath(name)}api/json?tree=fullName,buildable,_class,description,property[parameterDefinitions[name]]`)).value;
    if (job.fullName !== name || !job.buildable || job._class !== expectedClass) throw new Error(`Refusing non-Pipeline or non-buildable job: ${name}`);
    if (!branchJobs.has(name) && !job.description?.startsWith("[演示数据]")) throw new Error(`Refusing unmarked job: ${name}`);
  }
}

function profiles(name) {
  const build = (scenario, parameters = {}, extra = {}) => ({ name, scenario, parameters, ...extra });
  switch (name) {
    case "demo-command-return-status":
    case "demo-pipeline-catch-error":
    case "demo-pipeline-parallel":
    case "demo-platform-matrix": return [build("unstable", { SCENARIO: "unstable" })];
    case "demo-pipeline-recovery": return [build("failure", { SCENARIO: "failure" }), build("success", { SCENARIO: "success" })];
    case "demo-pipeline-retry-exhausted": return [build("failure", { SCENARIO: "failure" })];
    case "demo-pipeline-timeout": return [build("aborted", { SCENARIO: "aborted" }, { cancelOnStart: false })];
    case "demo-input-approved": return [build("success", {}, { inputAction: "proceedEmpty" })];
    case "demo-input-rejected": return [build("aborted", {}, { inputAction: "abort", cancelOnStart: false })];
    case "demo-pipeline-release": return [build("success", { RUN_EXTRA_CHECKS: "true" })];
    default: return [build("success")];
  }
}

async function enqueue(spec, index) {
  const path = jobPath(spec.name);
  const current = (await j(`${path}api/json?tree=fullName,buildable,property[parameterDefinitions[name]]`)).value;
  if (current.fullName !== spec.name || !current.buildable) throw new Error(`Job changed before scheduling: ${spec.name}`);
  const defined = new Set((current.property || []).flatMap((entry) => entry.parameterDefinitions || []).map((entry) => entry.name));
  for (const parameter of Object.keys(spec.parameters)) if (!defined.has(parameter)) throw new Error(`Parameter ${parameter} is not defined on ${spec.name}`);
  const endpoint = defined.size ? `${path}buildWithParameters` : `${path}build`;
  const queued = await j(endpoint, {
    method: "POST",
    ...(Object.keys(spec.parameters).length ? { contentType: "application/x-www-form-urlencoded", data: new URLSearchParams(spec.parameters).toString() } : {}),
  });
  const queue = new URL(queued.location, jenkinsUrl);
  if (queue.origin !== jenkinsUrl.origin || !/^\/queue\/item\/\d+\/$/.test(queue.pathname)) throw new Error(`Unexpected queue URL for ${spec.name}`);
  console.log(`Queued ${spec.name} profile ${index + 1}`);
  return { job: { name: spec.name, cancelOnStart: spec.cancelOnStart }, round: index + 1, scenario: spec.scenario, sha: null, queue: `${queue.pathname.slice(1)}api/json`, submittedAt: Date.now() };
}

async function handleDemoInput(jobName, action, queuePath) {
  const deadline = Date.now() + 55000;
  let buildNumber;
  while (Date.now() < deadline) {
    const queue = (await j(queuePath)).value;
    buildNumber ||= queue.executable?.number;
    if (buildNumber) {
      const pending = (await j(`${jobPath(jobName)}${buildNumber}/wfapi/pendingInputActions`)).value;
      const gate = Array.isArray(pending) && pending.find((candidate) => String(candidate.id).toLowerCase() === "demogate" && String(candidate.message).startsWith("[DEMO]"));
      if (gate) {
        const operation = action === "proceedEmpty" ? "proceedEmpty" : "abort";
        await j(`${jobPath(jobName)}${buildNumber}/input/${encodeURIComponent(gate.id)}/${operation}`, { method: "POST" });
        console.log(`${action === "proceedEmpty" ? "Approved" : "Rejected"} marked demoGate on ${jobName} #${buildNumber}`);
        return;
      }
    }
    if (queue.cancelled) throw new Error(`Queue cancelled before demo input gate: ${jobName}`);
    await sleep(600);
  }
  throw new Error(`No marked demoGate input appeared on ${jobName}`);
}

async function replay(spec, index) {
  const item = await enqueue(spec, index);
  const numberPromise = (async () => {
    const deadline = Date.now() + 240000;
    while (Date.now() < deadline) {
      const queue = (await j(item.queue)).value;
      if (queue.cancelled) throw new Error(`Queue cancelled unexpectedly: ${spec.name}`);
      if (queue.executable?.number) return queue.executable.number;
      await sleep(700);
    }
    throw new Error(`No executable build number for ${spec.name}`);
  })();
  const tasks = [finishBuild(item), numberPromise];
  if (spec.inputAction) tasks.push(handleDemoInput(spec.name, spec.inputAction, item.queue));
  await Promise.all(tasks);
  const buildNumber = await numberPromise;
  const path = jobPath(spec.name);
  const build = (await j(`${path}${buildNumber}/api/json?tree=number,result,url`)).value;
  const graph = (await j(`${path}${buildNumber}/wfapi/describe`)).value;
  if (!Array.isArray(graph.stages) || graph.stages.length === 0) throw new Error(`No Pipeline stages were recorded: ${spec.name} #${buildNumber}`);
  results.push({ job: spec.name, build: buildNumber, result: build.result, url: build.url, stages: graph.stages.map(({ name, status, durationMillis }) => ({ name, status, durationMillis })) });
  await mkdir(resolve(outputPath, ".."), { recursive: true, mode: 0o700 });
  await writeFile(outputPath, `${JSON.stringify({ recordedAt: new Date().toISOString(), controller: jenkinsUrl.origin, results }, null, 2)}\n`, { mode: 0o600 });
  console.log(`${build.result} ${spec.name} #${buildNumber}: ${graph.stages.map((stage) => `${stage.name}=${stage.status}`).join(", ")}`);
}

if (isMain && args.has("--run")) {
  await verifyController();
  await inspectJobs();
  let index = 0;
  // Daily history already has three successful replays; multibranch and PR children are being handled separately.
  for (const name of JOBS.filter((candidate) => candidate !== "demo-daily-history" && !branchJobs.has(candidate))) {
    for (const spec of profiles(name)) await replay(spec, index++);
  }
  console.log(`Replay complete: ${results.length} Pipeline builds; report=${outputPath}`);
}
