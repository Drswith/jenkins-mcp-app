import { execFileSync } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const [jenkinsID, giteaID, environmentID] = process.argv.slice(2);
if (![jenkinsID, giteaID, environmentID].every((id) => /^[a-f0-9]{24}$/.test(id || ""))) {
  throw new Error("Usage: node scripts/jenkins-zeabur-access.mjs <jenkins-service-id> <gitea-service-id> <environment-id>");
}
const directory = resolve(".local/jenkins-test/zeabur");
await mkdir(directory, { recursive: true, mode: 0o700 });
async function exportAccess(serviceID, path, required) {
  let access;
  try {
    const raw = execFileSync("npx", ["zeabur@latest", "service", "exec", "-i=false", "--id", serviceID,
      "--env-id", environmentID, "--", "cat", path], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60000 });
    access = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || "{}");
    if (!required.every((key) => typeof access[key] === "string" && access[key])) throw new Error();
  } catch {
    // Child-process errors can contain credential-bearing stdout. Never forward them.
    throw new Error(`Could not export credentials from service ${serviceID}; check initialization and readiness.`);
  }
  return access;
}
async function save(name, data) {
  const path = resolve(directory, name);
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
  console.log(path);
}
const jenkins = await exportAccess(jenkinsID, "/var/jenkins_home/local-test-credentials.json",
  ["JENKINS_URL", "JENKINS_USER", "JENKINS_API_TOKEN", "testPassword"]);
const gitea = await exportAccess(giteaID, "/var/lib/gitea/local-test-credentials.json", ["user", "password"]);
await save("jenkins-access.json", jenkins);
await save("gitea-access.json", gitea);
const { testPassword, ...config } = jenkins;
await save("config.json", config);
