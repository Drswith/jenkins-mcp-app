import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { jobPath, readConfig } from "../src/config.js";
import { apiTools, normalizeJenkinsUrl } from "../src/api.js";

const testRoot = mkdtempSync(join(tmpdir(), "jenkins-plugin-test-"));
const configFile = join(testRoot, "absent.json");
const installedCopy = join(testRoot, "jenkins");
cpSync(join(process.cwd(), "release/jenkins"), installedCopy, { recursive: true });
const bundledServer = join(installedCopy, "dist/server.mjs");
const uiManifest = JSON.parse(readFileSync(join(installedCopy, "dist/ui/manifest.json"), "utf8"));
const uiToolNames = ["openJenkinsWorkspace", "openJenkinsPanel", "showJenkinsBuildCard", "showJenkinsQueueCard", "showJenkinsJobChoices", "showJenkinsBuildComparison", "uiListJobs", "uiGetJob", "uiGetBuild", "uiGetBuildLog", "uiGetQueueItem", "uiTrackQueue", "uiGetBuildStages", "uiGetJobParameters", "uiGetGitParameterChoices"];
const apiToolNames = ["getJobs", "getJob", "getJobParameters", "getGitParameterChoices", "getBuild", "getBuildLog", "getQueueItem", "triggerBuild"];
after(() => rmSync(testRoot, { recursive: true, force: true }));

function packageFiles(path, prefix = "") {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const name = `${prefix}${entry.name}`;
    return entry.isDirectory() ? packageFiles(join(path, entry.name), `${name}/`) : [name];
  }).sort();
}

test("installable plugin contains only runtime files", () => {
  assert.deepEqual(packageFiles(installedCopy), [
    "LICENSE", "assets/ATTRIBUTION.md", "assets/JENKINS-CORE-LICENSE.txt",
    "assets/jenkins-headshot.png", "assets/jenkins-logo.png",
    "assets/jenkins-build-dark.svg", "assets/jenkins-build-light.svg",
    "dist/configure.mjs", "dist/server.mjs",
    "dist/ui/manifest.json", ...Object.values(uiManifest).map((entry) => `dist/ui/${entry.file}`),
    "docs/configuration.md", "mcp.json", "plugin.json",
    "skills/jenkins-build-triage/SKILL.md", "skills/jenkins-setup/SKILL.md",
    "skills/jenkins-trigger-build/SKILL.md",
  ].sort());
});

test("configuration and job paths reject ambiguous inputs", () => {
  assert.equal(jobPath("folder/build main"), "job/folder/job/build%20main");
  assert.throws(() => jobPath("../admin"));
  assert.throws(() => readConfig({ JENKINS_CONFIG_FILE: configFile, JENKINS_URL: "https://user:pass@example.com", JENKINS_USER: "a", JENKINS_API_TOKEN: "b" }));
});

test("API URLs stay under the configured Jenkins root and queue locations are validated", async () => {
  const config = readConfig({ JENKINS_CONFIG_FILE: configFile, JENKINS_URL: "http://127.0.0.1:8090/jenkins/", JENKINS_USER: "user", JENKINS_API_TOKEN: "token", JENKINS_MODE: "api" });
  assert.equal(normalizeJenkinsUrl(config, "job/%E4%B8%AD%E6%96%87%2F%E5%AD%90%E7%9B%AE%E5%BD%95/"), "http://127.0.0.1:8090/jenkins/job/%E4%B8%AD%E6%96%87%2F%E5%AD%90%E7%9B%AE%E5%BD%95/");
  assert.equal(normalizeJenkinsUrl(config, "https://canonical.example/jenkins/job/folder/job/name/42/"), "http://127.0.0.1:8090/jenkins/job/folder/job/name/42/");
  assert.equal(normalizeJenkinsUrl(config, "https://canonical.example/job/folder/"), null, "absolute contextless URLs must not escape a configured context root");
  assert.equal(normalizeJenkinsUrl(config, "https://canonical.example/other/job/folder/"), null);
  assert.equal(normalizeJenkinsUrl(config, "https://canonical.example/jenkins/queue/item/31/", { allowQueue: true }), "http://127.0.0.1:8090/jenkins/queue/item/31/");

  const locations = ["/jenkins/queue/item/32/", "queue/item/33/", "https://canonical.example/jenkins/queue/item/34/"];
  let locationIndex = 0;
  const requests = [];
  const httpServer = createServer(async (req, res) => {
    requests.push(req.url);
    if (req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const form = new URLSearchParams(body);
      assert.equal(req.headers["content-type"], "application/x-www-form-urlencoded");
      assert.deepEqual([...form.entries()], [["CHOICE", "中文 option"], ["GIT_REF", "feature/my branch"]]);
      res.writeHead(201, { Location: locations[locationIndex++] });
      res.end();
      return;
    }
    if (req.url.startsWith("/jenkins/api/json")) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ jobs: [{ name: "folder", fullName: "folder", url: "https://canonical.example/jenkins/job/folder/", lastBuild: { number: 42, url: "https://canonical.example/jenkins/job/folder/42/" } }] }));
      return;
    }
    if (req.url.startsWith("/jenkins/job/folder/api/json")) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ fullName: "folder", url: "job/folder/", lastBuild: { number: 42, url: "http://127.0.0.1:8090/jenkins/job/folder/42/" } }));
      return;
    }
    if (req.url.startsWith("/jenkins/job/folder/42/api/json")) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ number: 42, url: "https://canonical.example/jenkins/job/folder/42/" }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  config.baseUrl.port = String(httpServer.address().port);
  const call = (name, args) => apiTools.find((tool) => tool.name === name).call(config, args);
  try {
    const jobs = (await call("getJobs")).structuredContent;
    assert.equal(jobs.jobs[0].url, `${config.baseUrl}job/folder/`);
    assert.equal(jobs.jobs[0].lastBuild.url, `${config.baseUrl}job/folder/42/`);
    assert.equal((await call("getJob", { jobFullName: "folder" })).structuredContent.lastBuild.url, `${config.baseUrl}job/folder/42/`);
    assert.equal((await call("getBuild", { jobFullName: "folder", buildNumber: 42 })).structuredContent.url, `${config.baseUrl}job/folder/42/`);
    for (let expected = 32; expected <= 34; expected++) {
      const result = (await call("triggerBuild", { jobFullName: "folder", parameters: { CHOICE: "中文 option", GIT_REF: "feature/my branch" } })).structuredContent;
      assert.equal(result.queueId, String(expected));
      assert.equal(result.queueUrl, `${config.baseUrl}queue/item/${expected}/`);
    }
    for (const location of ["https://canonical.example/jenkins/error/", "/jenkins/job/folder/", "https://canonical.example/outside/jenkins/queue/item/35/"]) {
      locations.push(location);
      await assert.rejects(call("triggerBuild", { jobFullName: "folder", parameters: { CHOICE: "中文 option", GIT_REF: "feature/my branch" } }), /invalid queue Location/);
    }
    assert.equal(requests.every((url) => url.startsWith("/jenkins/")), true, "all requests must stay on the configured origin and context path");
  } finally {
    await new Promise((resolve) => httpServer.close(resolve));
  }
});

test("stdio MCP bridge reads and schedules through Jenkins API", async () => {
  const calls = [];
  const httpServer = createServer(async (req, res) => {
    calls.push({ method: req.method, url: req.url, auth: req.headers.authorization });
    assert.equal(req.headers.authorization, "Basic dXNlcjp0b2tlbg==");
    if (req.url.startsWith("/jenkins/api/json")) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ jobs: [{ name: "folder", fullName: "folder" }] }));
    } else if (req.url.startsWith("/jenkins/job/folder/job/build%20main/api/json?tree=") && decodeURIComponent(req.url).includes("property[parameterDefinitions")) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ property: [{ parameterDefinitions: [
        { _class: "hudson.model.StringParameterDefinition", name: "BRANCH", defaultParameterValue: { value: "main" } },
        { _class: "net.uaznia.lukanus.hudson.plugins.gitparameter.GitParameterDefinition", name: "GIT_REF", type: "PT_BRANCH" },
      ] }] }));
    } else if (req.url.startsWith("/jenkins/job/folder/job/build%20main/descriptorByName/")) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify([{ name: "main", value: "main" }, { name: "release", value: "release" }]));
    } else if (req.url.startsWith("/jenkins/job/folder/job/build%20main/41/api/json")) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ number: 41, result: "SUCCESS", duration: 180000 }));
    } else if (req.url.startsWith("/jenkins/job/folder/job/build%20main/42/api/json")) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ number: 42, result: "FAILURE", duration: 140000 }));
    } else if (req.url === "/jenkins/job/folder/job/build%20main/42/wfapi/describe") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ stages: [{ name: "检出", status: "SUCCESS" }, { name: "测试", status: "FAILED" }] }));
    } else if (req.url === "/jenkins/job/folder/job/build%20main/40/wfapi/describe") {
      res.writeHead(403).end();
    } else if (req.url.startsWith("/jenkins/queue/item/10/api/json")) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ id: 10, cancelled: true, task: { fullName: "folder/build main" }, executable: { number: 42 } }));
    } else if (req.url.startsWith("/jenkins/queue/item/11/api/json")) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ id: 11, task: { fullName: "folder/build main" }, executable: { number: 43 } }));
    } else if (req.url.startsWith("/jenkins/queue/item/7/api/json")) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ id: 7, why: "等待空闲执行器", task: { fullName: "folder/build main" } }));
    } else if (req.url.startsWith("/jenkins/job/folder/job/build%20main/api/json?tree=") && decodeURIComponent(req.url).includes("builds[number,queueId]")) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ builds: [{ queueId: 8, number: 42 }, { queueId: 7, number: 40 }] }));
    } else if (req.url.startsWith("/jenkins/job/folder/job/build%20main/api/json")) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ fullName: "folder/build main", lastBuild: { queueId: 8, number: 42 } }));
    } else if (req.url.startsWith("/jenkins/job/folder/job/build%20main/43/api/json")) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ number: 43, result: "SUCCESS" }));
    } else if (req.url === "/jenkins/job/folder/job/build%20main/buildWithParameters") {
      let body = "";
      for await (const chunk of req) body += chunk;
      assert.equal(body, "BRANCH=main");
      res.writeHead(201, { Location: "/jenkins/queue/item/7/" });
      res.end();
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address();
  const client = new Client({ name: "test-client", version: "0.1.0" });
  try {
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: [bundledServer],
      env: {
        ...process.env,
        JENKINS_CONFIG_FILE: configFile,
        JENKINS_URL: `http://127.0.0.1:${address.port}/jenkins/`,
        JENKINS_USER: "user",
        JENKINS_API_TOKEN: "token",
        JENKINS_MODE: "api",
      },
    }));
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name), [...apiToolNames, ...uiToolNames]);
    assert.equal(tools.tools.find((tool) => tool.name === "triggerBuild").annotations.readOnlyHint, false);
    const workspaceTool = tools.tools.find((tool) => tool.name === "openJenkinsWorkspace");
    assert.equal(workspaceTool.title, "Jenkins");
    assert.equal(workspaceTool.description, "打开 Jenkins 工作台");
    assert.equal(workspaceTool._meta.ui.resourceUri, uiManifest.workspace.uri);
    assert.deepEqual(workspaceTool.icons.map((icon) => icon.theme), ["light", "dark"]);
    for (const icon of workspaceTool.icons) {
      assert.equal(icon.mimeType, "image/svg+xml");
      assert.match(icon.src, /^data:image\/svg\+xml;base64,/);
      assert.match(Buffer.from(icon.src.split(",")[1], "base64").toString("utf8"), /viewBox="0 0 512 512"/);
    }
    assert.deepEqual(client.getServerVersion().icons, workspaceTool.icons);
    assert.deepEqual(tools.tools.find((tool) => tool.name === "openJenkinsPanel")._meta["openai/ui"].entrypoints, [{ type: "thread" }]);
    assert.equal(tools.tools.find((tool) => tool.name === "openJenkinsPanel").title, "Jenkins 构建");
    assert.deepEqual(tools.tools.find((tool) => tool.name === "uiGetBuild")._meta.ui.visibility, ["app"]);
    assert.deepEqual(tools.tools.find((tool) => tool.name === "uiGetJobParameters")._meta.ui.visibility, ["app"]);
    const resources = await client.listResources();
    assert.deepEqual(resources.resources.map((resource) => resource.uri).sort(), Object.values(uiManifest).map((entry) => entry.uri).sort());
    const cardResource = await client.readResource({ uri: uiManifest.card.uri });
    assert.equal(cardResource.contents[0].mimeType, "text/html;profile=mcp-app");
    assert.match(cardResource.contents[0].text, /data-mode="card"/);
    assert.deepEqual(cardResource.contents[0]._meta.ui.csp.connectDomains, []);
    assert.deepEqual(cardResource.contents[0]._meta["openai/ui"], {
      availableDisplayModes: ["inline", "fullscreen"], preferredDisplayMode: "inline",
    });
    const workspaceResource = await client.readResource({ uri: uiManifest.workspace.uri });
    assert.deepEqual(workspaceResource.contents[0]._meta["openai/ui"], { availableDisplayModes: ["fullscreen"] });
    const jobs = await client.callTool({ name: "getJobs", arguments: {} });
    assert.equal(jobs.structuredContent.jobs[0].name, "folder");
    assert.equal((await client.callTool({ name: "uiListJobs", arguments: {} })).structuredContent.jobs[0].name, "folder");
    const build = await client.callTool({ name: "getBuild", arguments: { jobFullName: "folder/build main", buildNumber: 42 } });
    assert.equal(build.structuredContent.result, "FAILURE");
    const card = await client.callTool({ name: "showJenkinsBuildCard", arguments: { jobFullName: "folder/build main", buildNumber: 42 } });
    assert.equal(card.structuredContent.build.number, 42);
    assert.equal(card.structuredContent.autoExpand, false);
    const expandedBuildCard = await client.callTool({ name: "showJenkinsBuildCard", arguments: { jobFullName: "folder/build main", buildNumber: 42, autoExpand: true } });
    assert.equal(expandedBuildCard.structuredContent.autoExpand, true);
    const queueCard = await client.callTool({ name: "showJenkinsQueueCard", arguments: { jobFullName: "folder/build main", queueId: 7 } });
    assert.equal(queueCard.structuredContent.queue.why, "等待空闲执行器");
    assert.equal(queueCard.structuredContent.autoExpand, true);
    const inlineQueueCard = await client.callTool({ name: "showJenkinsQueueCard", arguments: { jobFullName: "folder/build main", queueId: 7, autoExpand: false } });
    assert.equal(inlineQueueCard.structuredContent.autoExpand, false);
    const invalidExpand = await client.callTool({ name: "showJenkinsQueueCard", arguments: { jobFullName: "folder/build main", queueId: 7, autoExpand: "true" } });
    assert.equal(invalidExpand.isError, true);
    assert.match(invalidExpand.content[0].text, /autoExpand must be a boolean/);
    assert.equal((await client.callTool({ name: "uiGetQueueItem", arguments: { queueId: 7 } })).structuredContent.id, 7);
    const params = await client.callTool({ name: "uiGetJobParameters", arguments: { jobFullName: "folder/build main" } });
    assert.equal(params.structuredContent.parameters[0].defaultValue, "main");
    const gitChoices = await client.callTool({ name: "uiGetGitParameterChoices", arguments: { jobFullName: "folder/build main", parameterName: "GIT_REF" } });
    assert.deepEqual(gitChoices.structuredContent.choices.map((choice) => choice.value), ["main", "release"]);
    const cancelled = await client.callTool({ name: "uiTrackQueue", arguments: { jobFullName: "folder/build main", queueId: 10 } });
    assert.equal(cancelled.structuredContent.queue.cancelled, true);
    assert.equal(cancelled.structuredContent.build, undefined);
    const transitioned = await client.callTool({ name: "uiTrackQueue", arguments: { jobFullName: "folder/build main", queueId: 11 } });
    assert.equal(transitioned.structuredContent.build.number, 43);
    assert.deepEqual((await client.callTool({ name: "uiGetBuildStages", arguments: { jobFullName: "folder/build main", buildNumber: 42 } })).structuredContent.stages.map((stage) => stage.status), ["SUCCESS", "FAILED"]);
    const missingStages = (await client.callTool({ name: "uiGetBuildStages", arguments: { jobFullName: "folder/build main", buildNumber: 41 } })).structuredContent;
    assert.equal(missingStages.available, false);
    assert.equal(missingStages.reason, "not_found");
    const forbiddenStages = (await client.callTool({ name: "uiGetBuildStages", arguments: { jobFullName: "folder/build main", buildNumber: 40 } })).structuredContent;
    assert.equal(forbiddenStages.available, false);
    assert.equal(forbiddenStages.reason, "permission_denied");
    const expiredQueue = await client.callTool({ name: "showJenkinsQueueCard", arguments: { jobFullName: "folder/build main", queueId: 8 } });
    assert.equal(expiredQueue.structuredContent.build.number, 42);
    assert.equal(expiredQueue.structuredContent.autoExpand, true);
    const unmatchedExpiredQueue = await client.callTool({ name: "showJenkinsQueueCard", arguments: { jobFullName: "folder/build main", queueId: 99 } });
    assert.equal(unmatchedExpiredQueue.structuredContent.reason, "expired");
    assert.equal(unmatchedExpiredQueue.structuredContent.build, undefined);
    const wrongQueue = await client.callTool({ name: "showJenkinsQueueCard", arguments: { jobFullName: "another-job", queueId: 7 } });
    assert.equal(wrongQueue.isError, true);
    const choices = await client.callTool({ name: "showJenkinsJobChoices", arguments: {} });
    assert.equal(choices.structuredContent.jobs[0].name, "folder");
    const comparison = await client.callTool({ name: "showJenkinsBuildComparison", arguments: { jobFullName: "folder/build main", beforeBuildNumber: 41, afterBuildNumber: 42 } });
    assert.deepEqual([comparison.structuredContent.before.result, comparison.structuredContent.after.result], ["SUCCESS", "FAILURE"]);
    assert.equal((await client.callTool({ name: "openJenkinsWorkspace", arguments: {} })).structuredContent.view, "workspace");
    const rejected = await client.callTool({ name: "triggerBuild", arguments: { jobFullName: "folder/build main", parameters: { SECRET: { nested: true } } } });
    assert.equal(rejected.isError, true);
    const triggered = await client.callTool({ name: "triggerBuild", arguments: { jobFullName: "folder/build main", parameters: { BRANCH: "main" } } });
    assert.equal(triggered.structuredContent.queueId, "7");
    assert.equal(calls.filter((call) => call.method === "POST").length, 1);
  } finally {
    await client.close();
    await new Promise((resolve) => httpServer.close(resolve));
  }
});

test("MCP mode forwards allowed Jenkins tools and hides replay tools", async () => {
  const upstream = new Server({ name: "fixture-jenkins", version: "0.1.0" }, { capabilities: { tools: {} } });
  upstream.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
    { name: "getStatus", description: "Read health", inputSchema: { type: "object", properties: {} } },
    { name: "replayBuild", description: "Change script", inputSchema: { type: "object", properties: {} } },
  ] }));
  upstream.setRequestHandler(CallToolRequestSchema, async ({ params }) => ({ content: [{ type: "text", text: params.name }] }));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID });
  await upstream.connect(transport);
  const httpServer = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, "Basic dXNlcjp0b2tlbg==");
    if (req.url === "/jenkins/mcp-server/mcp") {
      await transport.handleRequest(req, res);
    } else if (req.url.startsWith("/jenkins/api/json")) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ jobs: [{ name: "from-api", fullName: "from-api" }] }));
    }
    else res.writeHead(404).end();
  });
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const client = new Client({ name: "test-client", version: "0.1.0" });
  try {
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: [bundledServer],
      env: {
        ...process.env,
        JENKINS_CONFIG_FILE: configFile,
        JENKINS_URL: `http://127.0.0.1:${httpServer.address().port}/jenkins/`,
        JENKINS_USER: "user",
        JENKINS_API_TOKEN: "token",
        JENKINS_MODE: "mcp",
      },
    }));
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name), ["getStatus", "getJobParameters", "getGitParameterChoices", ...uiToolNames]);
    assert.equal((await client.callTool({ name: "getStatus", arguments: {} })).content[0].text, "getStatus");
    assert.equal((await client.callTool({ name: "uiListJobs", arguments: {} })).structuredContent.jobs[0].name, "from-api");
    assert.equal((await client.callTool({ name: "replayBuild", arguments: {} })).isError, true);
  } finally {
    await client.close();
    await upstream.close();
    await new Promise((resolve) => httpServer.close(resolve));
  }
});
