import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function configuration(env) {
  const path = env.JENKINS_CONFIG_FILE || join(homedir(), ".config", "jenkins-codex-plugin", "config.json");
  let file = {};
  try {
    const stat = statSync(path);
    if (process.platform !== "win32" && (stat.mode & 0o077)) throw new Error("Jenkins config file must be private (chmod 600)");
    file = JSON.parse(readFileSync(path, "utf8"));
    if (!file || typeof file !== "object" || Array.isArray(file)) throw new Error("Jenkins config file must contain a JSON object");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return { ...file, ...Object.fromEntries(Object.entries(env).filter(([key]) => key.startsWith("JENKINS_") && key !== "JENKINS_CONFIG_FILE")) };
}

export function readConfig(env = process.env) {
  const values = configuration(env);
  const mode = values.JENKINS_MODE || "mcp";
  if (mode !== "mcp" && mode !== "api") throw new Error("JENKINS_MODE must be mcp or api");
  if (typeof values.JENKINS_URL !== "string" || !values.JENKINS_URL) throw new Error("Set JENKINS_URL to the controller root URL");
  const url = new URL(values.JENKINS_URL);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("JENKINS_URL must use HTTP or HTTPS");
  if (url.username || url.password || url.search || url.hash) throw new Error("JENKINS_URL must not contain credentials, query or fragment");
  if (typeof values.JENKINS_USER !== "string" || !values.JENKINS_USER || typeof values.JENKINS_API_TOKEN !== "string" || !values.JENKINS_API_TOKEN) throw new Error("Set JENKINS_USER and JENKINS_API_TOKEN");
  url.pathname = `${url.pathname.replace(/\/$/, "")}/`;
  return {
    mode,
    baseUrl: url,
    authorization: `Basic ${Buffer.from(`${values.JENKINS_USER}:${values.JENKINS_API_TOKEN}`).toString("base64")}`,
  };
}

export function jobPath(fullName) {
  if (typeof fullName !== "string" || !fullName.trim()) throw new Error("jobFullName is required");
  const parts = fullName.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) throw new Error("Invalid jobFullName");
  return parts.map((part) => `job/${encodeURIComponent(part)}`).join("/");
}
