import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const LEGACY_HOST = "jenkins-legacy-drs-sg.zeabur.app";
const GITEA_HOST = "gitea-drs-sg.zeabur.app";
const INTERNAL_GITEA = "http://service-6acce8de4873e494859dc96e:3000";
const DEFAULT_REPOSITORY = "demo-legacy-ci";
const JOBS = [
  { name: "legacy-demo-declarative", title: "Declarative stages、when、参数、测试报告与恢复历史", kind: "pipeline" },
  { name: "legacy-demo-git-parameter", title: "Git Parameter PT_BRANCH 分支选择", kind: "freestyle" },
  { name: "legacy-demo-git-parameter-pipeline", title: "Git Parameter 驱动 Pipeline SCM 分支", kind: "pipeline-scm" },
];

export const scenarioMatrix = Object.freeze({
  declarative: Object.freeze({
    job: "legacy-demo-declarative",
    parameterDefinitions: Object.freeze({
      TARGET_ENV: ["dev", "staging", "prod-demo"],
      MODE: ["success", "unstable", "failure"],
      RUN_EXTRA_CHECKS: [true, false],
      DEMO_MESSAGE: "中文消息 & <legacy demo> 'quoted'\n第二行 ✅",
    }),
    history: Object.freeze([
      { MODE: "success", TARGET_ENV: "dev", RUN_EXTRA_CHECKS: true, DEMO_MESSAGE: "中文成功 ✅" },
      { MODE: "unstable", TARGET_ENV: "staging", RUN_EXTRA_CHECKS: false, DEMO_MESSAGE: "中文测试不稳定" },
      { MODE: "failure", TARGET_ENV: "prod-demo", RUN_EXTRA_CHECKS: true, DEMO_MESSAGE: "中文故障场景" },
      { MODE: "success", TARGET_ENV: "staging", RUN_EXTRA_CHECKS: false, DEMO_MESSAGE: "恢复成功" },
    ]),
    expectedResults: ["SUCCESS", "UNSTABLE", "FAILURE", "SUCCESS"],
  }),
  gitParameter: Object.freeze({
    job: "legacy-demo-git-parameter",
    parameter: "BRANCH",
    type: "PT_BRANCH",
    expectedChoices: ["master", "develop"],
    history: Object.freeze([
      { BRANCH: "master" },
      { BRANCH: "develop" },
    ]),
    expectedResults: ["SUCCESS", "SUCCESS"],
    validates: "Each build checks out the selected branch, records git rev-parse HEAD and archives the SHA.",
  }),
  gitParameterPipeline: Object.freeze({
    job: "legacy-demo-git-parameter-pipeline",
    parameter: "BRANCH",
    type: "PT_BRANCH",
    expectedChoices: ["master", "develop"],
    history: Object.freeze([{ BRANCH: "master" }, { BRANCH: "develop" }]),
    expectedResults: ["SUCCESS", "SUCCESS"],
    validates: "CpsScmFlowDefinition resolves the selected branch's Declarative Jenkinsfile; each branch records its checked out HEAD.",
  }),
});

const xml = (value) => String(value).replace(/[<>&"']/g, (char) => ({
  "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;",
})[char]);
const jobPath = (name) => name.split("/").map((part) => `job/${encodeURIComponent(part)}`).join("/") + "/";
const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
const modes = process.argv.filter((arg) => ["--run", "--verify"].includes(arg));
if (isMain && modes.length !== 1) throw new Error("Use exactly one of --run or --verify");

async function loadConfig() {
  const configPath = resolve(".local/jenkins-legacy/config.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const baseUrl = new URL(config.JENKINS_URL);
  if (baseUrl.protocol !== "https:" || baseUrl.hostname !== LEGACY_HOST || baseUrl.port || baseUrl.pathname !== "/" || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    throw new Error(`Legacy seed is restricted to https://${LEGACY_HOST}/`);
  }
  if (!config.JENKINS_USER || !config.JENKINS_API_TOKEN) throw new Error("Legacy Jenkins credentials are incomplete");
  baseUrl.pathname = `${baseUrl.pathname.replace(/\/$/, "")}/`;

  const giteaAccess = JSON.parse(await readFile(".local/jenkins-test/zeabur/gitea-access.json", "utf8"));
  if (!giteaAccess.user || !giteaAccess.password) throw new Error("Gitea read credentials are incomplete");
  const giteaUrl = new URL(process.env.GITEA_DEMO_URL || `https://${GITEA_HOST}/`);
  if (giteaUrl.protocol !== "https:" || giteaUrl.hostname !== GITEA_HOST || giteaUrl.port || giteaUrl.pathname !== "/" || giteaUrl.username || giteaUrl.password || giteaUrl.search || giteaUrl.hash) {
    throw new Error(`Legacy seed is restricted to https://${GITEA_HOST}/ for Gitea metadata reads`);
  }
  giteaUrl.pathname = `${giteaUrl.pathname.replace(/\/$/, "")}/`;
  return { config, baseUrl, giteaUrl, giteaAccess, repository: DEFAULT_REPOSITORY };
}

const basic = (user, password) => `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
async function request(base, authorization, path, { method = "GET", body, contentType, allow404 = false } = {}) {
  const url = new URL(path, base);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) throw new Error("Request escaped configured demo service");
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: authorization,
      Accept: "application/json",
      ...(contentType ? { "Content-Type": contentType } : {}),
    },
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(30000),
  });
  if (response.status === 404 && allow404) return null;
  if (response.status >= 300 && response.status < 400) throw new Error(`${method} ${url.pathname}: unexpected redirect (${response.status})`);
  if (!response.ok) throw new Error(`${method} ${url.pathname}: HTTP ${response.status}`);
  const text = await response.text();
  let value;
  try { value = text ? JSON.parse(text) : null; } catch { value = text; }
  return { value, headers: response.headers, status: response.status };
}

function legacyParameterXml() {
  const choices = (name, description, values) => `<hudson.model.ChoiceParameterDefinition><name>${name}</name><description>${xml(description)}</description><choices class="java.util.Arrays$ArrayList"><a class="string-array">${values.map((value) => `<string>${xml(value)}</string>`).join("")}</a></choices></hudson.model.ChoiceParameterDefinition>`;
  const string = `<hudson.model.StringParameterDefinition><name>DEMO_MESSAGE</name><description>中文参数、XML转义和换行回读</description><defaultValue>${xml("中文默认值 & <value> 'quoted'\n第二行")}</defaultValue></hudson.model.StringParameterDefinition>`;
  const boolean = `<hudson.model.BooleanParameterDefinition><name>RUN_EXTRA_CHECKS</name><description>启用额外的合成检查阶段</description><defaultValue>true</defaultValue></hudson.model.BooleanParameterDefinition>`;
  return `<hudson.model.ParametersDefinitionProperty><parameterDefinitions>${choices("TARGET_ENV", "合成目标环境，不执行发布", ["dev", "staging", "prod-demo"])}${choices("MODE", "测试结果场景", ["success", "unstable", "failure"])}${boolean}${string}</parameterDefinitions></hudson.model.ParametersDefinitionProperty>`;
}

function pipelineJobXml(jenkinsFile) {
  const definition = `<definition class="org.jenkinsci.plugins.workflow.cps.CpsFlowDefinition" plugin="workflow-cps"><script>${xml(jenkinsFile)}</script><sandbox>true</sandbox></definition>`;
  return `<?xml version="1.0" encoding="UTF-8"?><flow-definition plugin="workflow-job"><description>${xml("[legacy-demo] Declarative pipeline fixture for Jenkins 2.263.1; synthetic jobs and results only.")}</description><keepDependencies>false</keepDependencies><properties><jenkins.model.BuildDiscarderProperty><strategy class="hudson.tasks.LogRotator"><daysToKeep>-1</daysToKeep><numToKeep>50</numToKeep><artifactDaysToKeep>-1</artifactDaysToKeep><artifactNumToKeep>50</artifactNumToKeep></strategy></jenkins.model.BuildDiscarderProperty>${legacyParameterXml()}</properties>${definition}<triggers/><disabled>false</disabled></flow-definition>`;
}

function gitParameterXml(repositoryUrl) {
  const parameter = gitParameterDefinitionXml(repositoryUrl, "e11f0c75-91eb-4578-ad55-923afeb7cc63");
  return `<?xml version="1.0" encoding="UTF-8"?><project><actions/><description>${xml("[legacy-demo] Git Parameter PT_BRANCH fixture; checks out the selected synthetic branch and records its commit SHA.")}</description><keepDependencies>false</keepDependencies><properties><jenkins.model.BuildDiscarderProperty><strategy class="hudson.tasks.LogRotator"><daysToKeep>-1</daysToKeep><numToKeep>50</numToKeep><artifactDaysToKeep>-1</artifactDaysToKeep><artifactNumToKeep>50</artifactNumToKeep></strategy></jenkins.model.BuildDiscarderProperty><hudson.model.ParametersDefinitionProperty><parameterDefinitions>${parameter}</parameterDefinitions></hudson.model.ParametersDefinitionProperty></properties><scm class="hudson.plugins.git.GitSCM" plugin="git"><configVersion>2</configVersion><userRemoteConfigs><hudson.plugins.git.UserRemoteConfig><name>origin</name><url>${xml(repositoryUrl)}</url></hudson.plugins.git.UserRemoteConfig></userRemoteConfigs><branches><hudson.plugins.git.BranchSpec><name>*/$BRANCH</name></hudson.plugins.git.BranchSpec></branches><doGenerateSubmoduleConfigurations>false</doGenerateSubmoduleConfigurations><submoduleCfg class="empty-list"/><extensions/></scm><canRoam>true</canRoam><disabled>false</disabled><blockBuildWhenDownstreamBuilding>false</blockBuildWhenDownstreamBuilding><blockBuildWhenUpstreamBuilding>false</blockBuildWhenUpstreamBuilding><triggers/><concurrentBuild>false</concurrentBuild><builders><hudson.tasks.Shell><command>set -eu\nmkdir -p artifacts\nactual_sha=$(git rev-parse HEAD)\ngrep -Fq "// [legacy-demo] fixture branch: $BRANCH" Jenkinsfile\nprintf '[legacy-demo] selected branch: %s\\n' "$BRANCH"\nprintf '[legacy-demo] checked out SHA: %s\\n' "$actual_sha"\nprintf 'branch=%s\\nsha=%s\\n' "$BRANCH" "$actual_sha" &gt; artifacts/legacy-branch.txt\n</command></hudson.tasks.Shell></builders><publishers><hudson.tasks.ArtifactArchiver><artifacts>artifacts/*</artifacts><allowEmptyArchive>false</allowEmptyArchive><onlyIfSuccessful>false</onlyIfSuccessful><fingerprint>false</fingerprint><defaultExcludes>true</defaultExcludes><caseSensitive>true</caseSensitive><followSymlinks>false</followSymlinks></hudson.tasks.ArtifactArchiver></publishers><buildWrappers/></project>`;
}

function gitParameterDefinitionXml(repositoryUrl, uuid) {
  const repositoryPattern = repositoryUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `<net.uaznia.lukanus.hudson.plugins.gitparameter.GitParameterDefinition plugin="git-parameter"><name>BRANCH</name><description>从合成仓库选择远程分支</description><uuid>${uuid}</uuid><type>PT_BRANCH</type><branch></branch><tagFilter>*</tagFilter><branchFilter>origin/(.*)</branchFilter><sortMode>ASCENDING_SMART</sortMode><defaultValue>master</defaultValue><selectedValue>DEFAULT</selectedValue><useRepository>${xml(repositoryPattern)}</useRepository><quickFilterEnabled>false</quickFilterEnabled><listSize>5</listSize></net.uaznia.lukanus.hudson.plugins.gitparameter.GitParameterDefinition>`;
}

function pipelineScmJobXml(repositoryUrl) {
  const gitParameter = gitParameterDefinitionXml(repositoryUrl, "27644b7b-6314-49ab-948a-8e5af6b45f63");
  const scm = `<scm class="hudson.plugins.git.GitSCM" plugin="git"><configVersion>2</configVersion><userRemoteConfigs><hudson.plugins.git.UserRemoteConfig><name>origin</name><url>${xml(repositoryUrl)}</url></hudson.plugins.git.UserRemoteConfig></userRemoteConfigs><branches><hudson.plugins.git.BranchSpec><name>*/$BRANCH</name></hudson.plugins.git.BranchSpec></branches><doGenerateSubmoduleConfigurations>false</doGenerateSubmoduleConfigurations><submoduleCfg class="empty-list"/><extensions/></scm>`;
  const definition = `<definition class="org.jenkinsci.plugins.workflow.cps.CpsScmFlowDefinition" plugin="workflow-cps">${scm}<scriptPath>Jenkinsfile</scriptPath><lightweight>false</lightweight></definition>`;
  return `<?xml version="1.0" encoding="UTF-8"?><flow-definition plugin="workflow-job"><description>${xml("[legacy-demo] Git Parameter PT_BRANCH selects a branch-specific Declarative Jenkinsfile from the synthetic repository.")}</description><keepDependencies>false</keepDependencies><properties><jenkins.model.BuildDiscarderProperty><strategy class="hudson.tasks.LogRotator"><daysToKeep>-1</daysToKeep><numToKeep>50</numToKeep><artifactDaysToKeep>-1</artifactDaysToKeep><artifactNumToKeep>50</artifactNumToKeep></strategy></jenkins.model.BuildDiscarderProperty><hudson.model.ParametersDefinitionProperty><parameterDefinitions>${gitParameter}</parameterDefinitions></hudson.model.ParametersDefinitionProperty></properties>${definition}<triggers/><disabled>false</disabled></flow-definition>`;
}

export { pipelineJobXml, gitParameterXml, pipelineScmJobXml };

async function serviceState(ctx) {
  const jenkinsAuth = basic(ctx.config.JENKINS_USER, ctx.config.JENKINS_API_TOKEN);
  const giteaAuth = basic(ctx.giteaAccess.user, ctx.giteaAccess.password);
  const [root, plugins, repo, master, develop] = await Promise.all([
    request(ctx.baseUrl, jenkinsAuth, "api/json?tree=jobs[name,fullName,_class]"),
    request(ctx.baseUrl, jenkinsAuth, "pluginManager/api/json?tree=plugins[shortName,active]"),
    request(ctx.giteaUrl, giteaAuth, `api/v1/repos/${encodeURIComponent(ctx.giteaAccess.user)}/${encodeURIComponent(ctx.repository)}`),
    request(ctx.giteaUrl, giteaAuth, `api/v1/repos/${encodeURIComponent(ctx.giteaAccess.user)}/${encodeURIComponent(ctx.repository)}/branches/master`, { allow404: true }),
    request(ctx.giteaUrl, giteaAuth, `api/v1/repos/${encodeURIComponent(ctx.giteaAccess.user)}/${encodeURIComponent(ctx.repository)}/branches/develop`, { allow404: true }),
  ]);
  const version = root.headers.get("x-jenkins") || null;
  const description = repo.value?.description || "";
  const expectedPlugins = ["git", "git-parameter", "junit", "workflow-job", "workflow-cps", "pipeline-model-definition"];
  const activePlugins = plugins.value.plugins.filter((plugin) => plugin.active).map((plugin) => plugin.shortName);
  const missingPlugins = expectedPlugins.filter((plugin) => !activePlugins.includes(plugin));
  const jobs = root.value.jobs || [];
  const repoBranches = {
    master: { exists: Boolean(master?.value?.name === "master"), sha: master?.value?.commit?.id || master?.value?.commit?.sha || null },
    develop: { exists: Boolean(develop?.value?.name === "develop"), sha: develop?.value?.commit?.id || develop?.value?.commit?.sha || null },
  };
  repoBranches.distinctShas = Boolean(repoBranches.master.sha && repoBranches.develop.sha && repoBranches.master.sha !== repoBranches.develop.sha);
  return {
    version,
    compatibleVersion: version === "2.263.1",
    repository: { name: ctx.repository, markedFixture: description.startsWith("[DEMO]"), private: repo.value.private, branches: repoBranches },
    plugins: { active: expectedPlugins.filter((plugin) => activePlugins.includes(plugin)), missing: missingPlugins },
    jobs: JOBS.map((job) => ({ name: job.name, exists: jobs.some((item) => item.fullName === job.name || item.name === job.name) })),
  };
}

export async function verifyLegacyDemo(ctx) {
  const state = await serviceState(ctx);
  const authorizationReady = state.compatibleVersion
    && state.repository.markedFixture
    && state.repository.private === false
    && state.repository.branches.master.exists
    && state.repository.branches.develop.exists
    && state.repository.branches.distinctShas
    && state.plugins.missing.length === 0;
  const jobs = await Promise.all(JOBS.map(async (job) => {
    const response = await request(ctx.baseUrl, basic(ctx.config.JENKINS_USER, ctx.config.JENKINS_API_TOKEN), `${jobPath(job.name)}api/json?tree=name,fullName,description,_class,buildable,property[parameterDefinitions[name,type,choices,defaultParameterValue[value]]],builds[number,result,building,url,artifacts[fileName,relativePath],actions[totalCount,failCount,skipCount]]`, { allow404: true });
    if (!response) return { name: job.name, exists: false, markedFixture: false, builds: [] };
    const value = response.value;
    return {
      name: value.fullName,
      exists: true,
      markedFixture: (value.description || "").startsWith("[legacy-demo]"),
      class: value._class,
      buildable: value.buildable,
      parameters: (value.property || []).flatMap((property) => property.parameterDefinitions || []).map((parameter) => ({
        name: parameter.name,
        type: parameter.type || parameter._class,
        choices: parameter.choices,
        defaultValue: parameter.defaultParameterValue?.value,
      })),
      builds: value.builds || [],
    };
  }));
  return { ...state, authorizationReady, verifiedJobs: jobs };
}

function assertReady(report) {
  if (!report.compatibleVersion) throw new Error(`Expected Jenkins 2.263.1; reported version: ${report.version || "unknown"}`);
  if (!report.repository.markedFixture || report.repository.private !== false) throw new Error("Git Parameter repository must be a public [DEMO]-marked synthetic repository");
  if (!report.repository.branches.master.exists || !report.repository.branches.develop.exists) throw new Error("Git Parameter fixture must have both master and develop branches");
  if (!report.repository.branches.distinctShas) throw new Error("Git Parameter fixture branches must point to different commits");
  if (report.plugins.missing.length) throw new Error(`Required active plugins missing: ${report.plugins.missing.join(", ")}`);
}

async function seedJobs(ctx) {
  const report = await serviceState(ctx);
  assertReady(report);
  const jenkinsAuth = basic(ctx.config.JENKINS_USER, ctx.config.JENKINS_API_TOKEN);
  const repoUrl = `${INTERNAL_GITEA}/${ctx.giteaAccess.user}/${ctx.repository}.git`;
  const pipeline = await readFile(resolve("test/legacy-jenkins/declarative.Jenkinsfile"), "utf8");
  const existingJobs = await Promise.all(JOBS.map(async (job) => ({
    job,
    existing: await request(ctx.baseUrl, jenkinsAuth, `${jobPath(job.name)}api/json?tree=name,description`, { allow404: true }),
  })));
  for (const { job, existing } of existingJobs) {
    if (existing && !String(existing.value.description || "").startsWith("[legacy-demo]")) {
      throw new Error(`Refusing to overwrite an unmarked job: ${job.name}`);
    }
  }
  for (const { job, existing } of existingJobs) {
    const path = existing ? `${jobPath(job.name)}config.xml` : `createItem?name=${encodeURIComponent(job.name)}`;
    const configXml = job.kind === "pipeline" ? pipelineJobXml(pipeline)
      : job.kind === "pipeline-scm" ? pipelineScmJobXml(repoUrl)
        : gitParameterXml(repoUrl);
    const result = await request(ctx.baseUrl, jenkinsAuth, path, { method: "POST", body: configXml, contentType: "application/xml; charset=UTF-8" });
    if (![200, 201].includes(result.status)) throw new Error(`Jenkins did not accept ${job.name} config (HTTP ${result.status})`);
    console.log(`Legacy demo job ready: ${job.name}`);
  }
}

if (isMain) {
  const ctx = await loadConfig();
  if (process.argv.includes("--run")) {
    await seedJobs(ctx);
    console.log(JSON.stringify(await verifyLegacyDemo(ctx), null, 2));
  } else {
    console.log(JSON.stringify(await verifyLegacyDemo(ctx), null, 2));
  }
}
