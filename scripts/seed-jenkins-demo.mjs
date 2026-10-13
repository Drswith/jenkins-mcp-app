import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Explicit opt-in: this creates demo repositories/jobs and runs builds on the cloud test controller.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain && !process.argv.includes("--run") && !process.argv.includes("--verify")) {
  throw new Error("Use --run to create/run demo data, or --verify to read the existing dataset.");
}
const directory = resolve(".local/jenkins-demo");
await mkdir(directory, { recursive: true, mode: 0o700 });
const config = JSON.parse(await readFile(process.env.JENKINS_CONFIG_FILE || ".local/jenkins-test/zeabur/config.json", "utf8"));
const gitAccess = JSON.parse(await readFile(".local/jenkins-test/zeabur/gitea-access.json", "utf8"));
const jenkinsUrl = new URL(config.JENKINS_URL);
const giteaUrl = new URL(process.env.GITEA_DEMO_URL || "https://gitea-drs-sg.zeabur.app/");
if (jenkinsUrl.hostname !== "jenkins-mcp-drs-sg.zeabur.app" || giteaUrl.hostname !== "gitea-drs-sg.zeabur.app") {
  throw new Error("This seed script is restricted to the SG demo services.");
}
const internalGit = "http://service-6acce8de4873e494859dc96e:3000";
const basic = (user, password) => `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
const jenkinsAuth = basic(config.JENKINS_USER, config.JENKINS_API_TOKEN);
const giteaAuth = basic(gitAccess.user, gitAccess.password);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const xml = (value) => String(value).replace(/[<>&"']/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[char]);
const jobPath = (name) => name.split("/").map((part) => `job/${encodeURIComponent(part)}`).join("/") + "/";
const repoPath = (repo) => `api/v1/repos/${gitAccess.user}/${repo}`;
const repositories = [
  { name: "demo-web-portal", title: "前端门户", feature: "feature/dashboard", file: "src/index.html", content: "<!doctype html><title>Demo portal</title><h1>Jenkins / Gitea demo portal</h1>\n" },
  { name: "demo-order-api", title: "订单 API", feature: "feature/order-validation", file: "src/order-rules.json", content: '{"minimumAmount":1,"currency":"CNY","demo":true}\n' },
  { name: "demo-infra-config", title: "环境配置", feature: "feature/sg-health", file: "environments/sg.json", content: '{"region":"SG","replicas":1,"demo":true}\n' },
];
const jobs = [
  { name: "demo-web-build", title: "前端构建与资源打包", repo: "demo-web-portal", results: ["success", "success", "failure", "success", "unstable", "success"] },
  { name: "demo-api-tests", title: "订单 API 测试与失败趋势", repo: "demo-order-api", results: ["success", "unstable", "success", "failure", "success", "unstable"] },
  { name: "demo-release-package", title: "参数化版本发布包（演示）", repo: "demo-web-portal", results: ["success", "success", "success", "success", "success", "success"] },
  { name: "demo-config-validation", title: "配置校验与失败日志", repo: "demo-infra-config", results: ["success", "failure", "success", "success", "failure", "failure"] },
  { name: "demo-deploy-preview", title: "预览发布计划（仅生成文件）", repo: "demo-web-portal", results: ["success", "failure", "success", "success", "success", "success"] },
  { name: "demo-long-log", title: "日志分页、搜索与警告", repo: "demo-infra-config", results: ["success", "failure", "success", "unstable", "success", "success"] },
  { name: "demo-cancelled", title: "运行中取消与恢复", repo: "demo-order-api", results: ["success", "aborted", "success", "aborted", "success", "aborted"] },
  { name: "demo-disabled", title: "保留历史的停用任务", repo: "demo-infra-config", results: ["success", "success", "success", "success", "success", "success"], disableAfter: true },
  { name: "demo-branches/web-dashboard", title: "前端功能分支", repo: "demo-web-portal", branch: "feature/dashboard", results: ["success", "unstable", "success", "success", "failure", "success"] },
  { name: "demo-branches/api-validation", title: "订单校验功能分支", repo: "demo-order-api", branch: "feature/order-validation", results: ["success", "failure", "success", "unstable", "success", "unstable"] },
];

async function request(base, authorization, path, { method = "GET", data, contentType, allow404 = false } = {}) {
  const url = new URL(path, base);
  if (url.origin !== base.origin) throw new Error("Request escaped demo service");
  const headers = { Authorization: authorization };
  let body;
  if (data !== undefined) { headers["Content-Type"] = contentType === "application/xml" ? "application/xml; charset=UTF-8" : contentType || "application/json"; body = contentType ? data : JSON.stringify(data); }
  // Retry read-only requests only. A lost response must never duplicate a write/build.
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, { method, headers, body, redirect: "manual", signal: AbortSignal.timeout(30000) });
      if (response.status === 404 && allow404) return null;
      if (!response.ok && ![302, 303].includes(response.status)) throw new Error(`${method} ${url.pathname}: HTTP ${response.status}`);
      const text = await response.text();
      let value; try { value = text ? JSON.parse(text) : null; } catch { value = text; }
      return { value, location: response.headers.get("location"), status: response.status };
    } catch (error) {
      if (method !== "GET" || attempt >= 2) throw error;
      await sleep(700 * (attempt + 1));
    }
  }
}
const j = (path, options) => request(jenkinsUrl, jenkinsAuth, path, options);
const g = (path, options) => request(giteaUrl, giteaAuth, path, options);
const buildScript = `#!/bin/sh
set -eu
mkdir -p reports artifacts
rm -f reports/*.xml artifacts/*
scenario=\${SCENARIO:-success}
version=\${RELEASE_VERSION:-1.0.0}
target=\${TARGET_ENV:-sg}
case "$scenario" in success|failure|unstable|aborted) ;; *) exit 2 ;; esac
case "$target" in dev|staging|sg) ;; *) exit 2 ;; esac
echo "[DEMO] Synthetic CI fixtures; no production deployment is performed."
echo "[INFO] job=$JOB_NAME build=$BUILD_NUMBER scenario=$scenario target=$target version=$version"
echo "[SCM] $(git log -1 --format='%h %s')"
test -s README.md && test -s VERSION && test -s ci/demo-build.sh
echo "[STAGE] checkout and configuration checks passed"
lines=\${LOG_LINES:-80}
case "$lines" in ''|*[!0-9]*) exit 2 ;; esac
[ "$lines" -le 3000 ] || exit 2
i=1
while [ "$i" -le "$lines" ]; do
  if [ $((i % 37)) -eq 0 ]; then
    printf '[WARN] Fixture retry checkpoint %04d: demo dependency responds slowly; retry budget remains.\\n' "$i"
  else
    printf '[INFO] Checkpoint %04d: validate route, transform fixture, verify checksum and collect diagnostics.\\n' "$i"
  fi
  i=$((i+1))
done
delay=\${RUN_SECONDS:-2}
case "$delay" in ''|*[!0-9]*) exit 2 ;; esac
[ "$delay" -le 45 ] || exit 2
sleep "$delay"
failures=0
[ "$scenario" != unstable ] || failures=2
printf '<testsuite name="DemoContractTests" tests="12" failures="%s" errors="0" skipped="1" time="2.4">\\n' "$failures" > reports/junit.xml
i=1
while [ "$i" -le 12 ]; do
  printf '<testcase classname="demo.ContractSuite" name="case_%02d" time="0.2">' "$i" >> reports/junit.xml
  if [ "$i" -eq 12 ]; then
    printf '<skipped message="Optional demo scenario"/>' >> reports/junit.xml
  elif [ "$failures" -gt 0 ] && [ "$i" -le 2 ]; then
    printf '<failure message="Intentional demo assertion mismatch">Expected fixture validation success; scenario=unstable</failure>' >> reports/junit.xml
    echo "[TEST-FAIL] case_$i intentional demo assertion mismatch"
  fi
  printf '</testcase>\\n' >> reports/junit.xml
  i=$((i+1))
done
printf '</testsuite>\\n' >> reports/junit.xml
printf 'Demo build\\nJob: %s\\nBuild: %s\\nVersion: %s\\nTarget: %s\\nScenario: %s\\n' "$JOB_NAME" "$BUILD_NUMBER" "$version" "$target" "$scenario" > artifacts/build-summary.txt
printf '{"demo":true,"version":"%s","target":"%s","scenario":"%s"}\\n' "$version" "$target" "$scenario" > artifacts/release-manifest.json
tar -czf artifacts/demo-package.tgz README.md VERSION ci reports
echo "[ARTIFACT] build-summary.txt release-manifest.json demo-package.tgz"
if [ "$scenario" = failure ]; then
  echo "[ERROR] Intentional demo packaging/configuration failure: invalid release fixture."
  exit 1
fi
echo "[STAGE] Completed demo build; JUnit failures=$failures"
`;

async function putFile(repo, path, content, message, branch = "master") {
  const endpoint = `${repoPath(repo)}/contents/${path}?ref=${encodeURIComponent(branch)}`;
  const existing = await g(endpoint, { allow404: true });
  if (existing && Buffer.from(existing.value.content || "", "base64").toString() === content) return existing.value;
  return (await g(`${repoPath(repo)}/contents/${path}`, { method: existing ? "PUT" : "POST", data: {
    branch, content: Buffer.from(content).toString("base64"), message,
    ...(existing ? { sha: existing.value.sha } : {}),
  } })).value;
}
async function branch(repo, name) {
  if (!await g(`${repoPath(repo)}/branches/${encodeURIComponent(name)}`, { allow404: true })) {
    await g(`${repoPath(repo)}/branches`, { method: "POST", data: { new_branch_name: name, old_ref_name: "master" } });
  }
}
async function tag(repo, name) {
  if (!await g(`${repoPath(repo)}/tags/${encodeURIComponent(name)}`, { allow404: true })) {
    await g(`${repoPath(repo)}/tags`, { method: "POST", data: { tag_name: name, target: "master", message: `DEMO milestone ${name}` } });
  }
}
async function seedRepositories() {
  for (const repo of repositories) {
    const existing = await g(repoPath(repo.name), { allow404: true });
    if (existing && !existing.value.description?.startsWith("[DEMO]")) throw new Error(`Refusing to modify an unmarked repository: ${repo.name}`);
    if (!existing) await g("api/v1/user/repos", { method: "POST", data: { name: repo.name, description: `[DEMO] ${repo.title} / Jenkins integration fixtures`, private: false, auto_init: true, default_branch: "master" } });
    await putFile(repo.name, "README.md", `# ${repo.title}演示仓库\n\n此仓库仅用于 Jenkins / Gitea 界面演示。全部业务数据为合成数据。\n\n包含 Git 变更、分支、标签、JUnit 测试报告和构建产物。\n`, "docs: explain synthetic CI demonstration");
    await putFile(repo.name, "VERSION", "0.1.0\n", "chore: initialize demo version");
    await putFile(repo.name, repo.file, repo.content, `feat: add ${repo.title} demo fixture`);
    await putFile(repo.name, "ci/demo-build.sh", buildScript, "ci: add deterministic demo scenarios and test reports");
    await branch(repo.name, repo.feature);
    await putFile(repo.name, "docs/feature-progress.md", `# Feature progress\n\n${repo.feature}: initial demo plan.\n`, "docs: start feature branch", repo.feature);
    await tag(repo.name, "v0.1.0-demo");
    console.log(`Repository ready: ${repo.name}`);
  }
}

const parametersXml = `<hudson.model.ParametersDefinitionProperty><parameterDefinitions>
  <hudson.model.ChoiceParameterDefinition><name>SCENARIO</name><description>演示预期结果</description><choices class="java.util.Arrays$ArrayList"><a class="string-array"><string>success</string><string>unstable</string><string>failure</string><string>aborted</string></a></choices></hudson.model.ChoiceParameterDefinition>
  <hudson.model.ChoiceParameterDefinition><name>TARGET_ENV</name><description>演示目标，不执行真实发布</description><choices class="java.util.Arrays$ArrayList"><a class="string-array"><string>sg</string><string>staging</string><string>dev</string></a></choices></hudson.model.ChoiceParameterDefinition>
  ${[['RELEASE_VERSION', '1.0.0'], ['LOG_LINES', '80'], ['RUN_SECONDS', '2']].map(([name, value]) => `<hudson.model.StringParameterDefinition><name>${name}</name><description>Demo fixture parameter</description><defaultValue>${value}</defaultValue><trim>true</trim></hudson.model.StringParameterDefinition>`).join("\n")}
</parameterDefinitions></hudson.model.ParametersDefinitionProperty>`;
function jobXml(job) {
  return `<?xml version="1.0" encoding="UTF-8"?><project>
<actions/><description>${xml(`[演示数据] ${job.title}。真实执行合成测试场景，不连接生产系统。`)}</description><keepDependencies>false</keepDependencies>
<properties><jenkins.model.BuildDiscarderProperty><strategy class="hudson.tasks.LogRotator"><daysToKeep>-1</daysToKeep><numToKeep>100</numToKeep><artifactDaysToKeep>-1</artifactDaysToKeep><artifactNumToKeep>100</artifactNumToKeep></strategy></jenkins.model.BuildDiscarderProperty>${parametersXml.replace("</parameterDefinitions>", `${job.parameterXml || ""}</parameterDefinitions>`)}</properties>
<scm class="hudson.plugins.git.GitSCM" plugin="git"><configVersion>2</configVersion><userRemoteConfigs><hudson.plugins.git.UserRemoteConfig><url>${internalGit}/${gitAccess.user}/${job.repo}.git</url>${job.credentialId ? `<credentialsId>${xml(job.credentialId)}</credentialsId>` : ""}</hudson.plugins.git.UserRemoteConfig></userRemoteConfigs><branches><hudson.plugins.git.BranchSpec><name>${xml(job.branch?.startsWith("refs/") ? job.branch : `*/${job.branch || "master"}`)}</name></hudson.plugins.git.BranchSpec></branches><doGenerateSubmoduleConfigurations>false</doGenerateSubmoduleConfigurations><submoduleCfg class="empty-list"/><extensions/></scm>
<canRoam>true</canRoam><disabled>false</disabled><blockBuildWhenDownstreamBuilding>false</blockBuildWhenDownstreamBuilding><blockBuildWhenUpstreamBuilding>false</blockBuildWhenUpstreamBuilding><triggers/><concurrentBuild>false</concurrentBuild>
<builders><hudson.tasks.Shell><command>${xml(job.command || "sh ci/demo-build.sh")}</command></hudson.tasks.Shell></builders>
<publishers><hudson.tasks.junit.JUnitResultArchiver plugin="junit"><testResults>reports/*.xml</testResults><keepLongStdio>false</keepLongStdio><testDataPublishers/><healthScaleFactor>1.0</healthScaleFactor><allowEmptyResults>${job.allowEmptyResults ?? true}</allowEmptyResults><skipPublishingChecks>true</skipPublishingChecks></hudson.tasks.junit.JUnitResultArchiver><hudson.tasks.ArtifactArchiver><artifacts>artifacts/*</artifacts><allowEmptyArchive>true</allowEmptyArchive><onlyIfSuccessful>false</onlyIfSuccessful><fingerprint>false</fingerprint><defaultExcludes>true</defaultExcludes><caseSensitive>true</caseSensitive><followSymlinks>false</followSymlinks></hudson.tasks.ArtifactArchiver></publishers><buildWrappers/>
</project>`;
}
async function seedJobs() {
  const plugins = (await j("pluginManager/api/json?tree=plugins[shortName,active]")).value.plugins;
  for (const required of ["git", "junit", "cloudbees-folder"]) if (!plugins.some((p) => p.shortName === required && p.active)) throw new Error(`Required plugin inactive: ${required}`);
  if (!await j("job/demo-branches/api/json", { allow404: true })) {
    await j("createItem?name=demo-branches", { method: "POST", contentType: "application/xml", data: '<com.cloudbees.hudson.plugins.folder.Folder plugin="cloudbees-folder"><description>[演示数据] 功能分支构建分组</description><properties/><folderViews class="com.cloudbees.hudson.plugins.folder.views.DefaultFolderViewHolder"><views><hudson.model.AllView><name>All</name><filterExecutors>false</filterExecutors><filterQueue>false</filterQueue><properties class="hudson.model.View$PropertyList"/></hudson.model.AllView></views><primaryView>All</primaryView><tabBar class="hudson.views.DefaultViewsTabBar"/></folderViews><healthMetrics/><icon class="com.cloudbees.hudson.plugins.folder.icons.StockFolderIcon"/></com.cloudbees.hudson.plugins.folder.Folder>' });
  }
  for (const job of jobs) {
    const existing = await j(`${jobPath(job.name)}api/json?tree=name,description`, { allow404: true });
    if (existing && !existing.value.description?.startsWith("[演示数据]")) throw new Error(`Refusing to modify an unmarked job: ${job.name}`);
    const parts = job.name.split("/");
    const path = existing ? `${jobPath(job.name)}config.xml` : `${parts.length > 1 ? jobPath(parts[0]) : ""}createItem?name=${encodeURIComponent(parts.at(-1))}`;
    await j(path, { method: "POST", data: jobXml(job), contentType: "application/xml" });
    console.log(`Job ready: ${job.name}`);
  }
}

async function status(job, sha, state, target, description) {
  await g(`${repoPath(job.repo)}/statuses/${sha}`, { method: "POST", data: { state, context: `jenkins/${job.name}`, target_url: target, description } });
}
const completed = [];
let reportWrites = Promise.resolve();
const reportPrefix = process.env.JENKINS_DEMO_REPORT_PREFIX || "";
if (!/^[a-z-]*$/.test(reportPrefix)) throw new Error("Invalid demo report prefix");
async function schedule(job, round) {
  // Read the exact job and parameter definitions before scheduling it.
  const current = (await j(`${jobPath(job.name)}api/json?tree=fullName,buildable,property[parameterDefinitions[name]]`)).value;
  if (current.fullName !== job.name || !current.buildable) throw new Error(`Job is not buildable: ${job.name}`);
  const scenario = job.results[round - 1];
  const parameters = { SCENARIO: scenario, TARGET_ENV: ["dev", "staging", "sg"][(round - 1) % 3], RELEASE_VERSION: `1.${round}.0-demo`, LOG_LINES: job.name === "demo-long-log" ? (round === 5 ? "2500" : "400") : String(45 + round * 10), RUN_SECONDS: scenario === "aborted" ? "45" : String(1 + (round % 3)), ...job.parameters };
  const defined = new Set(current.property.flatMap((p) => p.parameterDefinitions || []).map((p) => p.name));
  if (Object.keys(parameters).some((name) => !defined.has(name))) throw new Error(`Unrecognized parameters: ${job.name}`);
  const refPath = job.statusTag ? `tags/${encodeURIComponent(job.statusTag)}` : `branches/${encodeURIComponent(job.statusBranch || job.branch || "master")}`;
  const branchState = job.noCommitStatus ? null : (await g(`${repoPath(job.repo)}/${refPath}`)).value;
  const sha = branchState ? branchState.commit.id || branchState.commit.sha : null;
  if (sha) await status(job, sha, "pending", new URL(jobPath(job.name), jenkinsUrl).href, `DEMO round ${round}: queued`);
  const triggered = await j(`${jobPath(job.name)}buildWithParameters`, { method: "POST", contentType: "application/x-www-form-urlencoded", data: new URLSearchParams(parameters).toString() });
  const queue = new URL(triggered.location, jenkinsUrl);
  if (queue.origin !== jenkinsUrl.origin || !/^\/queue\/item\/\d+\/$/.test(queue.pathname)) throw new Error("Unexpected build queue URL");
  console.log(`Queued ${job.name} round ${round}: ${queue.href}`);
  return { job, round, scenario, sha, queue: `${queue.pathname.slice(1)}api/json`, submittedAt: Date.now() };
}
async function finishBuild(item) {
  let number;
  let stopped = false;
  while (Date.now() - item.submittedAt < 240000) {
    if (!number) {
      const queue = (await j(item.queue)).value;
      if (queue.cancelled) throw new Error(`Queue cancelled unexpectedly: ${item.job.name}`);
      number = queue.executable?.number;
    }
    if (number) {
      const path = `${jobPath(item.job.name)}${number}/`;
      const build = (await j(`${path}api/json?tree=number,result,building,duration,url,artifacts[fileName,relativePath],changeSet[items[commitId,msg]],changeSets[items[commitId,msg]],actions[totalCount,failCount,skipCount]`)).value;
      if (item.scenario === "aborted" && item.job.cancelOnStart !== false && build.building && !stopped) {
        await sleep(1200);
        await j(`${path}stop`, { method: "POST" });
        stopped = true;
      }
      if (!build.building && build.result) {
        const expected = { success: "SUCCESS", failure: "FAILURE", unstable: "UNSTABLE", aborted: "ABORTED" }[item.scenario];
        if (build.result !== expected) throw new Error(`Unexpected result ${item.job.name} #${number}: ${build.result}, expected ${expected}`);
        const tests = build.actions.find((action) => typeof action.totalCount === "number");
        const record = { job: item.job.name, round: item.round, number, result: build.result, duration: build.duration, url: build.url, artifacts: build.artifacts.length, tests: tests ? { total: tests.totalCount, failed: tests.failCount, skipped: tests.skipCount } : null, commits: (build.changeSets || [build.changeSet]).flatMap((set) => set?.items || []).length };
        completed.push(record);
        reportWrites = reportWrites.then(() => writeFile(resolve(directory, `${reportPrefix}builds.json`), `${JSON.stringify(completed, null, 2)}\n`));
        await reportWrites;
        if (item.sha) await status(item.job, item.sha, { SUCCESS: "success", FAILURE: "failure", UNSTABLE: "warning", ABORTED: "error" }[build.result], build.url, `DEMO round ${item.round}: ${build.result}`);
        console.log(`${record.result} ${record.job} #${record.number}: tests=${record.tests?.total || 0}, artifacts=${record.artifacts}`);
        return;
      }
    }
    await sleep(900);
  }
  throw new Error(`Build did not complete within four minutes: ${item.job.name}`);
}
async function roundData(round) {
  for (const repo of repositories) {
    await putFile(repo.name, "VERSION", `1.${round}.0-demo\n`, `chore: prepare ${repo.title} demo iteration ${round}`);
    await putFile(repo.name, "docs/feature-progress.md", `# Feature progress\n\nBranch: ${repo.feature}\nIteration: ${round}\nValidation: synthetic CI fixture.\n`, `feat: exercise ${repo.feature} iteration ${round}`, repo.feature);
    if (round === 3) { await branch(repo.name, "release/demo-v1"); await tag(repo.name, "v0.3.0-demo"); }
    if (round === 6) await tag(repo.name, "v1.0.0-demo");
  }
}
async function collaborationData() {
  for (const repo of repositories) {
    const issues = (await g(`${repoPath(repo.name)}/issues?state=all&limit=100`)).value;
    const titles = ["[演示] 修复偶发测试失败", "[演示] 增加构建结果仪表盘", "[演示] 发布前检查清单"];
    for (const [index, title] of titles.entries()) {
      if (!issues.some((issue) => issue.title === title)) await g(`${repoPath(repo.name)}/issues`, { method: "POST", data: { title, body: "用于演示 Issue、CI 结果和发布记录的合成数据。", closed: index === 0 } });
    }
    const pulls = (await g(`${repoPath(repo.name)}/pulls?state=all&limit=100`)).value;
    if (!pulls.some((pull) => pull.head.ref === repo.feature)) await g(`${repoPath(repo.name)}/pulls`, { method: "POST", data: { base: "master", head: repo.feature, title: `[演示] ${repo.title}功能分支待评审`, body: "合成演示功能，保留为开放 PR。CI 状态链接到真实 Jenkins 演示构建。" } });
    if (!pulls.some((pull) => pull.head.ref === "feature/demo-docs")) {
      await branch(repo.name, "feature/demo-docs");
      await putFile(repo.name, "docs/release-checklist.md", "# Demo release checklist\n\n- Review fixture changes\n- Inspect JUnit results\n- Download demo artifacts\n", "docs: add demo release checklist", "feature/demo-docs");
      const pull = (await g(`${repoPath(repo.name)}/pulls`, { method: "POST", data: { base: "master", head: "feature/demo-docs", title: `[演示] 合并${repo.title}发布说明`, body: "演示合并历史，仅包含合成文档。" } })).value;
      await g(`${repoPath(repo.name)}/pulls/${pull.number}/merge`, { method: "POST", data: { do: "merge", merge_title_field: "docs: merge demo release checklist", delete_branch_after_merge: false } });
    }
  }
}
async function verify(selectedJobs = jobs, selectedRepositories = repositories) {
  const jobSummaries = [];
  for (const job of selectedJobs) {
    const d = (await j(`${jobPath(job.name)}api/json?tree=fullName,color,buildable,builds[number,result,building,duration,artifacts[fileName]],healthReport[score,description]`)).value;
    jobSummaries.push({ name: d.fullName, color: d.color, buildable: d.buildable, builds: d.builds.length, results: d.builds.reduce((counts, build) => ({ ...counts, [build.result]: (counts[build.result] || 0) + 1 }), {}), artifacts: d.builds.reduce((count, build) => count + build.artifacts.length, 0), health: d.healthReport });
  }
  const repoSummaries = [];
  for (const repo of selectedRepositories) {
    const metadata = (await g(repoPath(repo.name))).value;
    const branches = (await g(`${repoPath(repo.name)}/branches?limit=100`)).value;
    const tags = (await g(`${repoPath(repo.name)}/tags?limit=100`)).value;
    const issues = (await g(`${repoPath(repo.name)}/issues?state=all&limit=100&type=issues`)).value;
    const pullResponse = await g(`${repoPath(repo.name)}/pulls?state=all&limit=100`, { allow404: metadata.archived || metadata.has_pull_requests === false });
    const pulls = pullResponse?.value || [];
    const releases = (await g(`${repoPath(repo.name)}/releases?limit=100`)).value;
    const labels = (await g(`${repoPath(repo.name)}/labels?limit=100`)).value;
    const milestones = (await g(`${repoPath(repo.name)}/milestones?state=all&limit=100`)).value;
    const commits = new Set();
    for (const branch of branches) {
      for (const commit of (await g(`${repoPath(repo.name)}/commits?sha=${encodeURIComponent(branch.name)}&limit=100`)).value) commits.add(commit.sha);
    }
    repoSummaries.push({ name: repo.name, url: new URL(`${gitAccess.user}/${repo.name}`, giteaUrl).href, archived: metadata.archived, commits: commits.size, branches: branches.map((b) => b.name), tags: tags.map((t) => t.name), issues: issues.length, pullRequestsAvailable: Boolean(pullResponse), openPulls: pulls.filter((p) => p.state === "open").length, mergedPulls: pulls.filter((p) => p.merged).length, closedUnmergedPulls: pulls.filter((p) => p.state === "closed" && !p.merged).length, releases: releases.length, draftReleases: releases.filter((r) => r.draft).length, releaseAssets: releases.reduce((count, r) => count + (r.assets || []).length, 0), labels: labels.length, milestones: milestones.map((m) => ({ title: m.title, state: m.state, open: m.open_issues, closed: m.closed_issues })) });
  }
  const summary = { recordedAt: new Date().toISOString(), jobs: jobSummaries, repositories: repoSummaries };
  await writeFile(resolve(directory, `${reportPrefix}summary.json`), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
}
if (isMain && process.argv.includes("--run")) {
  await seedRepositories();
  await seedJobs();
  for (let round = 1; round <= 6; round++) {
    await roundData(round);
    const pending = [];
    for (const job of jobs) pending.push(await schedule(job, round));
    await Promise.all(pending.map(finishBuild));
  }
  await collaborationData();
  for (const job of jobs.filter((job) => job.disableAfter)) await j(`${jobPath(job.name)}disable`, { method: "POST" });
}
if (isMain) await verify();

export { j, g, xml, jobPath, repoPath, gitAccess, jenkinsUrl, giteaUrl, internalGit, parametersXml, jobXml, putFile, branch, tag, schedule, finishBuild, verify, jobs, repositories, buildScript, sleep };
