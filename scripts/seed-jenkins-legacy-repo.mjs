import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const GITEA_HOST = "gitea-drs-sg.zeabur.app";
const REPOSITORY = "demo-legacy-ci";
const FIXTURE_FILES = Object.freeze({
  master: "test/legacy-jenkins/repo-master.Jenkinsfile",
  develop: "test/legacy-jenkins/repo-develop.Jenkinsfile",
});

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain && (process.argv.length !== 3 || process.argv[2] !== "--run")) {
  throw new Error("Use --run to create or update the marked legacy demo repository fixture");
}
if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(REPOSITORY)) throw new Error("Invalid legacy demo repository name");

async function config() {
  const access = JSON.parse(await readFile(".local/jenkins-test/zeabur/gitea-access.json", "utf8"));
  if (!access.user || !access.password) throw new Error("Gitea credentials are incomplete");
  const baseUrl = new URL(process.env.GITEA_DEMO_URL || `https://${GITEA_HOST}/`);
  if (baseUrl.protocol !== "https:" || baseUrl.hostname !== GITEA_HOST || baseUrl.port || baseUrl.pathname !== "/" || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    throw new Error(`Repository seed is restricted to https://${GITEA_HOST}/`);
  }
  return { access, baseUrl, authorization: `Basic ${Buffer.from(`${access.user}:${access.password}`).toString("base64")}` };
}

async function request(ctx, path, { method = "GET", data, allow404 = false } = {}) {
  const url = new URL(path, ctx.baseUrl);
  if (url.origin !== ctx.baseUrl.origin || !url.pathname.startsWith(ctx.baseUrl.pathname)) throw new Error("Request escaped configured Gitea service");
  const response = await fetch(url, {
    method,
    headers: { Authorization: ctx.authorization, Accept: "application/json", ...(data ? { "Content-Type": "application/json" } : {}) },
    ...(data ? { body: JSON.stringify(data) } : {}),
    redirect: "manual",
    signal: AbortSignal.timeout(30000),
  });
  if (response.status === 404 && allow404) return null;
  if (response.status >= 300 && response.status < 400) throw new Error(`${method} ${url.pathname}: unexpected redirect (${response.status})`);
  if (!response.ok) throw new Error(`${method} ${url.pathname}: HTTP ${response.status}`);
  const body = await response.text();
  let value;
  try { value = body ? JSON.parse(body) : null; } catch { value = body; }
  return { value, status: response.status };
}

const repoPath = (user) => `api/v1/repos/${encodeURIComponent(user)}/${encodeURIComponent(REPOSITORY)}`;
async function fileAt(ctx, user, branch) {
  return request(ctx, `${repoPath(user)}/contents/Jenkinsfile?ref=${encodeURIComponent(branch)}`, { allow404: true });
}
function textOf(file) {
  return file ? Buffer.from(String(file.value.content || "").replace(/\s/g, ""), "base64").toString("utf8") : null;
}
function assertOwnedFile(file, branch) {
  if (!file) return;
  const current = textOf(file);
  if (!/^\/\/ \[legacy-demo\] fixture branch: (?:master|develop)\r?\n/.test(current)) {
    throw new Error(`Refusing to overwrite an unmarked Jenkinsfile on ${branch}`);
  }
}
async function putFixture(ctx, user, branch, content) {
  const current = await fileAt(ctx, user, branch);
  assertOwnedFile(current, branch);
  if (textOf(current) === content) return;
  const data = {
    branch,
    content: Buffer.from(content).toString("base64"),
    message: `ci: seed legacy Jenkins ${branch} fixture`,
    ...(current ? { sha: current.value.sha } : {}),
  };
  await request(ctx, `${repoPath(user)}/contents/Jenkinsfile`, { method: current ? "PUT" : "POST", data });
}

async function seed() {
  const ctx = await config();
  const user = ctx.access.user;
  const path = repoPath(user);
  let repo = await request(ctx, path, { allow404: true });
  if (!repo) {
    await request(ctx, "api/v1/user/repos", {
      method: "POST",
      data: {
        name: REPOSITORY,
        description: "[DEMO] Jenkins 2.263.1 legacy Git Parameter fixtures; synthetic Jenkinsfiles only.",
        private: false,
        auto_init: true,
        default_branch: "master",
      },
    });
    repo = await request(ctx, path);
  }
  if (!String(repo.value.description || "").startsWith("[DEMO]")) throw new Error(`Refusing to modify unmarked repository: ${REPOSITORY}`);
  if (repo.value.private !== false) throw new Error(`Legacy fixture repository must remain public: ${REPOSITORY}`);

  const masterRef = await request(ctx, `${path}/branches/master`, { allow404: true });
  if (!masterRef) throw new Error("The marked fixture repository must already have a master branch");
  const developRef = await request(ctx, `${path}/branches/develop`, { allow404: true });
  const masterFile = await fileAt(ctx, user, "master");
  const developFile = developRef ? await fileAt(ctx, user, "develop") : null;
  assertOwnedFile(masterFile, "master");
  if (developRef) assertOwnedFile(developFile, "develop");

  const fixtureContents = Object.fromEntries(await Promise.all(Object.entries(FIXTURE_FILES).map(async ([branch, file]) => [branch, await readFile(file, "utf8")])));
  if (!developRef) {
    await request(ctx, `${path}/branches`, { method: "POST", data: { new_branch_name: "develop", old_ref_name: "master" } });
  }
  await putFixture(ctx, user, "master", fixtureContents.master);
  await putFixture(ctx, user, "develop", fixtureContents.develop);

  const [verifiedMaster, verifiedDevelop, verifiedMasterFile, verifiedDevelopFile] = await Promise.all([
    request(ctx, `${path}/branches/master`),
    request(ctx, `${path}/branches/develop`),
    fileAt(ctx, user, "master"),
    fileAt(ctx, user, "develop"),
  ]);
  const masterSha = verifiedMaster.value.commit.id || verifiedMaster.value.commit.sha;
  const developSha = verifiedDevelop.value.commit.id || verifiedDevelop.value.commit.sha;
  if (!masterSha || !developSha || masterSha === developSha) throw new Error("Fixture branches must point to distinct commit SHAs");
  if (textOf(verifiedMasterFile) !== fixtureContents.master || textOf(verifiedDevelopFile) !== fixtureContents.develop) {
    throw new Error("Gitea did not return the expected branch-specific Jenkinsfiles");
  }
  console.log(JSON.stringify({
    repository: REPOSITORY,
    publicFixture: true,
    branches: {
      master: { sha: masterSha, fixture: "master" },
      develop: { sha: developSha, fixture: "develop" },
    },
    distinctBranchSHAs: masterSha !== developSha,
  }, null, 2));
}

if (isMain) await seed();
