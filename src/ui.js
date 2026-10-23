import { readFileSync } from "node:fs";
import { apiTools, normalizeJenkinsUrl, request } from "./api.js";
import { readSettings, watchedJobs } from "./settings.js";
import { logEvidence, prepareParameters, changesSinceSuccess } from "./evidence.js";
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
  confirmation: { type: "object", properties: { jobFullName: { type: "string" }, parameters: { type: "object", additionalProperties: { type: ["string", "number", "boolean"] } } }, required: ["jobFullName"], additionalProperties: false },
  parameterJob: { type: "object", properties: { jobFullName: { type: "string" } }, required: ["jobFullName"], additionalProperties: false },
  gitChoices: { type: "object", properties: { jobFullName: { type: "string" }, parameterName: { type: "string" } }, required: ["jobFullName", "parameterName"], additionalProperties: false },
};

function cardSchema(schema, defaultExpand = false) {
  return { ...schema, properties: { ...schema.properties, autoExpand: { type: "boolean", default: defaultExpand, description: "请求宿主自动展开卡片；宿主可能不支持或拒绝。" } } };
}

function tool(name, description, schema, { title = description, view, entrypoint, appOnly = false } = {}) {
  const _meta = { ui: { ...(view ? { resourceUri: manifest[view].uri } : {}), ...(appOnly ? { visibility: ["app"] } : {}) } };
  if (entrypoint) _meta["openai/ui"] = { entrypoints: [{ type: entrypoint }] };
  return {
    name, title, description, inputSchema: schema,
    ...(entrypoint ? { icons: uiIcons } : {}),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta,
  };
}

export const uiTools = [
  tool("openJenkinsWorkspace", "查看关注任务的最新结果", inputSchema.empty, { title: "Jenkins", view: "workspace", entrypoint: "global" }),
  tool("showJenkinsTriggerConfirmation", "准备触发确认卡，展示全部参数及默认值差异；只预览，不提交构建", cardSchema(inputSchema.confirmation), { view: "card" }),
  tool("uiGetBuildEvidence", "读取指定构建的阶段、日志片段及相对上次成功的变更", inputSchema.build, { appOnly: true }),
  tool("showJenkinsBuildCard", "在对话中显示 Jenkins 构建状态卡片；运行中可持续刷新，失败时可查看日志证据", cardSchema(inputSchema.build), { view: "card" }),
  tool("showJenkinsQueueCard", "追踪已提交的 Jenkins 队列项，默认保持内联；在 triggerBuild 返回队列 ID 后调用", cardSchema(inputSchema.queue), { view: "card" }),
  tool("showJenkinsJobChoices", "在对话中显示可选择的 Jenkins 任务", cardSchema(inputSchema.choices), { view: "card" }),
  tool("showJenkinsBuildComparison", "在对话中比较同一 Jenkins 任务的两次构建", cardSchema(inputSchema.comparison), { view: "card" }),
  tool("uiGetWatchedJobs", "读取最多 8 个关注任务的最新结果", inputSchema.empty, { appOnly: true }),
  tool("checkJenkinsConnection", "只读检测连接与权限；构建执行权限保持未验证，不提交测试构建", inputSchema.empty, { title: "检测连接与权限", view: "card" }),
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
        "openai/ui": {
          availableDisplayModes: item.mode === "workspace" ? ["fullscreen"] : ["inline", "fullscreen"],
          ...(item.mode === "card" ? { preferredDisplayMode: "inline" } : {}),
        },
        "openai/widgetDescription": item.mode === "card" ? "Jenkins 构建结果卡片" : "Jenkins 构建信息界面",
        "openai/widgetCSP": { redirect_domains: [origin] },
      },
    }],
  };
}

export async function callUiTool(config, name, args) {
  const cardResponse = (value) => {
    if (!name.startsWith("showJenkins")) return response(value);
    const buildFact = (build) => build && Object.fromEntries(["number", "result", "building", "duration", "timestamp", "url"].filter((key) => build[key] !== undefined).map((key) => [key, build[key]]));
    const facts = { ...(value.jobFullName ? { jobFullName: value.jobFullName } : {}) };
    if (value.build) facts.build = buildFact(value.build);
    if (value.queue) Object.assign(facts, { queueId: value.queueId, cancelled: Boolean(value.queue.cancelled), expired: Boolean(value.queue.expired), why: value.queue.why ?? null });
    if (value.jobs) facts.jobs = value.jobs.map((job) => ({ fullName: job.fullName || job.name, build: buildFact(job.lastBuild) }));
    if (value.before) Object.assign(facts, { before: buildFact(value.before), after: buildFact(value.after) });
    if (value.parameters) Object.assign(facts, { confirmationRequired: true, parameters: Object.fromEntries(value.parameters.filter((item) => !item.blocked).map((item) => [item.name, item.value])), blocked: value.parameters.some((item) => item.blocked) });
    return { ...response(facts), _meta: { card: { ...value, autoExpand: args.autoExpand ?? false } } };
  };
  if (name === "openJenkinsWorkspace") return response({ view: "workspace" });
  if (name === "uiGetWatchedJobs") {
    const names = watchedJobs(readSettings(config).watchedJobs);
    const jobs = await Promise.all(names.map(async (jobFullName) => {
      try {
        const job = (await apiByName.get("getJob").call(config, { jobFullName })).structuredContent;
        return { jobFullName, url: job.url, build: job.lastBuild ?? null };
      } catch (error) { return { jobFullName, url: new URL(`${jobPath(jobFullName)}/`, config.baseUrl).toString(), error: error.message }; }
    }));
    return response({ jobs });
  }
  if (name === "checkJenkinsConnection") {
    const checks = [];
    async function check(capability, action) {
      try { const result = await action(); checks.push({ capability, status: "available" }); return result; }
      catch (error) { checks.push({ capability, status: /HTTP 403/.test(error.message) ? "denied" : /HTTP 404/.test(error.message) ? "unavailable" : "error", message: error.message }); return null; }
    }
    const listed = await check("任务读取", () => apiByName.get("getJobs").call(config, {}));
    const candidate = listed?.structuredContent?.jobs?.find((job) => job.lastBuild?.number);
    const name = watchedJobs(readSettings(config).watchedJobs)[0] || candidate?.fullName || candidate?.name;
    if (name) {
      const job = await check("指定任务", () => apiByName.get("getJob").call(config, {jobFullName:name}));
      await check("参数定义", () => apiByName.get("getJobParameters").call(config, {jobFullName:name}));
      if (job?.structuredContent.lastBuild?.number) {
        const exact = {jobFullName:name,buildNumber:job.structuredContent.lastBuild.number};
        await check("构建读取", () => apiByName.get("getBuild").call(config, exact));
        await check("日志读取", () => apiByName.get("getBuildLog").call(config, exact));
        const stages = await callUiTool(config,"uiGetBuildStages",exact).catch(() => null);
        checks.push({capability:"Pipeline 阶段",status:stages?.structuredContent.available ? "available" : stages?.structuredContent.reason === "permission_denied" ? "denied" : "unavailable"});
      } else checks.push({capability:"构建、日志和阶段",status:"unknown",message:"没有可用于检测的既有构建"});
    } else checks.push({capability:"参数、构建、日志和阶段",status:"unknown",message:"没有可用于检测的任务"});
    checks.push({capability:"触发构建权限",status:"unknown",message:"只读检测无法确认执行权限，未触发构建"});
    if (config.mode === "mcp") checks.push({capability:"上游 MCP",status:"unknown",message:"本页检查 REST 读取；MCP 连接由模型读取工具另行验证"});
    return { ...response({ checks }), _meta: { card: { view:"connection",checks,autoExpand:false } } };
  }
  if (name === "showJenkinsTriggerConfirmation") {
    const result = await apiByName.get("getJobParameters").call(config, args);
    return cardResponse({ view: "confirmation", jobFullName: args.jobFullName, parameters: prepareParameters(result.structuredContent.parameters, args.parameters) });
  }
  if (name === "uiGetBuildEvidence") {
    const build = (await apiByName.get("getBuild").call(config, args)).structuredContent;
    const exact = { jobFullName: args.jobFullName, buildNumber: build.number };
    const [stages, log, changes] = await Promise.allSettled([
      callUiTool(config, "uiGetBuildStages", exact),
      apiByName.get("getBuildLog").call(config, exact),
      request(config, `${jobPath(args.jobFullName)}/api/json?tree=${encodeURIComponent("builds[number,result,building,changeSet[items[commitId,msg,author[fullName]]],changeSets[items[commitId,msg,author[fullName]]]]{0,50}")}`).then((result) => result.json()).then((result) => changesSinceSuccess(result.builds ?? [], build.number)),
    ]);
    return response({ jobFullName: args.jobFullName, build,
      stages: stages.status === "fulfilled" ? stages.value.structuredContent : { available: false, reason: "request_failed", message: stages.reason.message },
      log: log.status === "fulfilled" ? { ...logEvidence(log.value.structuredContent.log, readSettings(config).evidenceLines), truncated: Boolean(log.value.structuredContent.truncated) } : { lines: [], error: log.reason.message },
      changes: changes.status === "fulfilled" ? changes.value : { available: false, reason: changes.reason.message, commits: [] },
    });
  }
  if (name === "showJenkinsBuildCard") {
    const build = await apiByName.get("getBuild").call(config, args);
    return cardResponse({ view: "card", jobFullName: args.jobFullName, build: build.structuredContent });
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
        return cardResponse({ view: "card", jobFullName: args.jobFullName, build: build.structuredContent });
      }
      return cardResponse({ view: "queue", jobFullName: args.jobFullName, queueId: args.queueId, queue: queue.structuredContent });
    } catch (error) {
      if (!/HTTP 404/.test(String(error))) throw error;
      const historyResponse = await request(config, `${jobPath(args.jobFullName)}/api/json?tree=${encodeURIComponent("builds[number,queueId]{0,50}")}`);
      const history = await historyResponse.json();
      const match = (history.builds ?? []).find((build) => Number(build.queueId) === args.queueId && Number.isInteger(build.number) && build.number > 0);
      if (!match) return cardResponse({ view: "queue", jobFullName: args.jobFullName, queueId: args.queueId, queue: { id: args.queueId, expired: true }, reason: "expired" });
      const build = await apiByName.get("getBuild").call(config, { jobFullName: args.jobFullName, buildNumber: match.number });
      return cardResponse({ view: "card", jobFullName: args.jobFullName, build: build.structuredContent });
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
    return cardResponse({ view: "choices", filter, jobs: rows });
  }
  if (name === "showJenkinsBuildComparison") {
    if (args.beforeBuildNumber === args.afterBuildNumber) throw new Error("Choose two different build numbers");
    const [before, after] = await Promise.all([
      apiByName.get("getBuild").call(config, { jobFullName: args.jobFullName, buildNumber: args.beforeBuildNumber }),
      apiByName.get("getBuild").call(config, { jobFullName: args.jobFullName, buildNumber: args.afterBuildNumber }),
    ]);
    return cardResponse({ view: "comparison", jobFullName: args.jobFullName, before: before.structuredContent, after: after.structuredContent });
  }
  if (name === "uiGetBuildStages") {
    try {
      const result = await request(config, `${jobPath(args.jobFullName)}/${args.buildNumber ?? "lastBuild"}/wfapi/describe`);
      const data = await result.json();
      return response({ available: true, stages: Array.isArray(data.stages) ? data.stages.map(({ id, name, status, durationMillis, startTimeMillis }) => ({ id, name, status, durationMillis, startTimeMillis })) : [] });
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
