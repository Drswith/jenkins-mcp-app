import assert from "node:assert/strict";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const privateDir = ".local/jenkins-target-fixtures";
const readerPath = resolve(privateDir, "reader.json");
const reader = JSON.parse(await readFile(readerPath, "utf8"));
const admin = JSON.parse(await readFile(".local/jenkins-legacy/config.json", "utf8"));
const allowedHosts = new Set([
  "https://jenkins-legacy-drs-sg.zeabur.app/",
  "https://jenkins-mcp-drs-sg.zeabur.app/",
]);
const root = new URL(admin.JENKINS_URL).href;
assert.ok(allowedHosts.has(root), "configured controller must be an allowed SG URL");
assert.equal(new URL(reader.JENKINS_URL).href, root, "reader and admin must target the same SG controller");
const auth = `Basic ${Buffer.from(`${reader.JENKINS_USER}:${reader.JENKINS_API_TOKEN}`).toString("base64")}`;

async function adminScript(code) {
  const response = await fetch(new URL("scriptText", root), {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${admin.JENKINS_USER}:${admin.JENKINS_API_TOKEN}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ script: code }).toString(),
    redirect: "manual",
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  assert.equal(response.status, 200, `admin Script Console returned HTTP ${response.status}`);
  return JSON.parse(text);
}

const effective = await adminScript(`import jenkins.model.Jenkins; import hudson.model.Hudson; import hudson.model.Item; import hudson.model.View; import hudson.model.User; import org.jenkinsci.plugins.workflow.cps.replay.ReplayAction; import groovy.json.JsonOutput; import java.security.MessageDigest; def j=Jenkins.get(); def job=j.getItem('sg-target-restricted'); if(!job) throw new IllegalStateException('fixture missing'); def reader=User.getById('sg-target-reader',false); def admin=User.getById('codex-test',false); if(!reader||!admin) throw new IllegalStateException('expected users missing'); def ra=reader.impersonate(); def aa=admin.impersonate(); def p=j.pluginManager.getPlugin('matrix-auth'); def config=new File(j.rootDir,'config.xml').getText('UTF-8'); def cm=(config =~ /<authorizationStrategy class="([^"]+)"/); def configStrategy=cm.find()?cm.group(1):null; def archive=new File(j.rootDir,'plugins/matrix-auth.jpi'); def sha=archive.exists()?MessageDigest.getInstance('SHA-256').digest(archive.bytes).encodeHex().toString():null; def grants=j.authorizationStrategy.grantedPermissions.collectEntries{k,v->[(k.id):v.toList().sort()]}; def checks=[core:Jenkins.VERSION.toString(),plugin:p?.version,strategy:j.authorizationStrategy.class.name,configStrategy:configStrategy,archiveExists:archive.exists(),archiveSha256:sha,grants:grants,overallRead:j.getACL().hasPermission(ra,Hudson.READ),overallAdmin:j.getACL().hasPermission(ra,Hudson.ADMINISTER),itemRead:job.getACL().hasPermission(ra,Item.READ),itemBuild:job.getACL().hasPermission(ra,Item.BUILD),itemConfigure:job.getACL().hasPermission(ra,Item.CONFIGURE),viewRead:j.getView('all').getACL().hasPermission(ra,View.READ),adminPreserved:j.getACL().hasPermission(aa,Hudson.ADMINISTER),nextBuildNumber:job.nextBuildNumber,anonymousOverallRead:j.getACL().hasPermission(Jenkins.ANONYMOUS,Hudson.READ)]; try { checks.itemReplay=job.getACL().hasPermission(ra,ReplayAction.REPLAY) } catch(Exception ignored) { checks.itemReplay=false }; println(JsonOutput.toJson(checks))`);
assert.deepEqual({
  core: effective.core, plugin: effective.plugin, strategy: effective.strategy,
  configStrategy: effective.configStrategy, archiveExists: effective.archiveExists,
  archiveSha256: effective.archiveSha256,
  overallRead: effective.overallRead, overallAdmin: effective.overallAdmin,
  itemRead: effective.itemRead, itemBuild: effective.itemBuild,
  itemConfigure: effective.itemConfigure, itemReplay: effective.itemReplay,
  viewRead: effective.viewRead, adminPreserved: effective.adminPreserved,
  anonymousOverallRead: effective.anonymousOverallRead,
  nextBuildNumber: effective.nextBuildNumber,
}, {
  core: "2.263.1", plugin: "2.6.11",
  strategy: "hudson.security.GlobalMatrixAuthorizationStrategy",
  configStrategy: "hudson.security.GlobalMatrixAuthorizationStrategy",
  archiveExists: true,
  archiveSha256: "f70d8ba943478fb4966375e7c4ab213e7a0665bd88e9558d9c12492f1dee7dbd",
  overallRead: true, overallAdmin: false, itemRead: true,
  itemBuild: false, itemConfigure: false, itemReplay: false,
  viewRead: true, adminPreserved: true, anonymousOverallRead: false,
  nextBuildNumber: 1,
}, "effective permissions and pre-build fixture state");

const client = new Client({ name: "sg-target-reader-verification", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve("release/jenkins/dist/server.mjs")],
  env: {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("JENKINS_"))),
    JENKINS_CONFIG_FILE: readerPath,
    JENKINS_MODE: "api",
  },
});
await client.connect(transport);
async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  assert.ok(!result.isError, `${name} returned an MCP error`);
  return result.structuredContent ?? JSON.parse(result.content.find((part) => part.type === "text").text);
}

try {
  const listed = await call("getJobs");
  const target = await call("getJob", { jobFullName: "sg-target-restricted" });
  const toolNames = (await client.listTools()).tools.map((tool) => tool.name);
  assert.ok(toolNames.includes("uiGetBuildStages"), "generated MCP package should expose uiGetBuildStages");
  let sampleBuild;
  let stageData;
  const candidates = (listed.jobs ?? []).filter((job) =>
    job._class === "org.jenkinsci.plugins.workflow.job.WorkflowJob" &&
    Number.isInteger(job.lastBuild?.number) && !job.lastBuild?.building,
  );
  for (const candidate of candidates) {
    try {
      const detail = await call("getJob", { jobFullName: candidate.fullName });
      if (!Number.isInteger(detail.lastBuild?.number)) continue;
      const build = await call("getBuild", { jobFullName: detail.fullName, buildNumber: detail.lastBuild.number });
      const stages = await call("uiGetBuildStages", { jobFullName: detail.fullName, buildNumber: detail.lastBuild.number });
      if (stages.available) {
        sampleBuild = { job: detail.fullName, number: build.number, result: build.result };
        stageData = stages;
        break;
      }
    } catch {}
  }
  assert.ok(sampleBuild && stageData, "reader should read a Pipeline build and stage data");

  async function readerStatus(path, options = {}) {
    const response = await fetch(new URL(path, root), {
      ...options,
      headers: { Authorization: auth, ...options.headers },
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    });
    await response.arrayBuffer();
    return response.status;
  }
  const denials = {
    pluginManager: await readerStatus("pluginManager/api/json?tree=plugins%5BshortName%2Cversion%5D"),
    fixtureConfigXml: await readerStatus("job/sg-target-restricted/config.xml"),
    buildWithParameters: await readerStatus("job/sg-target-restricted/buildWithParameters", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "probe=permission-check",
    }),
  };
  assert.deepEqual(denials, { pluginManager: 403, fixtureConfigXml: 403, buildWithParameters: 403 });
  const finalFixture = await adminScript(`import jenkins.model.Jenkins; import hudson.model.Item; import hudson.model.User; import groovy.json.JsonOutput; def j=Jenkins.get(); def job=j.getItem('sg-target-restricted'); def auth=User.getById('sg-target-reader',false).impersonate(); println(JsonOutput.toJson([build:job.getACL().hasPermission(auth,Item.BUILD),nextBuildNumber:job.nextBuildNumber]))`);
  assert.equal(finalFixture.build, false, "reader must remain unable to build");
  assert.equal(finalFixture.nextBuildNumber, effective.nextBuildNumber, "denied request must not create a build");

  const report = {
    checkedAt: new Date().toISOString(), controller: root, core: effective.core,
    plugin: { id: "matrix-auth", version: effective.plugin, sha256: "f70d8ba943478fb4966375e7c4ab213e7a0665bd88e9558d9c12492f1dee7dbd" },
    authorizationStrategy: effective.strategy,
    persistentState: { configXmlStrategy: effective.configStrategy, pluginArchivePresent: effective.archiveExists, pluginArchiveSha256: effective.archiveSha256, directGrants: effective.grants },
    effectivePermissions: {
      readerOverallRead: effective.overallRead, readerOverallAdminister: effective.overallAdmin,
      readerItemRead: effective.itemRead, readerBuild: effective.itemBuild,
      readerConfigure: effective.itemConfigure, readerReplay: effective.itemReplay,
      readerViewRead: effective.viewRead, codexTestOverallAdminister: effective.adminPreserved,
      anonymousOverallRead: effective.anonymousOverallRead,
    },
    sourceTools: {
      getJobs: { status: "ok", visibleJobCount: listed.jobs?.length ?? 0 },
      getJob: { status: "ok", fixture: target.fullName },
      getBuild: { status: "ok", ...sampleBuild },
      uiGetBuildStages: { status: "ok", available: stageData.available, stageCount: stageData.stages.length },
    },
    deniedRequests: denials,
    fixture: { fullName: "sg-target-restricted", nextBuildNumberBefore: effective.nextBuildNumber, nextBuildNumberAfter: finalFixture.nextBuildNumber },
  };
  const reportPath = resolve(privateDir, "permission-verification.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  await chmod(reportPath, 0o600);
  process.stdout.write(`${JSON.stringify({ reportPath, effectivePermissions: report.effectivePermissions, deniedRequests: denials, fixture: report.fixture })}\n`);
} finally {
  await client.close();
}
