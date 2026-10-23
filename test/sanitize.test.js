import test from "node:test";
import assert from "node:assert/strict";
import { maskSecrets, sanitizeToolResult, sanitizeValue } from "../src/sanitize.js";

test("masks common secret shapes in log text", () => {
  const masked = maskSecrets([
    "git clone https://bob:s3cret@git.example.com/repo.git",
    "Authorization: Bearer abcdefghijklmnopqrstuvwx",
    "DB_PASSWORD=hunter22 next",
    "api_key: \"abcd1234\"",
    "token 1123456789abcdef0123456789abcdef01",
    "ghp_ABCDEFGHIJKLMNOPQRSTuvwx1234",
    "Triggered via MCP Client from 10.1.2.3",
    "-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----",
  ].join("\n"));
  for (const secret of ["s3cret", "abcdefghijklmnopqrstuvwx", "hunter22", "abcd1234", "1123456789abcdef0123456789abcdef01", "ghp_ABCDEFGHIJKLMNOPQRSTuvwx1234", "10.1.2.3", "MIIabc"]) {
    assert.ok(!masked.includes(secret), `${secret} should be masked`);
  }
  assert.match(masked, /https:\/\/bob:\*\*\*\*@git\.example\.com/);
});

test("keeps ordinary identifiers such as commit hashes", () => {
  const text = "commit e3b7b23d32aebc096178b85645f40d82a482cdc6 ok";
  assert.equal(maskSecrets(text), text);
});

test("minimizes Jenkins fields for model-visible results", () => {
  const value = sanitizeValue({
    _class: "org.jenkinsci.plugins.workflow.job.WorkflowJob", name: "app", color: "blue", queueId: 3,
    changeSet: { items: [{ commitId: "abc", author: { fullName: "Ada", absoluteUrl: "https://ci/user/ada" }, authorEmail: "ada@example.com", timestamp: 1, date: "2026-10-01" }] },
    failingTests: [{ errorStackTrace: Array.from({ length: 20 }, (_, index) => `at line ${index}`).join("\n") }],
  });
  assert.deepEqual(Object.keys(value), ["name", "status", "changeSet", "failingTests"]);
  assert.equal(value.status, "success");
  assert.deepEqual(value.changeSet.items[0], { commitId: "abc", author: { fullName: "Ada" }, timestamp: 1 });
  assert.equal(value.failingTests[0].errorStackTrace.split("\n").length, 9);
});

test("keeps queue IDs for queue tools and leaves app-only results structurally intact", () => {
  const triggered = sanitizeToolResult("triggerBuild", { content: [{ type: "text", text: "{}" }], structuredContent: { queueId: "7", scheduled: true } });
  assert.equal(triggered.structuredContent.queueId, "7");
  const appOnly = sanitizeToolResult("uiListJobs", { structuredContent: { jobs: [{ _class: "x.Folder", color: "blue", url: "https://u:p@ci/job/a/" }] } }, { appOnly: true });
  assert.deepEqual(appOnly.structuredContent.jobs[0], { _class: "x.Folder", color: "blue", url: "https://u:****@ci/job/a/" });
});

test("unwraps the upstream Jenkins MCP response envelope", () => {
  const result = sanitizeToolResult("getBuild", { content: [{ type: "text", text: JSON.stringify({ message: "Data retrieved successfully.", status: "COMPLETED", result: { number: 1, result: "SUCCESS" } }) }] });
  assert.deepEqual(JSON.parse(result.content[0].text), { number: 1, result: "SUCCESS" });
});

test("filters metadata as well as content, including structured secret keys", () => {
  const value = { token: "abc", nested: { password: "x", authorEmail: "private@example.com", _class: "internal.Type" }, log: "PASSWORD=abcdef" };
  const result = sanitizeToolResult("showJenkinsBuildCard", { structuredContent: value, _meta: { card: value } });
  assert.deepEqual(result._meta.card, result.structuredContent);
  assert.deepEqual(result.structuredContent, { token: "****", nested: { password: "****" }, log: "PASSWORD=****" });
  assert.equal(sanitizeToolResult("uiGetBuild", { _meta: value }, { appOnly: true })._meta.nested.password, "****");
});
