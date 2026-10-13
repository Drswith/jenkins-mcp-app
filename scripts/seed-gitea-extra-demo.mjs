import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { g, repoPath, putFile, branch, gitAccess, giteaUrl } from "./seed-jenkins-demo.mjs";

const mode = process.argv[2];
if (process.argv.length !== 3 || !["--run", "--merge"].includes(mode)) {
  throw new Error("Use exactly one explicit mode: --run or --merge");
}

const directory = resolve(".local/jenkins-demo");
await mkdir(directory, { recursive: true, mode: 0o700 });
const repo = "demo-ci-lab";
const evidence = { recordedAt: new Date().toISOString(), repository: repo, operations: [] };
const endpoint = (suffix) => `${repoPath(repo)}${suffix}`;
const record = (operation, data) => evidence.operations.push({ operation, ...data });

const metadata = (await g(repoPath(repo))).value;
if (!metadata.description?.includes("[DEMO]")) throw new Error(`Refusing unmarked repository: ${repo}`);

const labelsResponse = await g(endpoint("/labels?limit=100"));
const labels = labelsResponse.value;
const wantedLabels = [
  { name: "[DEMO] rebase", color: "#1f6feb", description: "Synthetic rebase review fixture" },
  { name: "[DEMO] discussion", color: "#8250df", description: "Synthetic issue discussion fixture" },
];
for (const label of wantedLabels) {
  let found = labels.find((item) => item.name === label.name);
  if (!found) found = (await g(endpoint("/labels"), { method: "POST", data: label })).value;
  record("label", { name: found.name, id: found.id });
}

const milestones = (await g(endpoint("/milestones?state=all&limit=100"))).value;
const milestoneTitle = "[DEMO] Git collaboration walkthrough";
let milestone = milestones.find((item) => item.title === milestoneTitle);
if (!milestone) milestone = (await g(endpoint("/milestones"), { method: "POST", data: {
  title: milestoneTitle,
  description: "Synthetic milestone for a rebase review and issue discussion walkthrough.",
  state: "open",
} })).value;
record("milestone", { title: milestone.title, id: milestone.id, state: milestone.state });

const repoLabels = (await g(endpoint("/labels?limit=100"))).value;
const labelIds = wantedLabels.map((wanted) => repoLabels.find((item) => item.name === wanted.name)?.id).filter(Number.isInteger);
const issueTitle = "[DEMO] Rebase review and release-note discussion";
let issues = (await g(endpoint("/issues?state=all&type=issues&limit=100"))).value;
let issue = issues.find((item) => item.title === issueTitle);
if (!issue) issue = (await g(endpoint("/issues"), { method: "POST", data: {
  title: issueTitle,
  body: "[DEMO] Synthetic discussion for the feature/rebase-demo pull request. No production work is represented.",
  labels: labelIds,
  milestone: milestone.id,
} })).value;
const issuePath = `/issues/${issue.number}`;
// Exercise real open -> closed -> reopened transitions and leave an idempotent discussion record.
const stateDiscussion = [
  "[DEMO] Review started: the rebase branch contains a documentation-only change.",
  "[DEMO] Closed after confirming the synthetic change was ready for review.",
  "[DEMO] Reopened to show follow-up discussion; the issue remains open for the walkthrough.",
];
const existingComments = (await g(endpoint(`${issuePath}/comments`))).value;
if (!existingComments.some((item) => item.body === stateDiscussion[0])) {
  await g(endpoint(`${issuePath}/comments`), { method: "POST", data: { body: stateDiscussion[0] } });
  await g(endpoint(issuePath), { method: "PATCH", data: { state: "closed" } });
  await g(endpoint(`${issuePath}/comments`), { method: "POST", data: { body: stateDiscussion[1] } });
  await g(endpoint(issuePath), { method: "PATCH", data: { state: "open" } });
  await g(endpoint(`${issuePath}/comments`), { method: "POST", data: { body: stateDiscussion[2] } });
} else if (!existingComments.some((item) => item.body === stateDiscussion[2])) {
  throw new Error("Issue state discussion is incomplete; inspect before continuing");
}
const issueReadback = (await g(endpoint(issuePath))).value;
const issueComments = (await g(endpoint(`${issuePath}/comments`))).value;
const issueLabels = (await g(endpoint(`${issuePath}/labels`))).value;
record("issue", {
  number: issue.number, title: issueReadback.title, state: issueReadback.state,
  milestone: issueReadback.milestone?.title, labels: issueLabels.map((item) => item.name),
  discussionComments: issueComments.filter((item) => item.body.startsWith("[DEMO]")).map((item) => item.body),
});

const featureBranch = "feature/rebase-demo";
await branch(repo, featureBranch);
const filePath = "docs/rebase-review.md";
const fileContent = `# Rebase review walkthrough\n\nThis synthetic change demonstrates a feature branch rebased and merged through a pull request.\n\n- Review the focused documentation diff.\n- Confirm the pull request records the rebase merge method.\n- Keep this fixture separate from production release notes.\n`;
await putFile(repo, filePath, fileContent, "docs: add rebase review walkthrough", featureBranch);
let pulls = (await g(endpoint("/pulls?state=all&limit=100"))).value;
let pull = pulls.find((item) => item.head.ref === featureBranch && item.base.ref === "master");
if (!pull) pull = (await g(endpoint("/pulls"), { method: "POST", data: {
  base: "master", head: featureBranch, title: "[DEMO] Rebase review walkthrough",
  body: "[DEMO] Documentation-only feature branch for a rebase merge demonstration.",
  labels: labelIds, milestone: milestone.id,
} })).value;
if (mode === "--merge" && pull.state === "open" && !pull.merged) {
  await g(endpoint(`/pulls/${pull.number}/merge`), { method: "POST", data: {
    do: "rebase", delete_branch_after_merge: false,
    merge_title_field: "docs: rebase review walkthrough",
  } });
}
pull = (await g(endpoint(`/pulls/${pull.number}`))).value;
if (mode === "--merge" && !pull.merged) throw new Error(`Rebase pull request did not merge: #${pull.number}`);
const pullCommits = (await g(endpoint(`/pulls/${pull.number}/commits`))).value;
const branchAfterMerge = await g(endpoint(`/branches/${encodeURIComponent(featureBranch)}`), { allow404: true });
record("rebase-pull-request", {
  number: pull.number, title: pull.title, state: pull.state, merged: pull.merged,
  mergeCommitSha: pull.merge_commit_sha, headSha: pull.head?.sha,
  commits: pullCommits.map((item) => ({ sha: item.sha, message: item.commit?.message })),
  featureBranchRetained: Boolean(branchAfterMerge),
});

const releases = (await g(endpoint("/releases?draft=false&limit=100"))).value;
const releaseTag = "v3.2.0-rebase-demo";
let release = releases.find((item) => item.tag_name === releaseTag);
if (!release) release = (await g(endpoint("/releases"), { method: "POST", data: {
  tag_name: releaseTag, target_commitish: "master", name: "[DEMO] Rebase walkthrough notes",
  body: "Synthetic release containing a small review walkthrough attachment.",
  draft: false, prerelease: true,
} })).value;
let assets = (await g(endpoint(`/releases/${release.id}/assets`))).value;
const assetName = "rebase-walkthrough.txt";
if (!assets.some((asset) => asset.name === assetName)) {
  const form = new FormData();
  form.append("attachment", new Blob(["[DEMO] Synthetic release attachment.\nRebase review walkthrough for demo-ci-lab.\n"], { type: "text/plain" }), assetName);
  const url = new URL(`${giteaUrl.href.replace(/\/$/, "")}/${endpoint(`/releases/${release.id}/assets`)}?name=${encodeURIComponent(assetName)}`);
  if (url.origin !== giteaUrl.origin) throw new Error("Release upload escaped the configured demo service");
  const authorization = `Basic ${Buffer.from(`${gitAccess.user}:${gitAccess.password}`).toString("base64")}`;
  const response = await fetch(url, { method: "POST", headers: { Authorization: authorization }, body: form, redirect: "manual", signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Release attachment upload failed: HTTP ${response.status}`);
}
assets = (await g(endpoint(`/releases/${release.id}/assets`))).value;
record("release-attachment", {
  releaseId: release.id, tag: release.tag_name, draft: release.draft,
  assets: assets.map((asset) => ({ name: asset.name, size: asset.size, browserDownloadUrl: asset.browser_download_url })),
});

evidence.recordedAt = new Date().toISOString();
await writeFile(resolve(directory, "gitea-extra-demo-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ evidenceFile: ".local/jenkins-demo/gitea-extra-demo-evidence.json", operations: evidence.operations.map(({ operation, ...details }) => ({ operation, ...details })) }, null, 2));
