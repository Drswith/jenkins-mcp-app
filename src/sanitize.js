// Response minimization and secret masking applied to every tool result before it
// leaves the bridge. See OpenAI plugin guidelines: return only relevant data and
// remove internal identifiers, telemetry and auth secrets.

const secretPatterns = [
  // Credentials embedded in URLs: https://user:secret@host
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s/@]+@/gi, "$1****@"],
  // Authorization headers and bearer tokens
  [/\b(authorization\s*[:=]\s*["']?)(bearer|basic|token)\s+[A-Za-z0-9+/=._~-]+/gi, "$1$2 ****"],
  [/\b(bearer)\s+[A-Za-z0-9._~+/-]{16,}=*/gi, "$1 ****"],
  // key=value / key: value pairs whose key names a secret
  [/\b((?:[A-Za-z0-9]+[_-])*(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)["']?\s*[:=]\s*["']?)([^\s"'&,;]{4,})/gi, "$1****"],
  // PEM private keys
  [/-----BEGIN ([A-Z ]*)PRIVATE KEY-----[\s\S]*?-----END \1PRIVATE KEY-----/g, "-----BEGIN $1PRIVATE KEY----- **** -----END $1PRIVATE KEY-----"],
  // Well-known token formats
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, "****"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "****"],
  [/\bglpat-[A-Za-z0-9_-]{20,}\b/g, "****"],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g, "****"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "****"],
  // Jenkins API token format: "11" followed by 32 hex characters
  [/\b11[0-9a-f]{32}\b/g, "****"],
  // Jenkins MCP Server plugin records the caller address in the build cause
  [/(Triggered via MCP Client from )\S+/g, "$1****"],
];

export function maskSecrets(text) {
  if (typeof text !== "string" || !text) return text;
  return secretPatterns.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), text);
}

const secretKey = /(?:password|passwd|^pwd$|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|^authorization$)/i;

const droppedKeys = new Set(["_class", "absoluteUrl", "authorEmail", "addr"]);
const folderClass = /(?:Folder|MultiBranchProject|OrganizationFolder)$/;
const colorStatus = { blue: "success", red: "failure", yellow: "unstable", aborted: "aborted", notbuilt: "notBuilt", grey: "notBuilt", disabled: "disabled" };
const stackTraceLines = 8;

function minimizeObject(object, options) {
  const out = {};
  if (typeof object._class === "string" && folderClass.test(object._class) && !("type" in object)) out.type = "folder";
  for (const [key, value] of Object.entries(object)) {
    if (droppedKeys.has(key)) continue;
    if (secretKey.test(key) && value != null) { out[key] = "****"; continue; }
    if (key === "queueId" && !options.keepQueueId) continue;
    if (key === "date" && "timestamp" in object) continue;
    if (key === "color" && typeof value === "string") {
      const base = value.replace(/_anime$/, "");
      if (!("status" in object) && colorStatus[base]) out.status = colorStatus[base];
      if (value.endsWith("_anime") && !("building" in object)) out.building = true;
      continue;
    }
    if (key === "errorStackTrace" && typeof value === "string") {
      const lines = value.split("\n");
      out[key] = maskSecrets(lines.slice(0, stackTraceLines).join("\n") + (lines.length > stackTraceLines ? "\n…" : ""));
      continue;
    }
    out[key] = sanitizeValue(value, options);
  }
  return out;
}

export function sanitizeValue(value, options = {}) {
  if (typeof value === "string") return maskSecrets(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, options));
  if (!value || typeof value !== "object") return value;
  if (options.maskOnly) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, secretKey.test(key) && item != null ? "****" : sanitizeValue(item, options)]));
  return minimizeObject(value, options);
}

// The Jenkins MCP Server plugin wraps data as { message, result, status }.
function unwrapUpstream(value) {
  if (value && typeof value === "object" && !Array.isArray(value) && "result" in value && typeof value.message === "string"
    && Object.keys(value).every((key) => ["message", "result", "status"].includes(key))) return value.result;
  return value;
}

function parseJson(text) {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
  try { return JSON.parse(trimmed); } catch { return undefined; }
}

const queueTools = new Set(["triggerBuild", "getQueueItem", "showJenkinsQueueCard", "uiTrackQueue", "uiGetQueueItem"]);

export function sanitizeToolResult(name, result, { appOnly = false } = {}) {
  if (!result || typeof result !== "object") return result;
  const options = { keepQueueId: queueTools.has(name), maskOnly: appOnly || result.isError === true };
  const clean = (data) => sanitizeValue(options.maskOnly ? data : unwrapUpstream(data), options);
  const next = { ...result };
  if (result._meta !== undefined) next._meta = clean(result._meta);
  if (result.structuredContent !== undefined) next.structuredContent = clean(result.structuredContent);
  if (Array.isArray(result.content)) {
    next.content = result.content.map((item) => {
      if (item?.type !== "text") return item;
      const parsed = parseJson(item.text);
      if (parsed === undefined) return { ...item, text: maskSecrets(item.text) };
      return { ...item, text: JSON.stringify(clean(parsed)) };
    });
  }
  return next;
}
