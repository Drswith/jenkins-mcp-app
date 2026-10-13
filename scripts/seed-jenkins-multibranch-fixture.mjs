import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

if (process.argv.length !== 3 || process.argv[2] !== "--run") {
  throw new Error("Use exactly --run to create the Gitea multibranch fixture");
}

const { g, repoPath, putFile, branch, gitAccess, giteaUrl, buildScript } = await import("./seed-jenkins-demo.mjs");
const repository = "demo-multibranch-lab";
const summaryPath = resolve(".local/jenkins-demo/multibranch-fixture-summary.json");
const planPath = resolve(".local/jenkins-demo/multibranch-webhook-verification.json");
const repoEndpoint = repoPath(repository);

const legacyJenkinsfile = `pipeline {
  agent any
  options { timeout(time: 60, unit: 'SECONDS') }
  stages {
    stage('Checkout and identify change') {
      steps {
        checkout scm
        echo "BRANCH_NAME=\${env.BRANCH_NAME ?: ''}"
        echo "CHANGE_ID=\${env.CHANGE_ID ?: ''}"
        echo "CHANGE_TARGET=\${env.CHANGE_TARGET ?: ''}"
        script {
          def scenario = readFile('ci/scenario.txt').trim()
          if (!(scenario in ['success', 'unstable', 'failure'])) {
            error("Unsupported demo scenario: \${scenario}")
          }
          env.SCENARIO = scenario
        }
      }
    }
    stage('Build and report') {
      steps {
        script {
          int status = sh(script: 'sh ci/demo-build.sh', returnStatus: true)
          junit 'reports/*.xml'
          if (status != 0) error("Demo build exited with status \${status}")
        }
      }
    }
  }
  post {
    always { archiveArtifacts artifacts: 'artifacts/*', allowEmptyArchive: true }
  }
}
`;

const jenkinsfile = `properties([
  disableConcurrentBuilds(),
  buildDiscarder(logRotator(daysToKeepStr: '60', numToKeepStr: '60', artifactDaysToKeepStr: '15', artifactNumToKeepStr: '15'))
])

timeout(time: 60, unit: 'SECONDS') {
  node {
    try {
      stage('检出与变更信息') {
        checkout scm
        echo "BRANCH_NAME=\${env.BRANCH_NAME ?: ''}"
        echo "CHANGE_ID=\${env.CHANGE_ID ?: ''}"
        echo "CHANGE_TARGET=\${env.CHANGE_TARGET ?: ''}"
        def scenario = readFile('ci/scenario.txt').trim()
        if (!(scenario in ['success', 'unstable', 'failure'])) {
          error("Unsupported demo scenario: \${scenario}")
        }
        env.SCENARIO = scenario
        env.RUN_SECONDS = '1'
        env.LOG_LINES = '25'
        env.TARGET_ENV = 'sg'
        env.RELEASE_VERSION = readFile('VERSION').trim()
        def expected = [success: 'SUCCESS', unstable: 'UNSTABLE', failure: 'FAILURE'][scenario]
        currentBuild.description = '[演示数据] synthetic=true expected=' + expected
      }
      stage('构建与报告') {
        int status = sh(returnStatus: true, script: 'sh ci/demo-build.sh')
        junit 'reports/*.xml'
        if (status != 0) error("Demo build exited with status \${status}")
      }
    } finally {
      stage('归档') {
        archiveArtifacts artifacts: 'artifacts/*', allowEmptyArchive: true
      }
    }
  }
}
`;

const files = {
  // Gitea auto-initializes this marked README when creating the public repo.
  "README.md": "# demo-multibranch-lab\n\n[DEMO] Synthetic Jenkins multibranch webhook fixture",
  "VERSION": "1.0.0-demo\n",
  "ci/demo-build.sh": buildScript,
  "ci/scenario.txt": "success\n",
  Jenkinsfile: jenkinsfile,
};

async function readFileAt(path, ref) {
  return g(`${repoEndpoint}/contents/${path}?ref=${encodeURIComponent(ref)}`, { allow404: true });
}

async function ensureExpectedContent(path, ref, expected) {
  const existing = await readFileAt(path, ref);
  if (existing) {
    const actual = Buffer.from(existing.value.content || "", "base64").toString("utf8");
    if (actual === expected) return "current";
    if (path === "Jenkinsfile" && actual === legacyJenkinsfile) return "legacy-template";
    throw new Error(`Refusing to overwrite unexpected fixture file ${ref}:${path}`);
  }
  return "missing";
}

async function ensureRepository() {
  const current = await g(repoEndpoint, { allow404: true });
  if (current) {
    if (!current.value.description?.startsWith("[DEMO]")) {
      throw new Error(`Refusing to modify unmarked repository: ${repository}`);
    }
    if (current.value.private) throw new Error(`Expected public demo repository: ${repository}`);
    return current.value;
  }
  return (await g("api/v1/user/repos", { method: "POST", data: {
    name: repository,
    description: "[DEMO] Synthetic Jenkins multibranch webhook fixture",
    private: false,
    auto_init: true,
    default_branch: "master",
  } })).value;
}

async function setFileIfMissing(path, content, message, ref) {
  const state = await ensureExpectedContent(path, ref, content);
  if (state === "missing" || state === "legacy-template") await putFile(repository, path, content, message, ref);
}

async function setScenario(ref, scenario) {
  const content = `${scenario}\n`;
  const current = await readFileAt("ci/scenario.txt", ref);
  const previous = current ? Buffer.from(current.value.content || "", "base64").toString("utf8") : null;
  if (previous === content) return;
  if (previous !== null && previous !== "success\n") {
    throw new Error(`Refusing to replace unexpected scenario file on ${ref}`);
  }
  await g(`${repoEndpoint}/contents/ci/scenario.txt`, { method: previous === null ? "POST" : "PUT", data: {
    branch: ref,
    content: Buffer.from(content).toString("base64"),
    message: `ci: select ${scenario} demo scenario`,
    ...(current ? { sha: current.value.sha } : {}),
  } });
}

async function ensurePullRequest() {
  const pulls = (await g(`${repoEndpoint}/pulls?state=all&limit=100`)).value;
  let pull = pulls.find((item) => item.head.ref === "feature/pr-auto" && item.base.ref === "master");
  if (pull) {
    if (!pull.title?.startsWith("[演示]") || !pull.body?.includes("[DEMO]") || pull.state !== "open") {
      throw new Error("Refusing to modify an unmarked or closed pull request for feature/pr-auto");
    }
    return pull;
  }
  pull = (await g(`${repoEndpoint}/pulls`, { method: "POST", data: {
    head: "feature/pr-auto",
    base: "master",
    title: "[演示] Multibranch PR discovery",
    body: "[DEMO] Open pull request for Jenkins multibranch and pull_request event verification. Synthetic documentation change only.",
  } })).value;
  if (!pull.title?.startsWith("[演示]") || pull.state !== "open") throw new Error("Pull request creation did not return an open marked PR");
  return pull;
}

const expectedBranches = ["master", "develop", "feature/pr-auto", "feature/no-jenkinsfile"];
const branchScenario = { master: "success", develop: "unstable", "feature/pr-auto": "success", "feature/no-jenkinsfile": "failure" };
const startedAt = Date.now();
await ensureRepository();

// Check existing master content before any file writes, so an already marked but
// unrelated repository cannot have its contents silently replaced.
for (const [path, content] of Object.entries(files)) await ensureExpectedContent(path, "master", content);
for (const ref of ["develop", "feature/pr-auto"]) await ensureExpectedContent("Jenkinsfile", ref, jenkinsfile);
for (const [path, content] of Object.entries(files)) {
  await setFileIfMissing(path, content, "ci: initialize multibranch webhook fixture", "master");
}

await Promise.all(expectedBranches.slice(1).map((name) => branch(repository, name)));
await Promise.all(["develop", "feature/pr-auto"].map((name) => setFileIfMissing("Jenkinsfile", jenkinsfile, "ci: switch to Scripted Pipeline DSL", name)));
await Promise.all([setScenario("develop", "unstable"), setScenario("feature/no-jenkinsfile", "failure")]);
await setScenario("feature/pr-auto", "success");
await setFileIfMissing("docs/pr-auto.md", "# Pull request fixture\n\n[DEMO] Independent documentation change for automatic PR discovery.\n", "docs: add PR discovery fixture", "feature/pr-auto");

// This branch deliberately starts from master (including Jenkinsfile), then
// removes only that exact fixture file through Gitea's contents API.
const noPipelineJenkinsfile = await readFileAt("Jenkinsfile", "feature/no-jenkinsfile");
if (noPipelineJenkinsfile) {
  const actual = Buffer.from(noPipelineJenkinsfile.value.content || "", "base64").toString("utf8");
  if (actual !== jenkinsfile && actual !== legacyJenkinsfile) throw new Error("Refusing to delete an unexpected Jenkinsfile from feature/no-jenkinsfile");
  await g(`${repoEndpoint}/contents/Jenkinsfile`, { method: "DELETE", data: {
    sha: noPipelineJenkinsfile.value.sha,
    branch: "feature/no-jenkinsfile",
    message: "ci: remove Jenkinsfile to test branch exclusion",
  } });
}

const pull = await ensurePullRequest();

// Read back every branch, expected scenario/Jenkinsfile state and open PR.
const branchEntries = await Promise.all(expectedBranches.map(async (name) => {
  const state = (await g(`${repoEndpoint}/branches/${encodeURIComponent(name)}`)).value;
  const [scenario, pipeline] = await Promise.all([readFileAt("ci/scenario.txt", name), readFileAt("Jenkinsfile", name)]);
  if (!scenario || Buffer.from(scenario.value.content || "", "base64").toString("utf8").trim() !== branchScenario[name]) {
    throw new Error(`Scenario readback failed for ${name}`);
  }
  const expectedPipeline = name !== "feature/no-jenkinsfile";
  if (Boolean(pipeline) !== expectedPipeline) throw new Error(`Jenkinsfile branch discovery state mismatch for ${name}`);
  if (pipeline && Buffer.from(pipeline.value.content || "", "base64").toString("utf8") !== jenkinsfile) {
    throw new Error(`Scripted Pipeline readback mismatch for ${name}`);
  }
  return [name, {
    commit: (state.commit.id || state.commit.sha).slice(0, 12),
    scenario: branchScenario[name],
    hasJenkinsfile: Boolean(pipeline),
  }];
}));
const branches = Object.fromEntries(branchEntries);
const prHead = (await g(`${repoEndpoint}/pulls/${pull.number}`)).value;
const prDoc = await readFileAt("docs/pr-auto.md", "feature/pr-auto");
if (prHead.state !== "open" || prHead.base.ref !== "master" || prHead.head.ref !== "feature/pr-auto" || !prDoc) {
  throw new Error("Pull request branch or documentation readback failed");
}

const openapi = JSON.parse(await readFile(".local/jenkins-demo/gitea-openapi.json", "utf8"));
const paths = openapi.paths || {};
const listHook = paths["/repos/{owner}/{repo}/hooks"]?.get;
const getHook = paths["/repos/{owner}/{repo}/hooks/{id}"]?.get;
const testHook = paths["/repos/{owner}/{repo}/hooks/{id}/tests"]?.post;
const deliveryPathDocumented = Object.keys(paths).some((path) => /hooks\/\{id\}\/deliveries/.test(path));
const webhookPlan = {
  recordedAt: new Date().toISOString(),
  repository,
  hookCreated: false,
  openapiFile: ".local/jenkins-demo/gitea-openapi.json",
  documentedReadOnlyChecks: [
    { method: "GET", path: `/api/v1/repos/${gitAccess.user}/${repository}/hooks`, operationId: listHook?.operationId || null, purpose: "Read hook IDs, active state, configured events and URL presence; redact config secrets." },
    { method: "GET", path: `/api/v1/repos/${gitAccess.user}/${repository}/hooks/{hook_id}`, operationId: getHook?.operationId || null, purpose: "Read hook state and event configuration; never serialize authorization_header or config secrets." },
  ],
  deliveryVerification: {
    documentedInLocalOpenAPI: deliveryPathDocumented,
    method: "GET",
    pathTemplate: `/api/v1/repos/${gitAccess.user}/${repository}/hooks/{hook_id}/deliveries`,
    attemptPathTemplate: `/api/v1/repos/${gitAccess.user}/${repository}/hooks/{hook_id}/deliveries/{delivery_id}/attempts`,
    purpose: "After parent configures the hook, read delivery IDs, event type, status code, timestamp and retry count. Read the latest attempt for response status; redact request payloads, headers, secrets and private build logs.",
    note: deliveryPathDocumented ? "Delivery routes are present in the saved OpenAPI snapshot." : "Delivery routes are absent from the saved OpenAPI snapshot; confirm supported route against the installed Gitea version before calling. No delivery API was called by this preparation script.",
  },
  eventVerification: [
    { event: "push", stimulus: "After hook configuration, push a new [DEMO] commit to develop or feature/pr-auto.", expected: "Gitea delivery event=push, successful HTTP response, Jenkins multibranch indexing/build for the matching branch; confirm BRANCH_NAME and scenario outcome." },
    { event: "pull_request", stimulus: "After hook configuration, update feature/pr-auto while its PR remains open (or create a separate marked PR if a create event is specifically needed).", expected: "Gitea delivery event=pull_request with action=synchronize, successful HTTP response, Jenkins PR job with CHANGE_ID and CHANGE_TARGET=master." },
  ],
  hookTestEndpoint: testHook ? { method: "POST", pathTemplate: `/api/v1/repos/${gitAccess.user}/${repository}/hooks/{hook_id}/tests`, operationId: testHook.operationId, purpose: "This sends a test push delivery and is not read-only; do not use as delivery evidence." } : null,
  pluginTokenReady: false,
};

await mkdir(resolve(".local/jenkins-demo"), { recursive: true, mode: 0o700 });
await writeFile(summaryPath, `${JSON.stringify({
  recordedAt: new Date().toISOString(),
  status: "passed",
  repository,
  public: true,
  branches,
  pullRequest: { number: prHead.number, title: prHead.title, state: prHead.state, base: prHead.base.ref, head: prHead.head.ref },
  durationMs: Date.now() - startedAt,
}, null, 2)}\n`, { mode: 0o600 });
await writeFile(planPath, `${JSON.stringify(webhookPlan, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ status: "passed", repository, branches, pullRequest: { number: prHead.number, state: prHead.state }, summary: ".local/jenkins-demo/multibranch-fixture-summary.json", webhookPlan: ".local/jenkins-demo/multibranch-webhook-verification.json" }));
