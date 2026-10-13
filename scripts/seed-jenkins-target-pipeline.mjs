import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const HOST = "jenkins-legacy-drs-sg.zeabur.app";
const INTERNAL_GITEA = "http://service-6acce8de4873e494859dc96e:3000";
const REPO = "demo-target-ci";
const PUBLIC_GITEA_HOST = "gitea-drs-sg.zeabur.app";
const JENKINSFILE_PATH = "test/legacy-jenkins/target-pipeline.Jenkinsfile";
const JOBS = ["sg-target-parameter-pipeline", "sg-target-boolean-pipeline"];
const EVIDENCE = ".local/jenkins-target-fixtures";
const main = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

export const scenarios = [
  { job: JOBS[0], branch: "master", TARGET_ENV: "dev", RESULT_MODE: "success", DEMO_NOTE: "baseline success", expectedResult: "SUCCESS" },
  { job: JOBS[0], branch: "develop", TARGET_ENV: "staging", RESULT_MODE: "unstable", DEMO_NOTE: "unstable report", expectedResult: "UNSTABLE" },
  { job: JOBS[0], branch: "master", TARGET_ENV: "prod-demo", RESULT_MODE: "failure", DEMO_NOTE: "intentional failure", expectedResult: "FAILURE" },
  { job: JOBS[0], branch: "develop", TARGET_ENV: "staging", RESULT_MODE: "success", DEMO_NOTE: "input aborted", expectedResult: "ABORTED" },
  { job: JOBS[0], branch: "master", TARGET_ENV: "dev", RESULT_MODE: "success", DEMO_NOTE: "input resumed", expectedResult: "SUCCESS" },
  { job: JOBS[1], branch: "master", TARGET_ENV: "staging", RUN_EXTRA_CHECKS: false, expectedResult: "SUCCESS", bootstrap: true },
  { job: JOBS[1], branch: "develop", TARGET_ENV: "staging", RUN_EXTRA_CHECKS: true, expectedResult: "SUCCESS" },
];

const esc = (s) => String(s).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);
const jpath = (name) => name.split("/").map((p) => `job/${encodeURIComponent(p)}`).join("/") + "/";
const choices = (name, values) => `<hudson.model.ChoiceParameterDefinition><name>${name}</name><description>合成 Pipeline 参数</description><choices class="java.util.Arrays$ArrayList"><a class="string-array">${values.map((v) => `<string>${esc(v)}</string>`).join("")}</a></choices></hudson.model.ChoiceParameterDefinition>`;
const stringParam = `<hudson.model.StringParameterDefinition><name>DEMO_NOTE</name><description>可选合成说明</description><defaultValue></defaultValue></hudson.model.StringParameterDefinition>`;
const boolParam = `<hudson.model.BooleanParameterDefinition><name>RUN_EXTRA_CHECKS</name><description>开启额外合成阶段</description><defaultValue>true</defaultValue></hudson.model.BooleanParameterDefinition>`;
function gitParam(uuid) {
  const pattern = `${INTERNAL_GITEA}/${repositoryOwner}/${REPO}.git`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `<net.uaznia.lukanus.hudson.plugins.gitparameter.GitParameterDefinition plugin="git-parameter"><name>BRANCH</name><description>合成仓库分支</description><uuid>${uuid}</uuid><type>PT_BRANCH</type><branch></branch><tagFilter>*</tagFilter><branchFilter>origin/(.*)</branchFilter><sortMode>ASCENDING_SMART</sortMode><defaultValue>master</defaultValue><selectedValue>DEFAULT</selectedValue><useRepository>${esc(pattern)}</useRepository><quickFilterEnabled>false</quickFilterEnabled><listSize>5</listSize></net.uaznia.lukanus.hudson.plugins.gitparameter.GitParameterDefinition>`;
}
const auth = (c) => `Basic ${Buffer.from(`${c.JENKINS_USER}:${c.JENKINS_API_TOKEN}`).toString("base64")}`;
let base, authorization, repositoryOwner, giteaBase, giteaAuthorization;
async function request(path, { method = "GET", body, contentType, allow404 = false, allowRedirect = false } = {}) {
  const url = new URL(path, base);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) throw new Error("Request outside approved Jenkins origin");
  const res = await fetch(url, { method, headers: { Authorization: authorization, Accept: "application/json", ...(contentType ? { "Content-Type": contentType } : {}) }, body, redirect: "manual", signal: AbortSignal.timeout(45000) });
  if (res.status === 404 && allow404) return null;
  if (res.status >= 300 && res.status < 400) {
    if (allowRedirect) return { value: null, headers: res.headers, status: res.status };
    throw new Error(`${method} ${url.pathname}: redirect ${res.status}`);
  }
  if (!res.ok) throw new Error(`${method} ${url.pathname}: HTTP ${res.status}`);
  const text = await res.text(); let value; try { value = text ? JSON.parse(text) : null; } catch { value = text; }
  return { value, headers: res.headers, status: res.status };
}
async function giteaRequest(path, { method = "GET", body, allow404 = false } = {}) {
  const url = new URL(path, giteaBase);
  if (url.origin !== giteaBase.origin || !url.pathname.startsWith(giteaBase.pathname)) throw new Error("Request escaped approved synthetic Gitea origin");
  const response = await fetch(url, { method, headers: { Authorization: giteaAuthorization, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: "manual", signal: AbortSignal.timeout(30000) });
  if (response.status === 404 && allow404) return null;
  if (response.status >= 300 && response.status < 400) throw new Error(`${method} ${url.pathname}: unexpected redirect (${response.status})`);
  if (!response.ok) throw new Error(`${method} ${url.pathname}: HTTP ${response.status}`);
  const text = await response.text(); let value; try { value = text ? JSON.parse(text) : null; } catch { value = text; }
  return { value, status: response.status };
}
function repositoryPath(suffix = "") { return `api/v1/repos/${encodeURIComponent(repositoryOwner)}/${encodeURIComponent(REPO)}${suffix}`; }
async function ensureSyntheticRepository() {
  const existing = await giteaRequest(repositoryPath(), { allow404: true });
  if (!existing) {
    await giteaRequest("api/v1/user/repos", { method: "POST", body: { name: REPO, description: "[DEMO] Synthetic SG target pipeline branches for Jenkins parameter and stage fixtures.", private: false, auto_init: true, default_branch: "master" } });
    await new Promise((ok) => setTimeout(ok, 1200));
  } else if (existing.value.private || !String(existing.value.description || "").startsWith("[DEMO]")) {
    throw new Error(`Refusing to change an existing non-fixture Gitea repo: ${REPO}`);
  }
  const repo = await giteaRequest(repositoryPath());
  if (repo.value.private !== false || !String(repo.value.description || "").startsWith("[DEMO]")) throw new Error("Synthetic Gitea repository must be public and [DEMO]-marked");
  const master = await giteaRequest(repositoryPath("/branches/master"), { allow404: true });
  if (!master) throw new Error("Synthetic repo master branch is missing");
  const masterContent = await readFile(JENKINSFILE_PATH, "utf8");
  const render = (branch) => `// [sg-target] fixture branch: ${branch}\n${masterContent}`;
  const priorRender = (branch) => render(branch).replace("    skipDefaultCheckout()\n", "");
  const filePath = "Jenkinsfile";
  async function readContent(branch) {
    return giteaRequest(repositoryPath(`/contents/${filePath}?ref=${encodeURIComponent(branch)}`), { allow404: true });
  }
  const masterFile = await readContent("master");
  if (!masterFile) {
    await giteaRequest(repositoryPath(`/contents/${filePath}`), { method: "POST", body: { message: "Add synthetic target pipeline fixture", content: Buffer.from(render("master")).toString("base64"), branch: "master" } });
  } else {
    const existingMasterText = Buffer.from(masterFile.value.content, "base64").toString("utf8");
    if (existingMasterText !== render("master")) {
      if (existingMasterText !== priorRender("master")) throw new Error("Refusing to overwrite a changed Jenkinsfile on demo-target-ci/master");
      await giteaRequest(repositoryPath(`/contents/${filePath}`), { method: "PUT", body: { message: "Update synthetic pipeline checkout behavior", content: Buffer.from(render("master")).toString("base64"), sha: masterFile.value.sha, branch: "master" } });
    }
  }
  let develop = await giteaRequest(repositoryPath("/branches/develop"), { allow404: true });
  if (!develop) {
    await giteaRequest(repositoryPath("/branches"), { method: "POST", body: { new_branch_name: "develop", old_branch_name: "master" } });
    await new Promise((ok) => setTimeout(ok, 1000));
  }
  const developFile = await readContent("develop");
  if (!developFile) {
    await giteaRequest(repositoryPath(`/contents/${filePath}`), { method: "POST", body: { message: "Add develop fixture marker", content: Buffer.from(render("develop")).toString("base64"), branch: "develop" } });
  } else {
    const existingDevelopText = Buffer.from(developFile.value.content, "base64").toString("utf8");
    const latestBranches = await Promise.all([giteaRequest(repositoryPath("/branches/master")), giteaRequest(repositoryPath("/branches/develop"))]);
    const sameSeedCommit = latestBranches[0].value.commit.id === latestBranches[1].value.commit.id;
    if (existingDevelopText !== render("develop")) {
      if (existingDevelopText !== priorRender("develop") && !(sameSeedCommit && existingDevelopText === priorRender("master"))) throw new Error("Refusing to overwrite a changed Jenkinsfile on demo-target-ci/develop");
      await giteaRequest(repositoryPath(`/contents/${filePath}`), { method: "PUT", body: { message: "Update develop pipeline fixture", content: Buffer.from(render("develop")).toString("base64"), sha: developFile.value.sha, branch: "develop" } });
    }
  }
  const [masterFinal, developFinal] = await Promise.all([giteaRequest(repositoryPath("/branches/master")), giteaRequest(repositoryPath("/branches/develop"))]);
  const branches = { master: masterFinal.value.commit.id, develop: developFinal.value.commit.id };
  if (!branches.master || !branches.develop || branches.master === branches.develop) throw new Error("Synthetic master/develop branches must have distinct commits");
  return { name: REPO, owner: repositoryOwner, private: repo.value.private, description: repo.value.description, branches };
}
function configXml(name) {
  const params = name === JOBS[0]
    ? `${gitParam("58d763a2-3906-4f9b-8c07-6aa6fd1a3901")}${choices("TARGET_ENV", ["dev", "staging", "prod-demo"])}${choices("RESULT_MODE", ["success", "unstable", "failure"])}${stringParam}`
    : `${gitParam("bb9a654e-323c-43bd-9e37-c06dca0635f8")}${choices("TARGET_ENV", ["dev", "staging"])}${boolParam}`;
  const description = `[sg-target] Synthetic Declarative Pipeline fixture for Jenkins 2.263.1; no deployment or internal workload.`;
  const scm = `<scm class="hudson.plugins.git.GitSCM" plugin="git"><configVersion>2</configVersion><userRemoteConfigs><hudson.plugins.git.UserRemoteConfig><name>origin</name><url>${esc(`${INTERNAL_GITEA}/${repositoryOwner}/${REPO}.git`)}</url></hudson.plugins.git.UserRemoteConfig></userRemoteConfigs><branches><hudson.plugins.git.BranchSpec><name>*/$BRANCH</name></hudson.plugins.git.BranchSpec></branches><doGenerateSubmoduleConfigurations>false</doGenerateSubmoduleConfigurations><submoduleCfg class="empty-list"/><extensions/></scm>`;
  const definition = `<definition class="org.jenkinsci.plugins.workflow.cps.CpsScmFlowDefinition" plugin="workflow-cps">${scm}<scriptPath>Jenkinsfile</scriptPath><lightweight>false</lightweight></definition>`;
  return `<?xml version="1.0" encoding="UTF-8"?><flow-definition plugin="workflow-job"><description>${esc(description)}</description><keepDependencies>false</keepDependencies><properties><hudson.model.ParametersDefinitionProperty><parameterDefinitions>${params}</parameterDefinitions></hudson.model.ParametersDefinitionProperty></properties>${definition}<triggers/><disabled>false</disabled></flow-definition>`;
}
async function init() {
  const c = JSON.parse(await readFile(".local/jenkins-legacy/config.json", "utf8"));
  base = new URL(c.JENKINS_URL);
  if (base.protocol !== "https:" || base.hostname !== HOST || base.port || base.pathname !== "/" || base.username || base.password || base.search || base.hash) throw new Error("Refusing Jenkins outside approved SG HTTPS origin");
  if (!c.JENKINS_USER || !c.JENKINS_API_TOKEN) throw new Error("Jenkins credentials missing");
  authorization = auth(c); base.pathname = "/";
  const gitea = JSON.parse(await readFile(".local/jenkins-test/zeabur/gitea-access.json", "utf8"));
  if (!gitea.user) throw new Error("Synthetic Gitea repository owner is not configured");
  repositoryOwner = gitea.user;
  if (!gitea.password) throw new Error("Synthetic Gitea API credentials are incomplete");
  giteaBase = new URL(`https://${PUBLIC_GITEA_HOST}/`);
  giteaAuthorization = `Basic ${Buffer.from(`${gitea.user}:${gitea.password}`).toString("base64")}`;
  const ver = await request("api/json?tree=jobs[name,fullName]");
  if (ver.headers.get("x-jenkins") !== "2.263.1") throw new Error(`Expected Jenkins 2.263.1; got ${ver.headers.get("x-jenkins") || "unknown"}`);
  return ver.value.jobs || [];
}
export async function seed() {
  const jobs = await init();
  const repository = await ensureSyntheticRepository();
  const dir = resolve(EVIDENCE);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const repoEvidence = resolve(dir, "pipeline-repository.json");
  await writeFile(repoEvidence, `${JSON.stringify({ repository, checkedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
  await import("node:fs/promises").then(({ chmod }) => chmod(repoEvidence, 0o600));
  for (const name of JOBS) {
    const old = await request(`${jpath(name)}api/json?tree=name,description`, { allow404: true });
    if (old && !String(old.value.description || "").startsWith("[sg-target]")) throw new Error(`Refusing to overwrite unmarked job ${name}`);
    const response = await request(old ? `${jpath(name)}config.xml` : `createItem?name=${encodeURIComponent(name)}`, { method: "POST", body: configXml(name), contentType: "application/xml; charset=UTF-8" });
    if (![200, 201].includes(response.status)) throw new Error(`Config rejected for ${name}`);
    console.log(`Ready: ${name}`);
  }
  return jobs.filter((j) => JOBS.includes(j.name)).map((j) => j.name);
}
async function postWithParameters(job, params) {
  const q = new URLSearchParams(params);
  const u = await request(`${jpath(job)}buildWithParameters?${q}`, { method: "POST" });
  return { status: u.status, queue: u.headers.get("location") };
}
async function pollBuild(job, initialNumber) {
  for (let i = 0; i < 180; i++) {
    const r = await request(`${jpath(job)}api/json?tree=builds[number,result,building,url]`);
    const b = r.value.builds?.find((x) => x.number > initialNumber);
    if (b && !b.building && b.result) return b;
    await new Promise((ok) => setTimeout(ok, 3000));
  }
  throw new Error(`Timed out waiting for ${job}`);
}
async function pollBuildStarted(job, initialNumber) {
  for (let i = 0; i < 120; i++) {
    const r = await request(`${jpath(job)}api/json?tree=builds[number,result,building,url]`);
    const b = r.value.builds?.find((x) => x.number > initialNumber);
    if (b && b.building) return b;
    if (b && !b.building) throw new Error(`Build ${job} #${b.number} ended before input gate`);
    await new Promise((ok) => setTimeout(ok, 1500));
  }
  throw new Error(`Timed out starting ${job}`);
}
async function currentNumber(job) {
  const r = await request(`${jpath(job)}api/json?tree=nextBuildNumber`);
  return (r.value.nextBuildNumber || 1) - 1;
}
async function readBranchCandidates(job) {
  if (!JOBS.includes(job)) throw new Error("Refusing candidate lookup outside target jobs");
  const r = await request(`${jpath(job)}descriptorByName/net.uaznia.lukanus.hudson.plugins.gitparameter.GitParameterDefinition/fillValueItems?param=BRANCH`);
  if (r.value.errors?.length) throw new Error(`${job}: Git Parameter candidate lookup failed: ${r.value.errors.join("; ")}`);
  return r.value.values || [];
}
async function awaitInput(job, number) {
  for (let i = 0; i < 120; i++) {
    const r = await request(`${jpath(job)}${number}/wfapi/pendingInputActions`);
    const input = Array.isArray(r.value) ? r.value[0] : (r.value?.inputs || [])[0];
    if (input) return input;
    await new Promise((ok) => setTimeout(ok, 1500));
  }
  throw new Error(`No input stage appeared for ${job} #${number}`);
}
async function runHistory(selectedScenarios = scenarios) {
  await seed();
  const repo = await giteaRequest(repositoryPath());
  const branchResults = await Promise.all([giteaRequest(repositoryPath("/branches/master")), giteaRequest(repositoryPath("/branches/develop"))]);
  const repository = { name: REPO, owner: repositoryOwner, private: repo.value.private, description: repo.value.description, branches: Object.fromEntries(branchResults.map((r) => [r.value.name, r.value.commit.id])) };
  const evidence = { target: HOST, repository, jobs: [], scenarios: [] };
  for (const job of JOBS) {
    const meta = await request(`${jpath(job)}api/json?tree=nextBuildNumber,property[parameterDefinitions[name,type,choices,defaultParameterValue[value]]]`);
    evidence.jobs.push({ name: job, parameters: meta.value.property?.flatMap((p) => p.parameterDefinitions || []) || [], gitParameterCandidates: await readBranchCandidates(job) });
  }
  for (const item of selectedScenarios) {
    const jobEvidence = evidence.jobs.find((j) => j.name === item.job);
    const namesBefore = jobEvidence.gitParameterCandidates.map((v) => v.name || v.value || String(v));
    if (!namesBefore.length && (item.branch !== "master" || item.bootstrap !== true && item.job === JOBS[1])) throw new Error(`${item.job}: run the master bootstrap before selecting branch ${item.branch}`);
    if (namesBefore.length && !namesBefore.includes(item.branch)) throw new Error(`${item.job}: requested branch ${item.branch} is not currently offered`);
    const before = await currentNumber(item.job);
    const params = Object.fromEntries(Object.entries(item).filter(([k]) => !["job", "branch", "DEMO_NOTE", "expectedResult", "bootstrap"].includes(k)));
    params.BRANCH = item.branch;
    if (item.DEMO_NOTE) params.DEMO_NOTE = item.DEMO_NOTE;
    const row = { ...item, state: "queued" };
    evidence.scenarios.push(row);
    await mkdir(EVIDENCE, { recursive: true, mode: 0o700 });
    const evidencePath = resolve(EVIDENCE, "pipeline-builds.json");
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
    await import("node:fs/promises").then(({ chmod }) => chmod(evidencePath, 0o600));
    await postWithParameters(item.job, params);
    const build = item.DEMO_NOTE?.startsWith("input ") ? await pollBuildStarted(item.job, before) : await pollBuild(item.job, before);
    Object.assign(row, { state: "building", number: build.number, url: build.url, result: build.result });
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
    if (item.DEMO_NOTE?.startsWith("input ")) {
      const input = await awaitInput(item.job, build.number);
      row.inputId = input.id;
      const inputPath = `${jpath(item.job)}${build.number}/input/${encodeURIComponent(input.id)}/`;
      if (item.DEMO_NOTE === "input aborted") {
        const abort = await request(`${inputPath}abort`, { method: "POST", allowRedirect: true });
        row.inputAction = "abort"; row.abortStatus = abort.status;
        const ended = await pollBuild(item.job, build.number - 1); row.result = ended.result;
      } else {
        const proceed = await request(`${inputPath}proceedEmpty`, { method: "POST", allowRedirect: true });
        row.inputAction = "proceed"; row.proceedStatus = proceed.status;
        const ended = await pollBuild(item.job, build.number - 1); row.result = ended.result;
      }
    }
    const wf = await request(`${jpath(item.job)}${build.number}/wfapi/describe`);
    const detail = await request(`${jpath(item.job)}${build.number}/api/json?tree=number,result,building,actions[parameters[name,value]],artifacts[fileName,relativePath]`);
    const artifacts = detail.value.artifacts || [];
    row.stages = (wf.value.stages || []).map(({ name, status }) => ({ name, status }));
    row.parametersReadback = detail.value.actions?.flatMap((a) => a.parameters || []) || [];
    row.artifacts = [];
    for (const a of artifacts) {
      if (a.fileName === "checked-out-sha.txt" || a.fileName === "checked-out-branch.txt") {
        const content = await request(`${jpath(item.job)}${build.number}/artifact/${a.relativePath}`);
        row.artifacts.push({ fileName: a.fileName, content: content.value });
      }
    }
    const branchParam = row.parametersReadback.find((p) => p.name === "BRANCH")?.value;
    if (branchParam !== item.branch) throw new Error(`${item.job} #${build.number}: BRANCH readback ${branchParam} did not match requested ${item.branch}`);
    const wantedParams = { TARGET_ENV: item.TARGET_ENV, ...(item.RESULT_MODE ? { RESULT_MODE: item.RESULT_MODE } : {}), ...(item.DEMO_NOTE ? { DEMO_NOTE: item.DEMO_NOTE } : {}), ...(item.RUN_EXTRA_CHECKS !== undefined ? { RUN_EXTRA_CHECKS: item.RUN_EXTRA_CHECKS } : {}) };
    for (const [name, value] of Object.entries(wantedParams)) {
      const actual = row.parametersReadback.find((p) => p.name === name)?.value;
      if (String(actual) !== String(value)) throw new Error(`${item.job} #${build.number}: parameter ${name} readback ${actual} did not match ${value}`);
    }
    const checkoutSHA = row.artifacts.find((a) => a.fileName === "checked-out-sha.txt")?.content?.trim();
    if (!/^[0-9a-f]{40}$/i.test(checkoutSHA || "")) throw new Error(`${item.job} #${build.number}: checked out SHA artifact missing or invalid`);
    if (checkoutSHA !== repository.branches[item.branch]) throw new Error(`${item.job} #${build.number}: checkout SHA did not match Gitea ${item.branch} commit`);
    if (row.result !== item.expectedResult) throw new Error(`${item.job} #${build.number}: expected ${item.expectedResult}, got ${row.result}`);
    const expectedStages = ["Checkout and identify", "Target environment validation", "Optional checks", "Package simulation", "Manual approval demonstration", "Result demonstration"];
    if (expectedStages.some((name) => !row.stages.some((stage) => stage.name === name))) throw new Error(`${item.job} #${build.number}: one or more of the six Declarative stages are missing`);
    const gate = row.stages.find((stage) => stage.name === "Manual approval demonstration");
    const skipped = ["SKIPPED", "NOT_EXECUTED"];
    const optional = row.stages.find((stage) => stage.name === "Optional checks");
    if (item.RUN_EXTRA_CHECKS === false && !skipped.includes(optional.status)) throw new Error(`${item.job} #${build.number}: Boolean false should skip Optional checks, got ${optional.status}`);
    if (item.RUN_EXTRA_CHECKS === true && optional.status !== "SUCCESS") throw new Error(`${item.job} #${build.number}: Boolean true should run Optional checks, got ${optional.status}`);
    if (item.DEMO_NOTE?.startsWith("input ") && item.DEMO_NOTE === "input aborted" && !["ABORTED", "FAILED"].includes(gate.status)) throw new Error(`${item.job} #${build.number}: expected an aborted input stage, got ${gate.status}`);
    if (item.DEMO_NOTE?.startsWith("input ") && item.DEMO_NOTE === "input resumed" && gate.status !== "SUCCESS") throw new Error(`${item.job} #${build.number}: expected input continuation, got ${gate.status}`);
    if (!item.DEMO_NOTE?.startsWith("input ") && !skipped.includes(gate.status)) throw new Error(`${item.job} #${build.number}: expected the input stage to be skipped, got ${gate.status}`);
    row.checkoutSHA = checkoutSHA;
    row.state = "verified";
    jobEvidence.gitParameterCandidates = await readBranchCandidates(item.job);
    const choices = jobEvidence.gitParameterCandidates.map((v) => v.name || v.value || String(v));
    if (!choices.includes("master") || !choices.includes("develop")) throw new Error(`${item.job} #${build.number}: Git Parameter did not offer master/develop after SCM checkout: ${choices.join(",")}`);
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
    await import("node:fs/promises").then(({ chmod }) => chmod(evidencePath, 0o600));
    console.log(`${item.job} #${build.number}: ${row.result}`);
  }
  const path = resolve(EVIDENCE, "pipeline-builds.json");
  console.log(`Evidence saved: ${path}`);
  return evidence;
}
async function verifyHistory() {
  await init();
  const path = resolve(EVIDENCE, "pipeline-builds.json");
  const evidence = JSON.parse(await readFile(path, "utf8"));
  const repoEvidence = JSON.parse(await readFile(resolve(EVIDENCE, "pipeline-repository.json"), "utf8"));
  if (evidence.target !== HOST || repoEvidence.repository.name !== REPO) throw new Error("Saved evidence does not belong to this target fixture");
  const verified = [];
  for (const item of scenarios) {
    const row = evidence.scenarios.find((candidate) => candidate.job === item.job && candidate.branch === item.branch && (candidate.DEMO_NOTE || "") === (item.DEMO_NOTE || "") && candidate.RUN_EXTRA_CHECKS === item.RUN_EXTRA_CHECKS);
    if (!row?.number) throw new Error(`No recorded build for ${item.job} ${item.branch} ${item.DEMO_NOTE || item.RUN_EXTRA_CHECKS}`);
    const [wf, detail] = await Promise.all([
      request(`${jpath(item.job)}${row.number}/wfapi/describe`),
      request(`${jpath(item.job)}${row.number}/api/json?tree=number,result,building,actions[parameters[name,value]],artifacts[fileName,relativePath]`),
    ]);
    if (detail.value.building || detail.value.result !== item.expectedResult) throw new Error(`${item.job} #${row.number}: expected completed ${item.expectedResult}, got ${detail.value.result}`);
    row.parametersReadback = detail.value.actions?.flatMap((a) => a.parameters || []) || [];
    for (const [name, value] of Object.entries({ BRANCH: item.branch, TARGET_ENV: item.TARGET_ENV, ...(item.RESULT_MODE ? { RESULT_MODE: item.RESULT_MODE } : {}), ...(item.DEMO_NOTE ? { DEMO_NOTE: item.DEMO_NOTE } : {}), ...(item.RUN_EXTRA_CHECKS !== undefined ? { RUN_EXTRA_CHECKS: item.RUN_EXTRA_CHECKS } : {}) })) {
      const actual = row.parametersReadback.find((p) => p.name === name)?.value;
      if (String(actual) !== String(value)) throw new Error(`${item.job} #${row.number}: parameter ${name} mismatch`);
    }
    row.stages = (wf.value.stages || []).map(({ name, status }) => ({ name, status }));
    const stageNames = ["Checkout and identify", "Target environment validation", "Optional checks", "Package simulation", "Manual approval demonstration", "Result demonstration"];
    if (stageNames.some((name) => !row.stages.some((stage) => stage.name === name))) throw new Error(`${item.job} #${row.number}: missing Declarative stage`);
    const skipped = ["SKIPPED", "NOT_EXECUTED"];
    const optional = row.stages.find((s) => s.name === "Optional checks");
    const gate = row.stages.find((s) => s.name === "Manual approval demonstration");
    if (item.RUN_EXTRA_CHECKS === false && !skipped.includes(optional.status)) throw new Error(`${item.job} #${row.number}: Boolean false stage status ${optional.status}`);
    if (item.RUN_EXTRA_CHECKS === true && optional.status !== "SUCCESS") throw new Error(`${item.job} #${row.number}: Boolean true stage status ${optional.status}`);
    if (item.DEMO_NOTE === "input aborted" && !["ABORTED", "FAILED"].includes(gate.status)) throw new Error(`${item.job} #${row.number}: input abort stage status ${gate.status}`);
    if (item.DEMO_NOTE === "input resumed" && gate.status !== "SUCCESS") throw new Error(`${item.job} #${row.number}: input continuation stage status ${gate.status}`);
    if (!item.DEMO_NOTE?.startsWith("input ") && !skipped.includes(gate.status)) throw new Error(`${item.job} #${row.number}: unexpected input stage status ${gate.status}`);
    row.artifacts = [];
    for (const artifact of detail.value.artifacts || []) {
      if (["checked-out-sha.txt", "checked-out-branch.txt"].includes(artifact.fileName)) {
        const content = await request(`${jpath(item.job)}${row.number}/artifact/${artifact.relativePath}`);
        row.artifacts.push({ fileName: artifact.fileName, content: content.value });
      }
    }
    row.checkoutSHA = row.artifacts.find((a) => a.fileName === "checked-out-sha.txt")?.content?.trim();
    if (row.checkoutSHA !== repoEvidence.repository.branches[item.branch]) throw new Error(`${item.job} #${row.number}: archived checkout SHA mismatch`);
    row.result = detail.value.result;
    row.expectedResult = item.expectedResult;
    row.state = "verified";
    row.gitParameterCandidates = await readBranchCandidates(item.job);
    const choices = row.gitParameterCandidates.map((v) => v.value);
    if (!choices.includes("master") || !choices.includes("develop")) throw new Error(`${item.job}: live Git Parameter candidates incomplete`);
    verified.push({ job: item.job, number: row.number, result: row.result, stageCount: row.stages.length, checkoutSHA: row.checkoutSHA, candidates: choices });
    await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  }
  const verification = { target: HOST, checkedAt: new Date().toISOString(), noBuildsTriggered: true, scenarios: verified };
  const verificationPath = resolve(EVIDENCE, "pipeline-verification.json");
  await writeFile(verificationPath, `${JSON.stringify(verification, null, 2)}\n`, { mode: 0o600 });
  await import("node:fs/promises").then(({ chmod }) => chmod(verificationPath, 0o600));
  console.log(`Read-only verification saved: ${verificationPath}`);
  return verification;
}
if (main) {
  if (process.argv.includes("--seed")) await seed();
  else if (process.argv.includes("--run")) await runHistory();
  else if (process.argv.includes("--smoke")) await runHistory(scenarios.slice(0, 1));
  else if (process.argv.includes("--verify")) await verifyHistory();
  else throw new Error("Use --seed, --run, or --verify");
}
