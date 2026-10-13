import { existsSync, mkdirSync, openSync, writeFileSync, closeSync, renameSync, chmodSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";

const path = process.env.JENKINS_CONFIG_FILE || join(homedir(), ".config", "jenkins-codex-plugin", "config.json");
const io = createInterface({ input: process.stdin, output: process.stdout });
let temporary;

async function secret(prompt) {
  if (!process.stdin.isTTY) throw new Error("Token entry requires an interactive terminal");
  io.close();
  const hiddenOutput = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const hidden = createInterface({ input: process.stdin, output: hiddenOutput, terminal: true });
  const answer = hidden.question("");
  process.stdout.write(prompt);
  try {
    return await answer;
  } finally {
    hidden.close();
    process.stdout.write("\n");
  }
}

try {
  if (existsSync(path)) {
    const answer = (await io.question(`Replace existing private config at ${path}? [y/N] `)).trim().toLowerCase();
    if (answer !== "y") process.exit(0);
  }
  const JENKINS_URL = (await io.question("Jenkins controller URL: ")).trim();
  const JENKINS_USER = (await io.question("Jenkins user: ")).trim();
  const mode = (await io.question("Mode [mcp/api] (default mcp): ")).trim() || "mcp";
  if (!["mcp", "api"].includes(mode)) throw new Error("Mode must be mcp or api");
  const JENKINS_API_TOKEN = await secret("Jenkins API token (hidden): ");
  if (!JENKINS_URL || !JENKINS_USER || !JENKINS_API_TOKEN) throw new Error("All connection fields are required");
  const url = new URL(JENKINS_URL);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Use a plain HTTP(S) controller URL without credentials");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  temporary = `${path}.${process.pid}.tmp`;
  const descriptor = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(descriptor, JSON.stringify({ JENKINS_URL, JENKINS_USER, JENKINS_API_TOKEN, JENKINS_MODE: mode }, null, 2) + "\n");
  } finally { closeSync(descriptor); }
  renameSync(temporary, path);
  temporary = undefined;
  chmodSync(path, 0o600);
  process.stdout.write(`Saved private config to ${path}\n`);
} catch (error) {
  if (temporary && existsSync(temporary)) unlinkSync(temporary);
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
} finally {
  io.close();
}
