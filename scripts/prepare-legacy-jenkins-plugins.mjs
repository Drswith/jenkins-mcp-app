#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lockPath = resolve(repository, "test/legacy-jenkins/plugins.txt");
const outputDirectory = resolve(repository, ".local/jenkins-legacy/plugins");
const jenkinsCore = "2.263.1";

function compareVersions(left, right) {
  const a = String(left).match(/\d+|[A-Za-z]+/g) ?? [];
  const b = String(right).match(/\d+|[A-Za-z]+/g) ?? [];
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const x = a[index] ?? "0";
    const y = b[index] ?? "0";
    const xIsNumber = /^\d+$/.test(x);
    const yIsNumber = /^\d+$/.test(y);
    const difference = xIsNumber && yIsNumber ? Number(x) - Number(y) : x.localeCompare(y);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

function parseLock(text) {
  const entries = new Map();
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const [identity, requiredCore, sha256, releaseDate, source, extra] = rawLine.split("\t");
    const match = identity?.match(/^([a-zA-Z0-9_.-]+):([^\s]+)$/);
    if (extra !== undefined || !match || !/^[0-9a-f]{64}$/.test(sha256 ?? "") || !requiredCore || !releaseDate || !source) {
      throw new Error(`${lockPath}:${index + 1}: expected id:version, requiredCore, SHA-256, release date and source separated by tabs`);
    }
    const [, id, version] = match;
    if (entries.has(id)) throw new Error(`${lockPath}:${index + 1}: duplicate plugin ${id}`);
    if (compareVersions(requiredCore, jenkinsCore) > 0) {
      throw new Error(`${id}:${version} requires Jenkins ${requiredCore}, newer than ${jenkinsCore}`);
    }
    entries.set(id, { id, version, requiredCore, sha256, releaseDate, source });
  }
  if (entries.size === 0) throw new Error(`${lockPath} has no plugin entries`);
  return entries;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${result.status}): ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout;
}

function parseManifest(raw) {
  const unfolded = raw.replace(/\r?\n[ \t]/g, "");
  const headers = new Map();
  for (const line of unfolded.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator > 0) headers.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  const dependencyText = headers.get("Plugin-Dependencies") ?? "";
  const dependencies = dependencyText.split(",").filter(Boolean).map((rawDependency) => {
    const [identity, ...flags] = rawDependency.split(";");
    const separator = identity.lastIndexOf(":");
    if (separator < 1) throw new Error(`Unrecognized Plugin-Dependencies entry: ${rawDependency}`);
    return {
      id: identity.slice(0, separator),
      minimum: identity.slice(separator + 1),
      optional: flags.some((flag) => flag.trim() === "resolution:=optional"),
    };
  });
  return { headers, dependencies };
}

function verifyDependencyClosure(plugin, manifest, entries) {
  for (const dependency of manifest.dependencies) {
    if (dependency.optional) continue;
    const locked = entries.get(dependency.id);
    if (!locked) throw new Error(`${plugin.id}:${plugin.version} requires missing ${dependency.id}:${dependency.minimum}`);
    if (compareVersions(locked.version, dependency.minimum) < 0) {
      throw new Error(`${plugin.id}:${plugin.version} requires ${dependency.id}:${dependency.minimum}, locked ${locked.version}`);
    }
  }
}

async function main() {
  if (process.argv.includes("--help")) {
    console.log("Download and verify the pinned Jenkins 2.263.1 plugin closure into .local/jenkins-legacy/plugins.");
    console.log("Requires curl, unzip and network access to updates.jenkins.io. It does not start Docker or Jenkins.");
    return;
  }

  const entries = parseLock(await readFile(lockPath, "utf8"));
  await mkdir(outputDirectory, { recursive: true });
  const verified = [];

  for (const plugin of entries.values()) {
    const file = resolve(outputDirectory, `${plugin.id}.hpi`);
    const temporaryFile = `${file}.download`;
    const url = `https://updates.jenkins.io/download/plugins/${plugin.id}/${plugin.version}/${plugin.id}.hpi`;
    try {
      const existing = await readFile(file).catch(() => null);
      const currentHash = existing && createHash("sha256").update(existing).digest("hex");
      if (currentHash !== plugin.sha256) {
        await rm(temporaryFile, { force: true });
        run("curl", ["--fail", "--location", "--silent", "--show-error", "--retry", "3", "--connect-timeout", "15", "--max-time", "180", "--output", temporaryFile, url]);
        const downloaded = await readFile(temporaryFile);
        const downloadedHash = createHash("sha256").update(downloaded).digest("hex");
        if (downloadedHash !== plugin.sha256) {
          throw new Error(`SHA-256 mismatch for ${plugin.id}:${plugin.version}; expected ${plugin.sha256}, got ${downloadedHash}`);
        }
        await rename(temporaryFile, file);
      }

      const hash = createHash("sha256").update(await readFile(file)).digest("hex");
      if (hash !== plugin.sha256) throw new Error(`cached SHA-256 mismatch for ${plugin.id}:${plugin.version}`);
      const manifestText = run("unzip", ["-p", file, "META-INF/MANIFEST.MF"]);
      const manifest = parseManifest(manifestText);
      const shortName = manifest.headers.get("Short-Name") ?? manifest.headers.get("Extension-Name");
      const version = manifest.headers.get("Plugin-Version") ?? manifest.headers.get("Implementation-Version");
      const requiredCore = manifest.headers.get("Jenkins-Version") ?? manifest.headers.get("Hudson-Version");
      if (shortName !== plugin.id) throw new Error(`${plugin.id}: HPI manifest names plugin ${shortName ?? "<missing>"}`);
      if (version !== plugin.version) throw new Error(`${plugin.id}: HPI manifest version ${version ?? "<missing>"}, expected ${plugin.version}`);
      if (!requiredCore) throw new Error(`${plugin.id}: HPI manifest has no Jenkins-Version or Hudson-Version`);
      if (compareVersions(requiredCore, jenkinsCore) > 0) throw new Error(`${plugin.id}:${version} HPI requires Jenkins ${requiredCore}, newer than ${jenkinsCore}`);
      verifyDependencyClosure(plugin, manifest, entries);
      verified.push({ ...plugin, requiredCore: requiredCore, file: `${plugin.id}.hpi`, url });
      console.log(`verified ${plugin.id}:${plugin.version}`);
    } catch (error) {
      await rm(temporaryFile, { force: true });
      throw error;
    }
  }

  const lines = ["plugin\tversion\trequiredCore\tsha256\tfile\tsource"];
  for (const plugin of verified) {
    lines.push([plugin.id, plugin.version, plugin.requiredCore, plugin.sha256, plugin.file, plugin.url].join("\t"));
  }
  await writeFile(resolve(outputDirectory, "manifest.tsv"), `${lines.join("\n")}\n`);
  const downloads = verified.map((plugin) => [plugin.id, plugin.version, plugin.sha256, plugin.url].join("\t"));
  await writeFile(resolve(repository, "test/legacy-jenkins/plugins-downloads.tsv"), `${downloads.join("\n")}\n`);
  console.log(`Prepared ${verified.length} verified HPIs at ${outputDirectory}`);
  console.log(`Wrote ${resolve(outputDirectory, "manifest.tsv")}`);
  console.log(`Wrote ${resolve(repository, "test/legacy-jenkins/plugins-downloads.tsv")}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
