import { jobPath } from "./config.js";

const jsonResult = (data) => ({ content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data });

export async function request(config, path, { method = "GET", body, contentType } = {}) {
  const url = new URL(path, config.baseUrl);
  if (url.origin !== config.baseUrl.origin || !url.pathname.startsWith(config.baseUrl.pathname)) throw new Error("Request escaped Jenkins root");
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: config.authorization,
      Accept: "application/json",
      ...(contentType ? { "Content-Type": contentType } : {}),
    },
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(30000),
  });
  if (response.status >= 300 && response.status < 400 && !(method === "POST" && response.status === 201)) {
    throw new Error(`Jenkins redirected request (${response.status}); check the configured root URL`);
  }
  if (!response.ok) throw new Error(`Jenkins returned HTTP ${response.status}`);
  return response;
}

async function getJson(config, path) {
  return normalizeApiUrls(config, await (await request(config, path)).json());
}

function routePath(pathname, allowQueue) {
  if (!pathname.startsWith("/") || pathname.includes("//")) return null;
  const parts = pathname.slice(1).split("/");
  if (parts.at(-1) === "") parts.pop();
  if (parts.some((part) => !part)) return null;
  let decoded;
  try { decoded = parts.map((part) => decodeURIComponent(part)); }
  catch { return null; }
  if (decoded.some((part) => !part || part === "." || part === "..")) return null;
  if (decoded[0] === "queue" && allowQueue && decoded.length === 3 && decoded[1] === "item" && /^[1-9]\d*$/.test(decoded[2])) return "queue";
  if (decoded[0] !== "job") return null;
  let index = 0;
  while (index < decoded.length && decoded[index] === "job") {
    if (!decoded[index + 1]) return null;
    index += 2;
  }
  if (index === decoded.length) return "job";
  if (index + 1 === decoded.length && /^(?:\d+|lastBuild|lastCompletedBuild)$/.test(decoded[index])) return "build";
  return null;
}

export function normalizeJenkinsUrl(config, value, { allowQueue = true } = {}) {
  if (typeof value !== "string" || !value.trim()) return null;
  const absolute = /^(?:[a-z][a-z\d+.-]*:)?\/\//i.test(value);
  let url;
  try { url = new URL(value, config.baseUrl); }
  catch { return null; }

  let suffix;
  const rootPath = config.baseUrl.pathname;
  if (url.pathname.startsWith(rootPath)) {
    suffix = url.pathname.slice(rootPath.length);
  } else if ((!absolute || rootPath === "/") && (url.pathname.startsWith("/job/") || (allowQueue && url.pathname.startsWith("/queue/")))) {
    // Jenkins may return its canonical controller path without the configured
    // context prefix. Rebuild it under the configured root below.
    suffix = url.pathname.slice(1);
  } else {
    return null;
  }
  if (!routePath(`/${suffix}`, allowQueue)) return null;
  return new URL(suffix, config.baseUrl).toString();
}

function normalizeApiUrls(config, value) {
  if (Array.isArray(value)) return value.map((item) => normalizeApiUrls(config, item));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    key === "url" && typeof item === "string" ? normalizeJenkinsUrl(config, item) : normalizeApiUrls(config, item),
  ]));
}

const jobTree = "jobs[name,fullName,url,color,_class,lastBuild[number,result,building,queueId,url,timestamp],lastCompletedBuild[number,result,url]]";

const parameterTree = "property[parameterDefinitions[_class,name,description,type,choices,defaultParameterValue[_class,value]]]";
const gitParameterTypes = new Set(["PT_BRANCH", "PT_TAG", "PT_BRANCH_TAG", "PT_PULL_REQUEST", "PT_REVISION"]);

function parameterType(definition) {
  const className = definition?._class ?? "";
  if (/GitParameterDefinition/i.test(className)) return "git";
  if (/Password|Credentials/i.test(className)) return "password";
  if (/BooleanParameterDefinition/i.test(className)) return "boolean";
  if (/ChoiceParameterDefinition/i.test(className)) return "choice";
  if (/StringParameterDefinition/i.test(className)) return "string";
  return "unknown";
}

function getParameterDefinitions(payload) {
  return (payload?.property ?? []).flatMap((property) => property?.parameterDefinitions ?? []);
}

function mapParameter(definition) {
  const type = parameterType(definition);
  const defaultClass = definition?.defaultParameterValue?._class ?? "";
  const sensitive = type === "password"
    || /Password|Secret|Credentials/i.test(defaultClass)
    || /(?:password|passwd|credential|secret|token)/i.test(definition?.name ?? "");
  const rawDefault = definition?.defaultParameterValue?.value;
  let defaultValue = null;
  if (!sensitive) {
    if (["string", "choice", "git"].includes(type) && typeof rawDefault === "string") defaultValue = rawDefault;
    else if (type === "boolean" && typeof rawDefault === "boolean") defaultValue = rawDefault;
    else if (type === "unknown" && ["string", "number", "boolean"].includes(typeof rawDefault)) defaultValue = rawDefault;
  }
  const result = {
    name: String(definition?.name ?? ""),
    type,
    description: typeof definition?.description === "string" ? definition.description : null,
    defaultValue,
  };
  if (type === "choice") result.choices = Array.isArray(definition?.choices) ? definition.choices.filter((choice) => typeof choice === "string") : [];
  if (type === "git") result.gitType = typeof definition?.type === "string" ? definition.type : null;
  if (sensitive) result.sensitive = true;
  return result;
}

async function getJobParameters(config, jobFullName) {
  const payload = await getJson(config, `${jobPath(jobFullName)}/api/json?tree=${encodeURIComponent(parameterTree)}`);
  return { jobFullName, parameters: getParameterDefinitions(payload).map(mapParameter) };
}

function displayPluginError(error) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") return String(error.message ?? error.error ?? JSON.stringify(error));
  return String(error);
}

function gitChoiceRecords(payload) {
  const source = Array.isArray(payload) ? payload : payload?.values;
  if (!Array.isArray(source)) throw new Error("Git parameter endpoint returned an invalid response");
  const seen = new Set();
  const choices = [];
  let truncated = false;
  for (const item of source) {
    const value = typeof item === "string" ? item : item?.value ?? item?.name;
    if (typeof value !== "string" || !value || seen.has(value)) continue;
    seen.add(value);
    if (choices.length < 200) choices.push({ name: typeof item === "object" && typeof item.name === "string" ? item.name : value, value });
    else truncated = true;
  }
  return { choices, truncated };
}

export const apiTools = [
  {
    name: "getJobs", title: "列出 Jenkins 任务", description: "列出当前可见的顶层 Jenkins 任务；文件夹和详情请使用 getJob。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }, readOnly: true,
    call: async (config) => jsonResult(await getJson(config, `api/json?tree=${encodeURIComponent(jobTree)}`)),
  },
  {
    name: "getJob", title: "查看 Jenkins 任务", description: "按完整名称查看任务或文件夹，文件夹层级用斜杠分隔。",
    inputSchema: { type: "object", properties: { jobFullName: { type: "string" } }, required: ["jobFullName"], additionalProperties: false }, readOnly: true,
    call: async (config, args) => jsonResult(await getJson(config, `${jobPath(args.jobFullName)}/api/json?tree=${encodeURIComponent("name,fullName,url,color,_class,buildable,inQueue,lastBuild[number,result,building,queueId,url,timestamp,duration],jobs[name,fullName,url,color,_class,lastBuild[number,result,building,queueId,url,timestamp,duration]]")}`)),
  },
  {
    name: "getJobParameters", title: "查看 Jenkins 参数", description: "只读读取任务配置中声明的构建参数及其安全默认值。",
    inputSchema: { type: "object", properties: { jobFullName: { type: "string", description: "任务完整名称，文件夹层级用斜杠分隔。" } }, required: ["jobFullName"], additionalProperties: false }, readOnly: true,
    call: async (config, args) => jsonResult(await getJobParameters(config, args.jobFullName)),
  },
  {
    name: "getGitParameterChoices", title: "查看 Git 参数候选", description: "只读读取受支持 Git 参数的候选值；Jenkins 插件返回的错误会显式包含在 errors 中。",
    inputSchema: { type: "object", properties: { jobFullName: { type: "string", description: "任务完整名称，文件夹层级用斜杠分隔。" }, parameterName: { type: "string", description: "Git 参数名称。" } }, required: ["jobFullName", "parameterName"], additionalProperties: false }, readOnly: true,
    call: async (config, args) => {
      const details = await getJobParameters(config, args.jobFullName);
      const parameter = details.parameters.find((item) => item.name === args.parameterName);
      if (!parameter) throw new Error(`Parameter ${args.parameterName} was not found on ${args.jobFullName}`);
      if (parameter.type !== "git" || !gitParameterTypes.has(parameter.gitType)) throw new Error(`Parameter ${args.parameterName} is not a supported Git parameter`);
      const path = `${jobPath(args.jobFullName)}/descriptorByName/net.uaznia.lukanus.hudson.plugins.gitparameter.GitParameterDefinition/fillValueItems?${new URLSearchParams({ param: args.parameterName })}`;
      const payload = await getJson(config, path);
      const errors = Array.isArray(payload?.errors) ? payload.errors.map(displayPluginError) : [];
      const candidates = errors.length ? { choices: [], truncated: false } : gitChoiceRecords(payload);
      return jsonResult({ jobFullName: args.jobFullName, parameterName: args.parameterName, ...candidates, errors });
    },
  },
  {
    name: "getBuild", title: "查看 Jenkins 构建", description: "查看指定编号的构建；省略 buildNumber 时读取最近一次构建。",
    inputSchema: { type: "object", properties: { jobFullName: { type: "string" }, buildNumber: { type: "integer", minimum: 1 } }, required: ["jobFullName"], additionalProperties: false }, readOnly: true,
    call: async (config, args) => jsonResult(await getJson(config, `${jobPath(args.jobFullName)}/${args.buildNumber ?? "lastBuild"}/api/json?tree=${encodeURIComponent("number,result,building,queueId,url,timestamp,duration,description,changeSet[items[commitId,msg,author[fullName]]]")}`)),
  },
  {
    name: "getBuildLog", title: "查看 Jenkins 构建日志", description: "读取指定或最近一次构建的纯文本控制台输出，最多 64 KiB。",
    inputSchema: { type: "object", properties: { jobFullName: { type: "string" }, buildNumber: { type: "integer", minimum: 1 } }, required: ["jobFullName"], additionalProperties: false }, readOnly: true,
    call: async (config, args) => {
      const response = await request(config, `${jobPath(args.jobFullName)}/${args.buildNumber ?? "lastBuild"}/consoleText`);
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      try {
        while (size < 65536) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value.slice(0, 65536 - size));
          size += value.length;
        }
      } finally { await reader.cancel(); }
      const log = Buffer.concat(chunks).toString("utf8");
      return jsonResult({ log, truncated: size >= 65536 });
    },
  },
  {
    name: "getQueueItem", title: "查看 Jenkins 队列项", description: "按数字 ID 查看队列项。",
    inputSchema: { type: "object", properties: { queueId: { type: "integer", minimum: 1 } }, required: ["queueId"], additionalProperties: false }, readOnly: true,
    call: async (config, args) => jsonResult(await getJson(config, `queue/item/${args.queueId}/api/json?tree=${encodeURIComponent("id,blocked,buildable,stuck,cancelled,why,task[name,fullName,url],executable[number,url]")}`)),
  },
  {
    name: "triggerBuild", title: "触发 Jenkins 构建", description: "安排一次构建。参数化任务仅接受简单字符串、数字或布尔参数。",
    inputSchema: { type: "object", properties: { jobFullName: { type: "string" }, parameters: { type: "object", additionalProperties: { type: ["string", "number", "boolean"] } } }, required: ["jobFullName"], additionalProperties: false }, readOnly: false,
    call: async (config, args) => {
      const parameters = args.parameters ?? {};
      const form = new URLSearchParams();
      for (const [key, value] of Object.entries(parameters)) form.set(key, String(value));
      const response = await request(config, `${jobPath(args.jobFullName)}/${Object.keys(parameters).length ? "buildWithParameters" : "build"}`, {
        method: "POST", body: Object.keys(parameters).length ? form.toString() : undefined,
        contentType: Object.keys(parameters).length ? "application/x-www-form-urlencoded" : undefined,
      });
      const location = response.headers.get("location");
      const safeUrl = location ? normalizeJenkinsUrl(config, location, { allowQueue: true }) : null;
      const queueId = safeUrl?.match(/\/queue\/item\/(\d+)\/?$/)?.[1] ?? null;
      if (location && !queueId) throw new Error("Jenkins scheduled the build but returned an invalid queue Location");
      return jsonResult({ scheduled: true, queueUrl: safeUrl, queueId });
    },
  },
];

export function publicTool(tool) {
  return {
    name: tool.name, title: tool.title, description: tool.description, inputSchema: tool.inputSchema,
    annotations: { readOnlyHint: tool.readOnly, destructiveHint: !tool.readOnly, openWorldHint: true },
  };
}
