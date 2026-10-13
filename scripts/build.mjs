import { cpSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { build } from "esbuild";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const release = join(root, "release");
const target = join(release, "jenkins");
const staging = join(release, `.jenkins-build-${process.pid}`);
const packageVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const pluginVersion = JSON.parse(readFileSync(join(root, "plugin.json"), "utf8")).version;
if (packageVersion !== pluginVersion) throw new Error("package.json and plugin.json versions differ");

rmSync(staging, { recursive: true, force: true });
mkdirSync(join(staging, "dist"), { recursive: true });
try {
  const ui = await build({
    entryPoints: [join(root, "ui/src/main.jsx")], outdir: join(staging, "ui-build"),
    bundle: true, minify: true, write: false, platform: "browser", format: "iife",
    jsx: "automatic", loader: { ".png": "dataurl" },
  });
  const script = ui.outputFiles.find((file) => file.path.endsWith(".js"))?.text;
  const style = ui.outputFiles.find((file) => file.path.endsWith(".css"))?.text;
  if (!script || !style) throw new Error("UI build did not produce JavaScript and CSS");
  const hash = createHash("sha256").update(script).update(style).digest("hex").slice(0, 12);
  const manifest = {};
  mkdirSync(join(staging, "dist/ui"), { recursive: true });
  for (const mode of ["workspace", "panel", "card"]) {
    const file = `${mode}-${hash}.html`;
    manifest[mode] = { mode, file, uri: `ui://jenkins/${file}` };
    writeFileSync(join(staging, "dist/ui", file), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${style}</style></head><body data-mode="${mode}"><div id="root"></div><script>${script.replaceAll("</script", "<\\/script")}</script></body></html>`);
  }
  writeFileSync(join(staging, "dist/ui/manifest.json"), JSON.stringify(manifest));
  await build({
    entryPoints: [join(root, "src/server.js")],
    outfile: join(staging, "dist/server.mjs"),
    bundle: true, minify: true, platform: "node", format: "esm", target: "node20",
  });
  await build({
    entryPoints: [join(root, "scripts/configure.mjs")],
    outfile: join(staging, "dist/configure.mjs"),
    bundle: true, minify: true, platform: "node", format: "esm", target: "node20",
  });
  for (const name of ["plugin.json", "mcp.json", "LICENSE"]) cpSync(join(root, name), join(staging, name));
  cpSync(join(root, "skills"), join(staging, "skills"), { recursive: true });
  cpSync(join(root, "assets"), join(staging, "assets"), { recursive: true });
  mkdirSync(join(staging, "docs"));
  cpSync(join(root, "docs/configuration.md"), join(staging, "docs/configuration.md"));
  rmSync(target, { recursive: true, force: true });
  renameSync(staging, target);
  process.stdout.write(`Built installable plugin at ${target}\n`);
} catch (error) {
  rmSync(staging, { recursive: true, force: true });
  throw error;
}
