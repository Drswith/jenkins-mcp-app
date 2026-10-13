import assert from "node:assert/strict";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

if (!process.env.JENKINS_CONFIG_FILE) throw new Error("Set JENKINS_CONFIG_FILE to the private local-test config");
const server = resolve("release/jenkins/dist/server.mjs");

async function connect(mode) {
  const client = new Client({ name: `jenkins-live-${mode}-test`, version: "0.1.0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [server],
    env: { ...process.env, JENKINS_MODE: mode },
  }));
  return client;
}

async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  assert.ok(!result.isError, `${name} failed`);
  return result;
}

const mcp = await connect("mcp");
try {
  const names = (await mcp.listTools()).tools.map((tool) => tool.name);
  for (const name of ["getStatus", "getJobs", "triggerBuild", "uiListJobs", "showJenkinsBuildCard"]) assert.ok(names.includes(name), `${name} missing`);
  assert.match((await call(mcp, "getJobs")).content[0].text, /codex-smoke/);
  assert.ok((await call(mcp, "uiListJobs")).structuredContent.jobs.some((job) => job.fullName === "codex-smoke"));
  const resources = await mcp.listResources();
  assert.equal(resources.resources.length, 3);
  for (const resource of resources.resources) {
    const html = await mcp.readResource({ uri: resource.uri });
    assert.equal(html.contents[0].mimeType, "text/html;profile=mcp-app");
  }
  const triggered = await call(mcp, "triggerBuild", { jobFullName: "codex-smoke" });
  assert.match(triggered.content[0].text, /"status":"COMPLETED"/);
  console.log("MCP: tools, job, UI resources and trigger passed");
} finally {
  await mcp.close();
}

const api = await connect("api");
try {
  let build;
  for (let attempt = 0; attempt < 30; attempt++) {
    const job = (await call(api, "getJob", { jobFullName: "codex-smoke" })).structuredContent;
    if (job.lastBuild?.number) {
      build = (await call(api, "getBuild", { jobFullName: "codex-smoke", buildNumber: job.lastBuild.number })).structuredContent;
      if (!build.building) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.equal(build?.result, "SUCCESS");
  const args = { jobFullName: "codex-smoke", buildNumber: build.number };
  assert.match((await call(api, "getBuildLog", args)).structuredContent.log, /Jenkins Codex local test build/);
  assert.equal((await call(api, "showJenkinsBuildCard", args)).structuredContent.build.number, build.number);
  assert.match((await call(api, "uiGetBuildLog", args)).structuredContent.log, /Jenkins Codex local test build/);
  console.log(`API and UI: build #${build.number} SUCCESS, log and card passed`);
} finally {
  await api.close();
}

if (process.argv.includes("--scm")) {
  const scmUrl = process.env.JENKINS_TEST_SCM_URL || "git://git-fixture:9418/sample.git";
  const jobFullName = "codex-scm-smoke";
  const mcp = await connect("mcp");
  const api = await connect("api");
  const mcpResult = async (name, args) => JSON.parse((await call(mcp, name, args)).content[0].text).result;
  const waitForBuild = async (afterNumber) => {
    for (let attempt = 0; attempt < 30; attempt++) {
      const job = (await call(api, "getJob", { jobFullName })).structuredContent;
      if (job.lastBuild?.number > afterNumber) {
        const build = (await call(api, "getBuild", { jobFullName, buildNumber: job.lastBuild.number })).structuredContent;
        if (!build.building) return build;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error("SCM build did not finish in time");
  };
  try {
    const configured = await mcpResult("getJobScm", { jobFullName });
    assert.ok(configured.some((entry) => entry.uris?.includes(scmUrl)));
    let previousNumber = (await call(api, "getJob", { jobFullName })).structuredContent.lastBuild?.number ?? 0;
    if (!previousNumber) {
      await call(mcp, "triggerBuild", { jobFullName });
      const baseline = await waitForBuild(0);
      assert.equal(baseline.result, "SUCCESS");
      previousNumber = baseline.number;
    }
    if (process.env.JENKINS_TEST_GITEA_SERVICE_ID) {
      const args = ["zeabur@latest", "service", "exec", "-i=false", "--id", process.env.JENKINS_TEST_GITEA_SERVICE_ID];
      if (process.env.JENKINS_TEST_ENVIRONMENT_ID) args.push("--env-id", process.env.JENKINS_TEST_ENVIRONMENT_ID);
      args.push("--", "su", "git", "-s", "/bin/sh", "-c", "exec /bin/sh /opt/gitea-bootstrap/seed.sh --commit");
      execFileSync("npx", args, { stdio: "ignore", timeout: 120000 });
    } else {
      execFileSync("docker", ["exec", "jenkins-codex-git-fixture", "sh", "-lc",
        "printf 'SCM live test\\n' >> /seed/README.md && git -C /seed add README.md && git -C /seed commit -m 'Exercise Jenkins change set' && git -C /seed push origin master"], { stdio: "ignore" });
    }
    await call(mcp, "triggerBuild", { jobFullName });
    const build = await waitForBuild(previousNumber);
    assert.equal(build.result, "SUCCESS");
    const args = { jobFullName, buildNumber: build.number };
    const buildScm = await mcpResult("getBuildScm", args);
    assert.ok(buildScm.some((entry) => entry.uris?.includes(scmUrl) && entry.commit));
    const changeSets = await mcpResult("getBuildChangeSets", args);
    assert.ok(changeSets.some((set) => set.items?.some((item) => item.msg === "Exercise Jenkins change set")));
    const found = await mcpResult("findJobsWithScmUrl", { scmUrl });
    assert.ok(found.some((job) => job.fullName === jobFullName));
    console.log(`SCM: build #${build.number} SUCCESS, repository, commit and change set passed`);
  } finally {
    await api.close();
    await mcp.close();
  }
}
