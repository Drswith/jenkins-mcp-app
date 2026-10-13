import { readFileSync } from "node:fs";
import { apiTools, normalizeJenkinsUrl, request } from "./api.js";
import { jobPath } from "./config.js";

const manifest = JSON.parse(readFileSync(new URL("./ui/manifest.json", import.meta.url), "utf8"));
const apiByName = new Map(apiTools.map((tool) => [tool.name, tool]));
export const uiIcons = [
  ["light", "jenkins-build-light.svg"],
  ["dark", "jenkins-build-dark.svg"],
].map(([theme, file]) => ({
  src: `data:image/svg+xml;base64,${readFileSync(new URL(`../assets/${file}`, import.meta.url)).toString("base64")}`,
  mimeType: "image/svg+xml",
  sizes: ["any"],
  theme,
}));

const inputSchema = {
  empty: { type: "object", properties: {}, additionalProperties: false },
  job: { type: "object", properties: { jobFullName: { type: "string" } }, required: ["jobFullName"], additionalProperties: false },
  build: { type: "object", properties: { jobFullName: { type: "string" }, buildNumber: { type: "integer", minimum: 1 } }, required: ["jobFullName"], additionalProperties: false },
  queue: { type: "object", properties: { jobFullName: { type: "string" }, queueId: { type: "integer", minimum: 1 } }, required: ["jobFullName", "queueId"], additionalProperties: false },
  choices: { type: "object", properties: { filter: { type: "string", enum: ["all", "failed", "running"] } }, additionalProperties: false },
  comparison: { type: "object", properties: { jobFullName: { type: "string" }, beforeBuildNumber: { type: "integer", minimum: 1 }, afterBuildNumber: { type: "integer", minimum: 1 } }, required: ["jobFullName", "beforeBuildNumber", "afterBuildNumber"], additionalProperties: false },
  optionalBuild: { type: "object", properties: { jobFullName: { type: "string" }, buildNumber: { type: "integer", minimum: 1 } }, additionalProperties: false },
  parameterJob: { type: "object", properties: { jobFullName: { type: "string" } }, required: ["jobFullName"], additionalProperties: false },
  gitChoices: { type: "object", properties: { jobFullName: { type: "string" }, parameterName: { type: "string" } }, required: ["jobFullName", "parameterName"], additionalProperties: false },
};

function tool(name, description, schema, { title = description, view, entrypoint, appOnly = false } = {}) {
  const _meta = { ui: { ...(view ? { resourceUri: manifest[view].uri } : {}), ...(appOnly ? { visibility: ["app"] } : {}) } };
  if (entrypoint) _meta["openai/ui"] = { entrypoints: [{ type: entrypoint }] };
  return {
    name, title, description, inputSchema: schema,
    ...(entrypoint ? { icons: uiIcons } : {}),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    _meta,
  };
}

export const uiTools = [
  tool("openJenkinsWorkspace", "打开 Jenkins 工作台", inputSchema.empty, { title: "Jenkins", view: "workspace", entrypoint: "global" }),
  tool("openJenkinsPanel", "在对话侧边栏查看 Jenkins 构建", inputSchema.optionalBuild, { title: "Jenkins 构建", view: "panel", entrypoint: "thread" }),
  tool("showJenkinsBuildCard", "在对话中显示 Jenkins 构建状态卡片；运行中可持续刷新，失败时可查看日志证据", inputSchema.build, { view: "card" }),
  tool("showJenkinsQueueCard", "在对话中追踪已提交的 Jenkins 构建队列项；请在 triggerBuild 返回队列 ID 后调用", inputSchema.queue, { view: "card" }),
  tool("showJenkinsJobChoices", "在对话中显示可选择的 Jenkins 任务", inputSchema.choices, { view: "card" }),
  tool("showJenkinsBuildComparison", "在对话中比较同一 Jenkins 任务的两次构建", inputSchema.comparison, { view: "card" }),
  tool("uiListJobs", "读取工作台任务列表", inputSchema.empty, { appOnly: true }),
  tool("uiGetJob", "读取工作台任务或文件夹", inputSchema.job, { appOnly: true }),
  tool("uiGetBuild", "读取工作台构建详情", inputSchema.build, { appOnly: true }),
  tool("uiGetBuildLog", "读取工作台构建日志", inputSchema.build, { appOnly: true }),
  tool("uiGetQueueItem", "读取内联卡片队列项", { type: "object", properties: { queueId: { type: "integer", minimum: 1 } }, required: ["queueId"], additionalProperties: false }, { appOnly: true }),
  tool("uiTrackQueue", "追踪工作台队列项及其对应构建", inputSchema.queue, { appOnly: true }),
  tool("uiGetBuildStages", "读取可用的 Pipeline 阶段信息", inputSchema.build, { appOnly: true }),
  tool("uiGetJobParameters", "读取工作台任务参数定义", inputSchema.parameterJob, { appOnly: true }),
  tool("uiGetGitParameterChoices", "读取工作台 Git 参数候选", inputSchema.gitChoices, { appOnly: true }),
];

export const uiResources = Object.values(manifest).map(({ uri, file }) => ({
  uri, name: file, mimeType: "text/html;profile=mcp-app",
}));

export function readUiResource(uri, config) {
  const item = Object.values(manifest).find((entry) => entry.uri === uri);
  if (!item) throw new Error("Unknown UI resource");
  const origin = config.baseUrl.origin;
  return {
    contents: [{
      uri, mimeType: "text/html;profile=mcp-app",
      text: readFileSync(new URL(`./ui/${item.file}`, import.meta.url), "utf8"),
      _meta: {
        ui: { prefersBorder: item.mode === "card", csp: { connectDomains: [], resourceDomains: [] } },
        "openai/ui": { availableDisplayModes: item.mode === "workspace" ? ["fullscreen"] : ["inline", "fullscreen"] },
        "openai/widgetDescription": item.mode === "card" ? "Jenkins 构建结果卡片" : "Jenkins 构建信息界面",
        "openai/widgetCSP": { redirect_domains: [origin] },
      },
    }],
  };
}

export async function callUiTool(config, name, args) {
  if (name === "openJenkinsWorkspace") return response({ view: "workspace" });
  if (name === "openJenkinsPanel") return response({ view: "panel", ...args });
  if (name === "showJenkinsBuildCard") {
    const build = await apiByName.get("getBuild").call(config, args);
    return response({ view: "card", jobFullName: args.jobFullName, build: build.structuredContent });
  }
  if (name === "showJenkinsQueueCard" || name === "uiTrackQueue") {
    try {
      const queue = await apiByName.get("getQueueItem").call(config, { queueId: args.queueId });
      const task = queue.structuredContent.task ?? {};
      const expectedJobUrl = new URL(`${jobPath(args.jobFullName)}/`, config.baseUrl).toString();
      const taskUrl = typeof task.url === "string" ? task.url : null;
      const canonicalTaskUrl = taskUrl ? normalizeJenkinsUrl(config, taskUrl) : null;
      const nameCanVerify = !args.jobFullName.includes("/") && task.name === args.jobFullName;
      if (task.fullName ? task.fullName !== args.jobFullName : canonicalTaskUrl ? canonicalTaskUrl !== expectedJobUrl : !nameCanVerify) {
        throw new Error("Queue item belongs to another Jenkins job or has no verifiable job identity");
      }
      if (!queue.structuredContent.cancelled && queue.structuredContent.executable?.number) {
        const build = await apiByName.get("getBuild").call(config, { jobFullName: args.jobFullName, buildNumber: queue.structuredContent.executable.number });
        return response({ view: "card", jobFullName: args.jobFullName, build: build.structuredContent });
      }
      return response({ view: "queue", jobFullName: args.jobFullName, queueId: args.queueId, queue: queue.structuredContent });
    } catch (error) {
      if (!/HTTP 404/.test(String(error))) throw error;
      const historyResponse = await request(config, `${jobPath(args.jobFullName)}/api/json?tree=${encodeURIComponent("builds[number,queueId]{0,50}")}`);
      const history = await historyResponse.json();
      const match = (history.builds ?? []).find((build) => Number(build.queueId) === args.queueId && Number.isInteger(build.number) && build.number > 0);
      if (!match) return response({ view: "queue", jobFullName: args.jobFullName, queueId: args.queueId, queue: { id: args.queueId, expired: true }, reason: "expired" });
      const build = await apiByName.get("getBuild").call(config, { jobFullName: args.jobFullName, buildNumber: match.number });
      return response({ view: "card", jobFullName: args.jobFullName, build: build.structuredContent });
    }
  }
  if (name === "showJenkinsJobChoices") {
    const jobs = await apiByName.get("getJobs").call(config, {});
    const filter = args.filter ?? "all";
    const rows = (jobs.structuredContent.jobs ?? []).filter((job) => {
      if (filter === "all") return true;
      const result = String(job.lastBuild?.result ?? "").toUpperCase();
      const color = String(job.color ?? "");
      return filter === "running" ? Boolean(job.lastBuild?.building || color.endsWith("_anime")) : ["FAILURE", "UNSTABLE"].includes(result) || ["red", "yellow"].includes(color);
    }).sort((a, b) => (b.lastBuild?.timestamp ?? 0) - (a.lastBuild?.timestamp ?? 0)).slice(0, 5);
    return response({ view: "choices", filter, jobs: rows });
  }
  if (name === "showJenkinsBuildComparison") {
    if (args.beforeBuildNumber === args.afterBuildNumber) throw new Error("Choose two different build numbers");
    const [before, after] = await Promise.all([
      apiByName.get("getBuild").call(config, { jobFullName: args.jobFullName, buildNumber: args.beforeBuildNumber }),
      apiByName.get("getBuild").call(config, { jobFullName: args.jobFullName, buildNumber: args.afterBuildNumber }),
    ]);
    return response({ view: "comparison", jobFullName: args.jobFullName, before: before.structuredContent, after: after.structuredContent });
  }
  if (name === "uiGetBuildStages") {
    try {
      const result = await request(config, `${jobPath(args.jobFullName)}/${args.buildNumber ?? "lastBuild"}/wfapi/describe`);
      const data = await result.json();
      return response({ available: true, stages: Array.isArray(data.stages) ? data.stages.map(({ name, status }) => ({ name, status })) : [] });
    } catch (error) {
      if (/HTTP 403/.test(String(error))) return response({ available: false, stages: [], reason: "permission_denied" });
      if (/HTTP 404/.test(String(error))) return response({ available: false, stages: [], reason: "not_found" });
      throw error;
    }
  }
  if (name === "uiGetJobParameters") return apiByName.get("getJobParameters").call(config, args);
  if (name === "uiGetGitParameterChoices") return apiByName.get("getGitParameterChoices").call(config, args);
  const source = {
    uiListJobs: "getJobs", uiGetJob: "getJob", uiGetBuild: "getBuild", uiGetBuildLog: "getBuildLog", uiGetQueueItem: "getQueueItem",
  }[name];
  if (!source) throw new Error("Unknown UI tool");
  return apiByName.get(source).call(config, args);
}

function response(value) {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
}
