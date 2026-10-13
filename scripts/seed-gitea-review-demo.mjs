import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { g, repoPath, branch, putFile, gitAccess, giteaUrl } from "./seed-jenkins-demo.mjs";

if (process.argv.length !== 3 || process.argv[2] !== "--run") throw new Error("Use exactly --run to create the Gitea review demo");

const repo = "demo-ci-lab";
const reviewer = "demo-reviewer";
const email = "reviewer@example.invalid";
const feature = "feature/review-roundtrip";
const filePath = "docs/review-roundtrip.md";
const accountPath = resolve(".local/jenkins-demo/demo-reviewer-access.json");
const evidencePath = resolve(".local/jenkins-demo/gitea-review-demo-evidence.json");
const repoApi = repoPath(repo);
const evidence = { recordedAt: new Date().toISOString(), repository: repo, status: "running", steps: [] };
let reviewerPassword;

const basic = (user, password) => `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
const reviewerAuth = (password) => basic(reviewer, password);
const reviewRequest = async (password, path, data) => {
  const url = new URL(path, giteaUrl);
  if (url.origin !== giteaUrl.origin) throw new Error("Review API request escaped the configured Gitea service");
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: reviewerAuth(password), "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(data), redirect: "manual", signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let value = null;
  try { value = text ? JSON.parse(text) : null; } catch { value = null; }
  if (!response.ok) throw new Error(`Reviewer API returned HTTP ${response.status}`);
  return value;
};
const step = (name, details = {}) => evidence.steps.push({ name, ...details });
const fail = async (status, phase) => {
  evidence.status = status;
  evidence.phase = phase;
  await persist();
};
async function persist() {
  evidence.recordedAt = new Date().toISOString();
  await mkdir(resolve(".local/jenkins-demo"), { recursive: true, mode: 0o700 });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
}

try {
  const repository = (await g(repoApi)).value;
  if (!repository.description?.includes("[DEMO]")) throw new Error("Target repository is not marked [DEMO]");
  const owner = (await g("api/v1/user")).value;
  if (owner.login !== gitAccess.user) throw new Error("Authenticated Gitea user does not match the configured owner");
  if (owner.is_admin !== true) {
    await fail("skipped_admin_permission", "admin-check");
    console.log(JSON.stringify({ status: evidence.status, reason: "codex-test lacks admin API permission", evidence: ".local/jenkins-demo/gitea-review-demo-evidence.json" }));
    process.exitCode = 0;
  } else {
    let reviewerUser = await g(`api/v1/users/${encodeURIComponent(reviewer)}`, { allow404: true });
    if (reviewerUser) {
      try {
        const access = JSON.parse(await readFile(accountPath, "utf8"));
        if (access.username !== reviewer || typeof access.password !== "string" || !access.password) throw new Error("Invalid local reviewer fixture credentials");
        const permissions = (await stat(accountPath)).mode & 0o777;
        if ((permissions & 0o077) !== 0) throw new Error("Reviewer fixture credential file must use mode 0600");
        reviewerPassword = access.password;
        const authenticated = await fetch(new URL("api/v1/user", giteaUrl), { headers: { Authorization: reviewerAuth(reviewerPassword) }, signal: AbortSignal.timeout(30000) });
        if (!authenticated.ok) throw new Error("Existing reviewer fixture credentials do not authenticate");
        const identity = await authenticated.json();
        if (identity.login !== reviewer || identity.is_admin === true) throw new Error("Existing reviewer identity is not the expected non-admin fixture");
        reviewerUser.value = identity;
        step("reuse-existing-fixture-user", { username: reviewer, isAdmin: false });
      } catch {
        await fail("skipped_existing_user_credentials_unavailable", "existing-user-check");
        console.log(JSON.stringify({ status: evidence.status, reason: "existing account was left untouched because no valid private fixture credentials were available", evidence: ".local/jenkins-demo/gitea-review-demo-evidence.json" }));
        process.exitCode = 0;
      }
    } else {
      reviewerPassword = randomBytes(36).toString("base64url");
      const credential = { username: reviewer, password: reviewerPassword };
      await mkdir(resolve(".local/jenkins-demo"), { recursive: true, mode: 0o700 });
      await writeFile(accountPath, `${JSON.stringify(credential, null, 2)}\n`, { mode: 0o600, flag: "wx" });
      const created = await g("api/v1/admin/users", { method: "POST", data: {
        username: reviewer, email, password: reviewerPassword,
        full_name: "[DEMO] Pull request reviewer", visibility: "private",
        must_change_password: false, send_notify: false,
      } });
      reviewerUser = { value: created.value };
      const isAdmin = reviewerUser.value?.is_admin === true;
      if (isAdmin) throw new Error("New demo reviewer unexpectedly has administrator privileges");
      step("create-non-admin-demo-user", { username: reviewer, emailDomain: "example.invalid", isAdmin: false, credentialFile: ".local/jenkins-demo/demo-reviewer-access.json" });
    }

    if (process.exitCode !== 0) {
      const reviewerId = reviewerUser?.value || reviewerUser;
      if (reviewerId?.login === reviewer) {
        if (reviewerId.is_admin === true) throw new Error("Refusing to continue with an administrator reviewer");
        await g(`${repoApi}/collaborators/${encodeURIComponent(reviewer)}`, { method: "PUT", data: { permission: "read" } });
        const collaboratorCheck = await g(`${repoApi}/collaborators/${encodeURIComponent(reviewer)}`, { allow404: true });
        if (!collaboratorCheck) throw new Error("Read-only collaborator assignment did not verify");
        const permission = (await g(`${repoApi}/collaborators/${encodeURIComponent(reviewer)}/permission`)).value;
        if (permission.permission !== "read") throw new Error("Collaborator permission readback was not read-only");
        step("grant-read-collaboration", { username: reviewer, requestedPermission: "read", verifiedPermission: permission.permission });

        const branchState = await g(`${repoApi}/branches/${encodeURIComponent(feature)}`, { allow404: true });
        const initialContent = "# Review roundtrip demo\n\n[DEMO] Initial draft: describe the review workflow here.\n";
        const revisedContent = "# Review roundtrip demo\n\n[DEMO] Revised after requested changes: describe the review workflow here.\n";
        if (branchState && !branchState.value.name?.startsWith("feature/review-roundtrip")) throw new Error("Unexpected feature branch state");
        const existingFile = await g(`${repoApi}/contents/${filePath}?ref=${encodeURIComponent(feature)}`, { allow404: true });
        if (branchState && !existingFile) throw new Error("Review feature branch already exists without its demo fixture; refusing to modify it");
        if (!branchState && existingFile) throw new Error("Demo fixture exists without its expected branch; refusing to continue");
        if (existingFile) {
          const oldContent = Buffer.from(existingFile.value.content || "", "base64").toString("utf8");
          if (oldContent !== initialContent && oldContent !== revisedContent) throw new Error("Existing demo branch file differs; refusing to overwrite");
        } else {
          await branch(repo, feature);
          await putFile(repo, filePath, initialContent, "docs: add review roundtrip fixture", feature);
        }

        const existingPulls = (await g(`${repoApi}/pulls?state=all&limit=100`)).value;
        let pull = existingPulls.find((item) => item.head.ref === feature && item.base.ref === "master");
        if (!pull) pull = (await g(`${repoApi}/pulls`, { method: "POST", data: {
          base: "master", head: feature, title: "[演示] Review and approval roundtrip",
          body: "[DEMO] Different-user review walkthrough. The reviewer requests changes, the owner updates this new file, and the reviewer approves while the pull request stays open.",
        } })).value;
        if (!pull.title?.startsWith("[演示]") || pull.state !== "open") throw new Error("Existing review PR is not an open demo pull request");

        const reviewsPath = `${giteaUrl.pathname.replace(/\/$/, "")}/${repoApi}/pulls/${pull.number}/reviews`;
        const firstHead = (await g(`${repoApi}/branches/${encodeURIComponent(feature)}`)).value.commit.id;
        const beforeReviews = (await g(`${repoApi}/pulls/${pull.number}/reviews?limit=100`)).value;
        let requestChanges = beforeReviews.find((review) => review.user?.login === reviewer && review.state === "REQUEST_CHANGES");
        if (!requestChanges) requestChanges = await reviewRequest(reviewerPassword, reviewsPath, {
          event: "REQUEST_CHANGES", commit_id: firstHead,
          body: "[DEMO] Please clarify the review workflow before approval.",
        });
        step("reviewer-requests-changes", { pr: pull.number, reviewer: requestChanges?.user?.login || reviewer, state: requestChanges?.state || "REQUEST_CHANGES" });

        const currentFile = await g(`${repoApi}/contents/${filePath}?ref=${encodeURIComponent(feature)}`);
        const currentText = Buffer.from(currentFile.value.content || "", "base64").toString("utf8");
        if (currentText === initialContent) await putFile(repo, filePath, revisedContent, "docs: address reviewer feedback", feature);
        else if (currentText !== revisedContent) throw new Error("Feature file changed unexpectedly; refusing to overwrite");

        const revisedHead = (await g(`${repoApi}/branches/${encodeURIComponent(feature)}`)).value.commit.id;
        const afterPushReviews = (await g(`${repoApi}/pulls/${pull.number}/reviews?limit=100`)).value;
        let approval = afterPushReviews.find((review) => review.user?.login === reviewer && review.state === "APPROVED" && review.commit_id === revisedHead);
        if (!approval) approval = await reviewRequest(reviewerPassword, reviewsPath, {
          event: "APPROVED", commit_id: revisedHead,
          body: "[DEMO] Follow-up verified; approved after the requested documentation update.",
        });
        const finalReviews = (await g(`${repoApi}/pulls/${pull.number}/reviews?limit=100`)).value;
        pull = (await g(`${repoApi}/pulls/${pull.number}`)).value;
        const ownerReviews = finalReviews.filter((review) => review.user?.login === gitAccess.user);
        const reviewerReviews = finalReviews.filter((review) => review.user?.login === reviewer);
        const requestedReview = reviewerReviews.find((review) => review.state === "REQUEST_CHANGES");
        const approvedReview = reviewerReviews.find((review) => review.state === "APPROVED" && review.commit_id === revisedHead);
        if (!requestedReview || !approvedReview || ownerReviews.some((review) => review.state === "REQUEST_CHANGES" || review.state === "APPROVED")) throw new Error("Different-user review readback did not match the intended states");
        if (pull.state !== "open" || pull.merged) throw new Error("Review demo pull request did not remain open");
        step("review-readback", {
          pr: pull.number, pullState: pull.state, merged: pull.merged,
          owner: gitAccess.user, reviewer: reviewer,
          requestChangesBy: requestedReview.user.login, requestChangesState: requestedReview.state,
          approvalBy: approvedReview.user.login, approvalState: approvedReview.state,
          approvedCommit: revisedHead.slice(0, 12), distinctUsers: requestedReview.user.login !== gitAccess.user && approvedReview.user.login !== gitAccess.user,
        });
        evidence.status = "passed";
      }
    }
  }
} catch (error) {
  evidence.status = evidence.status === "running" ? "failed" : evidence.status;
  evidence.phase ||= "write-or-readback";
  evidence.error = error instanceof Error ? error.message.slice(0, 240) : "Review demo failed";
} finally {
  await persist();
}

console.log(JSON.stringify({ status: evidence.status, steps: evidence.steps, evidence: ".local/jenkins-demo/gitea-review-demo-evidence.json" }));
if (evidence.status === "failed") process.exitCode = 1;
