import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain && !["--run", "--verify", "--git-metadata"].some((flag) => process.argv.includes(flag))) throw new Error("Use --run, --verify or --git-metadata");
if (isMain) process.env.JENKINS_DEMO_REPORT_PREFIX ||= "extended-";
const { j, g, xml, jobPath, repoPath, gitAccess, internalGit, parametersXml, jobXml, putFile, branch, tag, schedule, finishBuild, verify, jobs: baseJobs, repositories: baseRepositories, buildScript, sleep } = await import("./seed-jenkins-demo.mjs");

const privateRepository = { name: "demo-private-config", title: "私有配置仓库", feature: "feature/private-change" };
const standard = "sh ci/demo-build.sh\n";
const booleanParameter = "<hudson.model.BooleanParameterDefinition><name>RUN_EXTRA_CHECKS</name><description>演示布尔参数</description><defaultValue>true</defaultValue></hudson.model.BooleanParameterDefinition>";
const jobs = [
  { name: "demo-scm-checkout-failure", title: "不存在分支导致 SCM 检出失败", repo: "demo-web-portal", branch: "demo-intentionally-missing", statusBranch: "master", results: ["failure", "failure", "failure"] },
  { name: "demo-missing-test-report", title: "缺失 JUnit 文件导致发布器失败", repo: "demo-order-api", command: standard + "rm -f reports/*.xml", allowEmptyResults: false, results: ["failure", "failure", "failure"], parameters: { SCENARIO: "success" } },
  { name: "demo-skip-only-tests", title: "全部测试跳过", repo: "demo-order-api", command: standard + `printf '<testsuite name="SkippedDemo" tests="12" failures="0" errors="0" skipped="12">' > reports/junit.xml
i=1; while [ "$i" -le 12 ]; do printf '<testcase classname="demo.Skipped" name="optional_%s"><skipped message="Demo optional platform"/></testcase>' "$i" >> reports/junit.xml; i=$((i+1)); done
printf '</testsuite>\\n' >> reports/junit.xml`, results: ["success", "success", "success"] },
  { name: "demo-test-recovery", title: "连续测试失败后恢复为通过", repo: "demo-order-api", results: ["unstable", "unstable", "success", "success"] },
  { name: "demo-unicode-logs", title: "中文、emoji、ANSI 与标准错误日志", repo: "demo-web-portal", command: standard + String.raw`printf '\033[32m[中文] 界面构建通过 ✅\033[0m\n'
printf '[WARN] 这是合成的标准错误输出，不表示构建失败。\n' >&2
printf '生成的版本说明：%s / 环境：%s\n' "$RELEASE_VERSION" "$TARGET_ENV" > 'artifacts/版本说明.txt'`, results: ["success", "success", "success"] },
  { name: "demo-large-artifact", title: "较大二进制产物与校验文件", repo: "demo-web-portal", command: standard + "dd if=/dev/zero of=artifacts/demo-payload.bin bs=1024 count=256 2>/dev/null\nsha256sum artifacts/demo-payload.bin > artifacts/checksums.txt", results: ["success", "success", "success"] },
  { name: "demo-empty-artifacts", title: "成功但没有可下载产物", repo: "demo-infra-config", command: standard + "rm -f artifacts/*", results: ["success", "success", "success"] },
  { name: "demo-command-timeout", title: "命令真实超时退出 124", repo: "demo-infra-config", command: "echo '[DEMO] Bounded command timeout scenario'\ntimeout 2 sleep 8", results: ["failure", "failure", "failure"] },
  { name: "demo-private-checkout", title: "私有仓库使用只读 token 检出", repo: privateRepository.name, credentialId: "demo-gitea-readonly", results: ["success", "success", "success"] },
  { name: "demo-private-permission-failure", title: "私有仓库无凭据时检出失败", repo: privateRepository.name, results: ["failure", "failure", "failure"] },
  { name: "demo-platform/SG 运维/配置 校验", title: "三层目录与中文、空格任务名", repo: "demo-infra-config", parameterXml: booleanParameter, parameters: { RUN_EXTRA_CHECKS: true }, results: ["success", "failure", "success"] },
  { name: "demo-tag-checkout", title: "固定 Git 标签构建", repo: "demo-web-portal", branch: "refs/tags/v1.0.0-demo", statusTag: "v1.0.0-demo", results: ["success", "success", "success"] },
  { name: "demo-pipeline-release", title: "阶段、归档、布尔参数与下游构建链", repo: "demo-web-portal", pipeline: "release", parameterXml: booleanParameter, parameters: { RUN_EXTRA_CHECKS: true }, results: ["success", "failure", "unstable", "success"] },
  { name: "demo-pipeline-parallel", title: "并行校验分支与测试报告", repo: "demo-order-api", pipeline: "parallel", results: ["success", "unstable", "success", "success"] },
  { name: "demo-pipeline-recovery", title: "失败阶段与流水线恢复历史", repo: "demo-infra-config", pipeline: "recovery", results: ["failure", "failure", "success", "success"] },
  { name: "demo-never-built", title: "零构建历史的手动任务", repo: "demo-web-portal", results: [] },
];

const groovy = (value) => `'${String(value).replaceAll("\\", "\\\\").replaceAll("'", "\\'").replaceAll("\r", "\\r").replaceAll("\n", "\\n")}'`;
async function privateFixture() {
  const existing = await g(repoPath(privateRepository.name), { allow404: true });
  if (existing && !existing.value.description?.startsWith("[DEMO]")) throw new Error("Private repository is not marked as a demo");
  if (!existing) await g("api/v1/user/repos", { method: "POST", data: { name: privateRepository.name, description: "[DEMO] Private repository credential and permission scenarios; synthetic data only", private: true, auto_init: true, default_branch: "master" } });
  await putFile(privateRepository.name, "README.md", "# 私有仓库演示\n\n仅包含合成配置；用于验证只读凭据和无凭据的 SCM 场景。\n", "docs: explain private demo fixture");
  await putFile(privateRepository.name, "VERSION", "2.0.0-demo\n", "chore: initialize private fixture version");
  await putFile(privateRepository.name, "ci/demo-build.sh", buildScript, "ci: add private repository demo build");
  await branch(privateRepository.name, privateRepository.feature);
  await tag(privateRepository.name, "v2.0.0-demo");

  let token;
  try { token = JSON.parse(await readFile(".local/jenkins-demo/private-git-token.json", "utf8")).token; }
  catch (error) { if (error.code !== "ENOENT") throw new Error("Private demo token file is unreadable"); }
  if (!token) {
    const response = await g(`api/v1/users/${gitAccess.user}/tokens`, { method: "POST", data: { name: `demo-jenkins-readonly-${Date.now()}`, scopes: ["read:repository"] } });
    token = response.value.sha1;
    if (typeof token !== "string" || !token) throw new Error("Gitea did not return a token");
    await writeFile(".local/jenkins-demo/private-git-token.json", JSON.stringify({ token }), { mode: 0o600 });
  }
  // Install the scoped token into Jenkins' encrypted credentials store. Never print it.
  const script = `import com.cloudbees.plugins.credentials.CredentialsScope
import com.cloudbees.plugins.credentials.SystemCredentialsProvider
import com.cloudbees.plugins.credentials.domains.Domain
import com.cloudbees.plugins.credentials.impl.UsernamePasswordCredentialsImpl
def store = SystemCredentialsProvider.getInstance().getStore()
def domain = Domain.global()
def existing = store.getCredentials(domain).find { it.id == 'demo-gitea-readonly' }
if (existing && !existing.description.startsWith('[演示数据]')) throw new IllegalStateException('Credential ID belongs to another purpose')
def replacement = new UsernamePasswordCredentialsImpl(CredentialsScope.GLOBAL, 'demo-gitea-readonly', '[演示数据] Gitea repository read-only token', ${groovy(gitAccess.user)}, ${groovy(token)})
if (existing) store.updateCredentials(domain, existing, replacement)
else store.addCredentials(domain, replacement)
println('Demo read-only SCM credential installed')`;
  const result = await j("scriptText", { method: "POST", contentType: "application/x-www-form-urlencoded", data: new URLSearchParams({ script }).toString() });
  if (!String(result.value).includes("Demo read-only SCM credential installed")) throw new Error("Could not install the demo SCM credential");
  console.log("Private demo repository and read-only SCM credential ready.");
}
async function ensureFolder(name) {
  const existing = await j(`${jobPath(name)}api/json?tree=description,_class`, { allow404: true });
  if (existing) {
    if (!existing.value.description?.startsWith("[演示数据]")) throw new Error(`Unmarked folder: ${name}`);
    return;
  }
  const parts = name.split("/");
  const parent = parts.slice(0, -1).join("/");
  await j(`${parent ? jobPath(parent) : ""}createItem?name=${encodeURIComponent(parts.at(-1))}`, { method: "POST", contentType: "application/xml", data: '<com.cloudbees.hudson.plugins.folder.Folder plugin="cloudbees-folder"><description>[演示数据] 分层平台运维任务</description><properties/><healthMetrics/><icon class="com.cloudbees.hudson.plugins.folder.icons.StockFolderIcon"/></com.cloudbees.hudson.plugins.folder.Folder>' });
}
function pipelineXml(job) {
  const script = `node {
  stage('检出') {
    echo '[DEMO] Synthetic Pipeline fixture; no production deployment'
    checkout([$class: 'GitSCM', branches: [[name: '*/master']], userRemoteConfigs: [[url: ${groovy(`${internalGit}/${gitAccess.user}/${job.repo}.git`)}]], extensions: []])
  }
  try {
    ${job.pipeline === "parallel" ? `stage('并行校验') {
      parallel '静态检查': { sh 'test -s README.md && test -s VERSION'; echo 'Fixture lint passed' },
        '合成测试': { sh 'sh ci/demo-build.sh'; junit testResults: 'reports/*.xml', skipPublishingChecks: true }
    }` : `stage('构建') { sh 'sh ci/demo-build.sh' }
    stage('测试') { junit testResults: 'reports/*.xml', skipPublishingChecks: true }`}
    ${job.pipeline === "release" ? `stage('下游校验') {
      if (params.RUN_EXTRA_CHECKS) echo 'Boolean parameter enabled extra demo checks'
      build job: 'demo-config-validation', wait: false,
        parameters: [string(name: 'SCENARIO', value: 'success'), string(name: 'TARGET_ENV', value: 'sg'), string(name: 'RELEASE_VERSION', value: params.RELEASE_VERSION), string(name: 'RUN_SECONDS', value: '1')]
    }` : ""}
  } finally {
    stage('产物归档') { archiveArtifacts artifacts: 'artifacts/*', allowEmptyArchive: true }
  }
}`;
  return `<flow-definition plugin="workflow-job"><description>${xml(`[演示数据] ${job.title}。只处理合成仓库。`)}</description><keepDependencies>false</keepDependencies><properties><jenkins.model.BuildDiscarderProperty><strategy class="hudson.tasks.LogRotator"><daysToKeep>-1</daysToKeep><numToKeep>100</numToKeep><artifactDaysToKeep>-1</artifactDaysToKeep><artifactNumToKeep>100</artifactNumToKeep></strategy></jenkins.model.BuildDiscarderProperty>${parametersXml.replace("</parameterDefinitions>", `${job.parameterXml || ""}</parameterDefinitions>`)}</properties><definition class="org.jenkinsci.plugins.workflow.cps.CpsFlowDefinition" plugin="workflow-cps"><script>${xml(script)}</script><sandbox>true</sandbox></definition><triggers/><disabled>false</disabled></flow-definition>`;
}
async function seedJobs() {
  const plugins = (await j("pluginManager/api/json?tree=plugins[shortName,active]")).value.plugins;
  for (const required of ["workflow-job", "workflow-cps", "workflow-basic-steps", "workflow-durable-task-step", "workflow-scm-step", "pipeline-stage-view", "pipeline-build-step"]) {
    if (!plugins.some((p) => p.shortName === required && p.active)) throw new Error(`Required Pipeline plugin inactive: ${required}`);
  }
  await ensureFolder("demo-platform");
  await ensureFolder("demo-platform/SG 运维");
  for (const job of jobs) {
    const existing = await j(`${jobPath(job.name)}api/json?tree=description`, { allow404: true });
    if (existing && !existing.value.description?.startsWith("[演示数据]")) throw new Error(`Unmarked job: ${job.name}`);
    const parts = job.name.split("/");
    const parent = parts.slice(0, -1).join("/");
    await j(existing ? `${jobPath(job.name)}config.xml` : `${parent ? jobPath(parent) : ""}createItem?name=${encodeURIComponent(parts.at(-1))}`, { method: "POST", contentType: "application/xml", data: job.pipeline ? pipelineXml(job) : jobXml(job) });
    console.log(`Extended job ready: ${job.name}`);
  }
}
async function finishQueue() {
  for (let attempt = 0; attempt < 90; attempt++) {
    const queue = (await j("queue/api/json?tree=items[id]")).value.items;
    const active = (await j("computer/api/json?tree=computer[executors[currentExecutable[url]],oneOffExecutors[currentExecutable[url]]]")).value.computer.flatMap((computer) => [...(computer.executors || []), ...(computer.oneOffExecutors || [])]).some((executor) => executor.currentExecutable);
    if (!queue.length && !active) return;
    await sleep(1000);
  }
  throw new Error("Downstream builds are still active; inspect the queue before finishing");
}
async function gitReleaseData() {
  for (const repo of baseRepositories) {
    const path = repoPath(repo.name);
    if (!(await g(path)).value.description?.startsWith("[DEMO]")) throw new Error(`Unmarked repository: ${repo.name}`);
    const labels = (await g(`${path}/labels?limit=100`)).value;
    for (const [name, color] of [["demo:bug", "#d73a4a"], ["demo:feature", "#2da44e"], ["demo:ci", "#0969da"]]) {
      if (!labels.some((label) => label.name === name)) labels.push((await g(`${path}/labels`, { method: "POST", data: { name, color, description: "Synthetic demonstration label" } })).value);
    }
    const milestones = (await g(`${path}/milestones?state=all`)).value;
    for (const [title, state] of [["[演示] v1.0 验证完成", "closed"], ["[演示] v2.0 后续计划", "open"]]) {
      if (!milestones.some((milestone) => milestone.title === title)) milestones.push((await g(`${path}/milestones`, { method: "POST", data: { title, state, description: "仅用于展示开放、关闭和进度数据，不代表生产发布承诺。" } })).value);
    }
    const issues = (await g(`${path}/issues?state=all&type=issues&limit=100`)).value;
    for (const [index, issue] of issues.entries()) {
      if (!issue.title.startsWith("[演示]")) continue;
      const milestone = milestones.find((m) => m.state === (issue.state === "closed" ? "closed" : "open"));
      await g(`${path}/issues/${issue.number}`, { method: "PATCH", data: { milestone: milestone.id } });
      await g(`${path}/issues/${issue.number}/labels`, { method: "PUT", data: { labels: [labels[index % labels.length].id] } });
    }
    const releases = (await g(`${path}/releases?limit=100`)).value;
    for (const [tag, prerelease] of [["v0.3.0-demo", true], ["v1.0.0-demo", false]]) {
      if (!releases.some((release) => release.tag_name === tag)) await g(`${path}/releases`, { method: "POST", data: {
        tag_name: tag, name: `[演示] ${repo.title} ${tag}`, draft: false, prerelease,
        body: `合成发布记录，用于展示预发布与正式发布状态。没有部署生产系统。\n\n- 已完成真实 Git 检出和构建历史\n- [查看 Jenkins 任务](https://jenkins-mcp-drs-sg.zeabur.app/job/${repo.name === "demo-order-api" ? "demo-api-tests" : repo.name === "demo-web-portal" ? "demo-release-package" : "demo-config-validation"}/)\n- JUnit 报告、变更集与产物均可从构建历史查看。`,
      } });
    }
    console.log(`Release, labels and milestone data ready: ${repo.name}`);
  }
}
if (isMain && process.argv.includes("--run")) {
  await privateFixture();
  await seedJobs();
  for (let round = 1; round <= 4; round++) {
    for (const repo of [...baseRepositories, privateRepository]) {
      await putFile(repo.name, "docs/extended-ci-progress.md", `# Extended CI fixtures\n\nIteration: ${round}\nSynthetic SCM, reports, parameters and Pipeline scenarios.\n`, `ci: prepare extended demonstration iteration ${round}`);
    }
    const pending = [];
    for (const job of jobs.filter((job) => round <= job.results.length)) pending.push(await schedule(job, round));
    await Promise.all(pending.map(finishBuild));
  }
  await finishQueue();
  await gitReleaseData();
}
if (isMain && process.argv.includes("--git-metadata") && !process.argv.includes("--run")) await gitReleaseData();
if (isMain) await verify([...baseJobs, ...jobs], [...baseRepositories, privateRepository]);
export { jobs, privateRepository, finishQueue };
