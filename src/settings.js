import { lstatSync, readFileSync, mkdirSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { jobPath } from "./config.js";

const defaults = { watchedJobs: "", evidenceLines: 3 };
const properties = {
  watchedJobs: { type: "string", title: "关注的任务", description: "逗号分隔的完整任务名，最多 8 项", maxLength: 2048 },
  evidenceLines: { type: "integer", title: "卡片中的日志证据行数", minimum: 1, maximum: 10 },
};
const valuesSchema = { type: "object", properties, additionalProperties: false };
const outputSchema = { type: "object", properties: { schema: { type: "object" }, values: valuesSchema, layout: { type: "array", items: { type: "object" } } }, required: ["schema", "values"] };
export const settingsTools = [
  { name: "readJenkinsSettings", title: "读取显示设置", description: "读取关注任务和日志证据行数", inputSchema: { type: "object", properties: {}, additionalProperties: false }, outputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } } },
  { name: "updateJenkinsSettings", title: "保存显示设置", description: "更新本地私有显示设置，不修改连接凭据", inputSchema: { type: "object", properties: { set: { ...valuesSchema, minProperties: 1 } }, required: ["set"], additionalProperties: false }, outputSchema: { type: "object", properties: { values: valuesSchema }, required: ["values"] },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } } },
];

export function watchedJobs(value) {
  const names = [...new Set(value.split(",").map((name) => name.trim()).filter(Boolean))];
  if (names.length > 8) throw new Error("最多关注 8 个任务");
  for (const name of names) {
    if (/[\r\n\0]/.test(name)) throw new Error("任务名称不能包含控制字符");
    jobPath(name);
  }
  return names;
}

function validate(values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error("设置必须是对象");
  for (const [key, value] of Object.entries(values)) {
    if (!Object.hasOwn(defaults, key)) throw new Error("未知的显示设置");
    if (key === "watchedJobs") {
      if (typeof value !== "string" || value.length > 2048) throw new Error("关注任务必须是最多 2048 字符的字符串");
      watchedJobs(value);
    }
    if (key === "evidenceLines" && (!Number.isInteger(value) || value < 1 || value > 10)) throw new Error("日志证据行数必须为 1–10 的整数");
  }
  return values;
}

export function readSettings(config) {
  try {
    const stat = lstatSync(config.settingsPath);
    if (!stat.isFile() || (process.platform !== "win32" && (stat.mode & 0o077))) throw new Error("显示设置文件必须是私有普通文件（0600）");
    let value;
    try { value = JSON.parse(readFileSync(config.settingsPath, "utf8")); } catch { throw new Error("显示设置文件无法解析，原文件未修改"); }
    return { ...defaults, ...validate(value) };
  } catch (error) {
    if (error.code === "ENOENT") return { ...defaults };
    throw error;
  }
}

export function callSettingsTool(config, name, args) {
  const current = readSettings(config);
  if (name === "readJenkinsSettings") return { content: [], structuredContent: { schema: valuesSchema, values: current, layout: [{ kind: "group", title: "显示", items: [{kind:"property",property:"watchedJobs"},{kind:"property",property:"evidenceLines"}] }, {kind:"group",title:"连接",items:[{kind:"tool",tool:"checkJenkinsConnection",description:"只读检测连接及可确认的权限"}]}] } };
  const patch = validate(args.set);
  if (!Object.keys(patch).length) throw new Error("至少更新一项设置");
  const values = { ...current, ...patch };
  if ("watchedJobs" in patch) values.watchedJobs = watchedJobs(patch.watchedJobs).join(", ");
  const path = config.settingsPath;
  const temporary = `${path}.${randomUUID()}.tmp`;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(temporary, `${JSON.stringify(values, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    renameSync(temporary, path);
  } finally { rmSync(temporary, { force: true }); }
  return { content: [], structuredContent: { values } };
}
