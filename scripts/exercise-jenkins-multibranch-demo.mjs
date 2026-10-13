import { writeFile } from "node:fs/promises";
import { j, g, putFile, branch, repoPath, jobPath, sleep } from "./seed-jenkins-demo.mjs";

if (process.argv.length !== 3 || !["--run", "--verify"].includes(process.argv[2])) throw new Error("Use exactly --run or --verify");
const repo = "demo-multibranch-lab", project = "demo-multibranch", path = repoPath(repo);
if (!(await g(path)).value.description?.startsWith("[DEMO]")) throw new Error("Unmarked webhook fixture");
const evidence = { recordedAt: new Date().toISOString(), records: [] };
async function children() {
  return (await j(`${jobPath(project)}api/json?tree=jobs[name,displayName,fullName,buildable,color,lastBuild[number,result,building,url,timestamp,duration,description,actions[causes[_class,shortDescription]]]]`)).value.jobs;
}
async function before(name) { return (await children()).find((job) => job.displayName === name)?.lastBuild?.number || 0; }
async function wait(name, previous, result, sha, automatic = true) {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const job = (await children()).find((job) => job.displayName === name), build = job?.lastBuild;
    if (build && build.number > previous && !build.building && build.result) {
      if (build.result !== result) throw new Error(`${name} #${build.number}: ${build.result}, expected ${result}`);
      const log = String((await j(`${jobPath(job.fullName)}${build.number}/consoleText`)).value);
      if (sha && !log.includes(sha)) throw new Error(`Webhook commit missing from ${name} log`);
      const causes = build.actions.flatMap((action) => action.causes || []);
      const webhookCause = causes.some((cause) => /BranchEventCause|SCMEventCause/.test(cause._class));
      if (automatic && !webhookCause) throw new Error(`${name} did not have an SCM event cause`);
      const record = { name, fullName: job.fullName, number: build.number, result, duration: build.duration, sha: sha || null, webhookCause, causes, url: build.url };
      evidence.records.push(record);
      await writeFile(".local/jenkins-demo/multibranch-event-builds.json", JSON.stringify(evidence, null, 2));
      console.log(`${automatic ? "WEBHOOK" : "INDEX"} ${name} #${build.number}: ${result}`);
      return record;
    }
    await sleep(1500);
  }
  throw new Error(`No completed automatic ${name} build within three minutes`);
}
async function refSha(ref) { return (await g(`${path}/branches/${encodeURIComponent(ref)}`)).value.commit.id; }
if (process.argv[2] === "--run") {
  // Initial root indexing creates children itself; this script never schedules a child build or another scan.
  await wait("master", 0, "SUCCESS", null, false);
  await wait("develop", 0, "UNSTABLE", null, false);
  await wait("PR-1", 0, "SUCCESS", null, false);
  const initial = await children();
  if (initial.some((job) => job.displayName === "feature/no-jenkinsfile" || job.displayName === "feature/pr-auto")) throw new Error("Branch discovery filtering did not match the configured traits");
  evidence.missingJenkinsfileExcluded = true;
  evidence.originPrBranchNotDuplicated = true;

  let previous = await before("develop");
  await putFile(repo, "ci/scenario.txt", "success\n", "ci: recover develop fixture through webhook", "develop");
  await wait("develop", previous, "SUCCESS", await refSha("develop"));

  const feature = "feature/webhook-auto";
  previous = await before(feature);
  await branch(repo, feature);
  await putFile(repo, "docs/webhook-auto.md", `# Webhook branch fixture\n\n[DEMO] ${new Date().toISOString()}\n`, "docs: discover new branch via push webhook", feature);
  await wait(feature, previous, "SUCCESS", await refSha(feature));
  const pulls = (await g(`${path}/pulls?state=all&limit=100`)).value;
  let pull = pulls.find((pr) => pr.head.ref === feature && pr.state === "open");
  if (!pull) pull = (await g(`${path}/pulls`, { method: "POST", data: { head: feature, base: "master", title: "[演示] Webhook automatic PR lifecycle", body: "[DEMO] Opens through the real pull_request webhook, changes success/unstable/failure, then closes without merging." } })).value;
  if (!pull.title.startsWith("[演示]")) throw new Error("Unmarked automatic PR");
  const prName = `PR-${pull.number}`;
  await wait(prName, 0, "SUCCESS", await refSha(feature));
  for (const [scenario, result] of [["unstable", "UNSTABLE"], ["failure", "FAILURE"], ["success", "SUCCESS"]]) {
    previous = await before(prName);
    await putFile(repo, "ci/scenario.txt", `${scenario}\n`, `ci: PR webhook ${scenario} fixture`, feature);
    await wait(prName, previous, result, await refSha(feature));
  }

  previous = await before("PR-1");
  await putFile(repo, "docs/pr-auto-update.md", `# PR synchronize fixture\n\n[DEMO] ${new Date().toISOString()}\n`, "docs: update existing PR through synchronize webhook", "feature/pr-auto");
  await wait("PR-1", previous, "SUCCESS", await refSha("feature/pr-auto"));

  previous = await before(feature);
  await g(`${path}/pulls/${pull.number}`, { method: "PATCH", data: { state: "closed" } });
  await putFile(repo, "docs/closed-pr.md", "# Closed PR branch\n\n[DEMO] Branch becomes eligible for ordinary branch builds again.\n", "docs: push after closing PR without merge", feature);
  await wait(feature, previous, "SUCCESS", await refSha(feature));
  evidence.closedPull = { number: pull.number, state: (await g(`${path}/pulls/${pull.number}`)).value.state };
}
evidence.finalChildren = await children();
evidence.queue = (await j("queue/api/json?tree=items[id]")).value.items.length;
await writeFile(".local/jenkins-demo/multibranch-event-builds.json", JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ events: evidence.records.length, missingJenkinsfileExcluded: evidence.missingJenkinsfileExcluded, originPrBranchNotDuplicated: evidence.originPrBranchNotDuplicated, closedPull: evidence.closedPull, queue: evidence.queue }));
