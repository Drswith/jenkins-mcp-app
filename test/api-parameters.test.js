import test from "node:test";
import assert from "node:assert/strict";
import { apiTools, publicTool } from "../src/api.js";

const config = { baseUrl: new URL("https://jenkins.example/context/"), authorization: "Basic test" };
const tool = (name) => apiTools.find((entry) => entry.name === name);
const response = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status, headers: { "content-type": "application/json" },
});

test("getJobParameters maps supported parameter definitions and redacts sensitive defaults", async (t) => {
  const requests = [];
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, options) => {
    requests.push({ url: new URL(url), options });
    return response({ property: [{ parameterDefinitions: [
      { _class: "hudson.model.StringParameterDefinition", name: "folder/name", description: "text", defaultParameterValue: { _class: "hudson.model.StringParameterValue", value: "abc" } },
      { _class: "hudson.model.ChoiceParameterDefinition", name: "REGION", choices: ["a", "b"], defaultParameterValue: { _class: "hudson.model.StringParameterValue", value: "b" } },
      { _class: "hudson.model.BooleanParameterDefinition", name: "FLAG", defaultParameterValue: { _class: "hudson.model.BooleanParameterValue", value: false } },
      { _class: "net.uaznia.lukanus.hudson.plugins.gitparameter.GitParameterDefinition", name: "BRANCH", type: "PT_BRANCH", defaultParameterValue: { _class: "hudson.model.StringParameterValue", value: "main" } },
      { _class: "hudson.model.PasswordParameterDefinition", name: "PASSWORD", defaultParameterValue: { _class: "hudson.model.PasswordParameterValue", value: "must-not-escape" } },
      { _class: "com.cloudbees.plugins.credentials.CredentialsParameterDefinition", name: "CREDENTIAL", defaultParameterValue: { value: "credential-secret" } },
      { _class: "custom.OtherDefinition", name: "MYSTERY", defaultParameterValue: { _class: "x", value: "known" } },
      { _class: "custom.OtherDefinition", name: "OBJECT_DEFAULT", description: { text: "private description" }, choices: [{ name: "object choice" }], defaultParameterValue: { _class: "x", value: { secret: "unknown-object-secret" } } },
      { _class: "hudson.model.StringParameterDefinition", name: "HIDDEN", defaultParameterValue: { _class: "plugin.SecretParameterValue", value: "string-secret-object" } },
      { _class: "hudson.model.ChoiceParameterDefinition", name: "SAFE_CHOICES", choices: ["safe", { value: "unsafe-object-choice" }], defaultParameterValue: { _class: "hudson.model.StringParameterValue", value: ["array-secret"] } },
      { _class: "hudson.model.StringParameterDefinition", name: "API_TOKEN", defaultParameterValue: { value: "token-secret" } },
    ] }] });
  };

  const result = await tool("getJobParameters").call(config, { jobFullName: "Folder/Parameterized Job" });
  assert.equal(result.structuredContent.jobFullName, "Folder/Parameterized Job");
  assert.deepEqual(result.structuredContent.parameters.map(({ name, type }) => [name, type]), [
    ["folder/name", "string"], ["REGION", "choice"], ["FLAG", "boolean"], ["BRANCH", "git"],
    ["PASSWORD", "password"], ["CREDENTIAL", "password"], ["MYSTERY", "unknown"], ["OBJECT_DEFAULT", "unknown"],
    ["HIDDEN", "string"], ["SAFE_CHOICES", "choice"], ["API_TOKEN", "string"],
  ]);
  const parameters = result.structuredContent.parameters;
  assert.equal(parameters[0].defaultValue, "abc");
  assert.deepEqual(parameters[1].choices, ["a", "b"]);
  assert.equal(parameters[1].defaultValue, "b");
  assert.equal(parameters[2].defaultValue, false);
  assert.equal(parameters[3].gitType, "PT_BRANCH");
  for (const sensitive of [parameters[4], parameters[5], parameters[8], parameters[10]]) {
    assert.equal(sensitive.sensitive, true);
    assert.equal(sensitive.defaultValue, null);
  }
  assert.equal(parameters[6].defaultValue, "known");
  assert.equal(parameters[7].defaultValue, null);
  assert.equal(parameters[7].description, null);
  assert.deepEqual(parameters[7].choices, undefined);
  assert.equal(parameters[8].defaultValue, null);
  assert.deepEqual(parameters[9].choices, ["safe"]);
  assert.equal(parameters[9].defaultValue, null);
  assert.equal(JSON.stringify(result).includes("must-not-escape"), false);
  assert.equal(JSON.stringify(result).includes("credential-secret"), false);
  assert.equal(JSON.stringify(result).includes("unknown-object-secret"), false);
  assert.equal(JSON.stringify(result).includes("private description"), false);
  assert.equal(JSON.stringify(result).includes("unsafe-object-choice"), false);
  assert.equal(JSON.stringify(result).includes("string-secret-object"), false);
  assert.equal(JSON.stringify(result).includes("array-secret"), false);
  assert.equal(JSON.stringify(result).includes("token-secret"), false);
  assert.match(requests[0].url.pathname, /job\/Folder\/job\/Parameterized%20Job\/api\/json$/);
  assert.match(requests[0].url.searchParams.get("tree"), /parameterDefinitions/);
  assert.equal(requests[0].options.method, "GET");
});

test("getGitParameterChoices uses param query, deduplicates results, and exposes plugin errors", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const requests = [];
  globalThis.fetch = async (url, options) => {
    const parsed = new URL(url);
    requests.push({ parsed, options });
    if (parsed.pathname.endsWith("/api/json")) return response({ property: [{ parameterDefinitions: [
      { _class: "net.uaznia.lukanus.hudson.plugins.gitparameter.GitParameterDefinition", name: "release branch", type: "PT_BRANCH" },
    ] }] });
    return response({ values: [{ name: "main", value: "main" }, { name: "dev", value: "dev" }, { name: "main alias", value: "main" }] });
  };
  const result = await tool("getGitParameterChoices").call(config, { jobFullName: "team/release job", parameterName: "release branch" });
  assert.deepEqual(result.structuredContent.choices, [{ name: "main", value: "main" }, { name: "dev", value: "dev" }]);
  assert.deepEqual(result.structuredContent.errors, []);
  assert.equal(result.structuredContent.truncated, false);
  const choiceRequest = requests[1];
  assert.equal(choiceRequest.parsed.searchParams.get("param"), "release branch");
  assert.equal(choiceRequest.parsed.searchParams.has("name"), false);
  assert.equal(choiceRequest.options.method, "GET");

  globalThis.fetch = async (url) => new URL(url).pathname.endsWith("/api/json")
    ? response({ property: [{ parameterDefinitions: [{ _class: "net.uaznia.lukanus.hudson.plugins.gitparameter.GitParameterDefinition", name: "release branch", type: "PT_BRANCH" }] }] })
    : response({ values: [{ value: "fake-choice" }], errors: ["git checkout failed"] });
  const failed = await tool("getGitParameterChoices").call(config, { jobFullName: "team/release job", parameterName: "release branch" });
  assert.deepEqual(failed.structuredContent.choices, []);
  assert.deepEqual(failed.structuredContent.errors, ["git checkout failed"]);
  assert.equal(failed.structuredContent.truncated, false);
});

test("Git choices report when unique candidates exceed the 200 item cap", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url) => new URL(url).pathname.endsWith("/api/json")
    ? response({ property: [{ parameterDefinitions: [{ _class: "net.uaznia.lukanus.hudson.plugins.gitparameter.GitParameterDefinition", name: "BRANCH", type: "PT_BRANCH" }] }] })
    : response({ values: Array.from({ length: 202 }, (_, index) => ({ name: `branch-${index}`, value: `branch-${index}` })) });
  const result = await tool("getGitParameterChoices").call(config, { jobFullName: "job", parameterName: "BRANCH" });
  assert.equal(result.structuredContent.choices.length, 200);
  assert.equal(result.structuredContent.truncated, true);
});

test("Git choices reject absent or unsupported definitions and HTTP errors", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => response({ property: [{ parameterDefinitions: [] }] });
  await assert.rejects(tool("getGitParameterChoices").call(config, { jobFullName: "job", parameterName: "missing" }), /was not found/);
  globalThis.fetch = async () => response({ property: [{ parameterDefinitions: [{ _class: "hudson.model.StringParameterDefinition", name: "BRANCH", type: "PT_BRANCH" }] }] });
  await assert.rejects(tool("getGitParameterChoices").call(config, { jobFullName: "job", parameterName: "BRANCH" }), /not a supported Git parameter/);
  for (const status of [403, 404]) {
    let candidateCalls = 0;
    globalThis.fetch = async (url) => {
      const path = new URL(url).pathname;
      if (path.endsWith("/api/json")) return response({ property: [{ parameterDefinitions: [{ _class: "net.uaznia.lukanus.hudson.plugins.gitparameter.GitParameterDefinition", name: "BRANCH", type: "PT_BRANCH" }] }] });
      candidateCalls++;
      return response({}, status);
    };
    await assert.rejects(tool("getGitParameterChoices").call(config, { jobFullName: "job", parameterName: "BRANCH" }), new RegExp(`HTTP ${status}`));
    assert.equal(candidateCalls, 1);
  }
});

test("getJobParameters propagates Jenkins metadata HTTP errors", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  for (const status of [403, 500]) {
    globalThis.fetch = async () => response({}, status);
    await assert.rejects(tool("getJobParameters").call(config, { jobFullName: "job" }), new RegExp(`HTTP ${status}`));
  }
});

test("parameter tools publish read-only metadata and precise inputs", () => {
  for (const name of ["getJobParameters", "getGitParameterChoices"]) {
    const published = publicTool(tool(name));
    assert.equal(published.annotations.readOnlyHint, true);
    assert.equal(published.annotations.destructiveHint, false);
  }
  assert.deepEqual(tool("getJobParameters").inputSchema.required, ["jobFullName"]);
  assert.deepEqual(tool("getGitParameterChoices").inputSchema.required, ["jobFullName", "parameterName"]);
});
