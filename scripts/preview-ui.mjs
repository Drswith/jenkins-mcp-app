import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { build } from "esbuild";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = await build({ entryPoints: [join(root, "scripts/preview-host.js")], bundle: true, minify: true, write: false, platform: "browser", format: "iife" });
const hostScript = output.outputFiles[0].text.replaceAll("</script", "<\\/script");
const port = Number(process.env.JENKINS_UI_PREVIEW_PORT || 4174);
const host = process.env.JENKINS_UI_PREVIEW_HOST || "127.0.0.1";
const live = process.env.JENKINS_UI_PREVIEW_LIVE === "1";
const allowedTools = new Set(["uiListJobs", "uiGetJob", "uiGetBuild", "uiGetBuildLog", "uiGetQueueItem", "uiTrackQueue", "uiGetBuildStages", "uiGetJobParameters", "uiGetGitParameterChoices", "showJenkinsBuildCard", "showJenkinsQueueCard", "showJenkinsJobChoices", "showJenkinsBuildComparison"]);
let client;
if (live) {
  client = new Client({ name: "jenkins-local-ui-preview", version: "0.1.0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [join(root, "release/jenkins/dist/server.mjs")],
    env: process.env,
  }));
}

createServer(async (request, response) => {
  const path = new URL(request.url, "http://127.0.0.1").pathname;
  if (path === "/tool") {
    if (!live || request.method !== "POST" || request.headers["content-type"] !== "application/json" || (request.headers.origin && request.headers.origin !== `http://127.0.0.1:${port}`)) return response.writeHead(403).end();
    try {
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 8192) return response.writeHead(413).end();
      }
      const { name, arguments: args } = JSON.parse(body);
      if (!allowedTools.has(name)) return response.writeHead(403).end();
      const result = await client.callTool({ name, arguments: args ?? {} });
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      return response.end(JSON.stringify(result));
    } catch (error) {
      response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      return response.end(JSON.stringify({ isError: true, content: [{ type: "text", text: error.message }] }));
    }
  }
  if (path.startsWith("/widget/")) {
    const manifest = JSON.parse(readFileSync(join(root, "release/jenkins/dist/ui/manifest.json"), "utf8"));
    const mode = path.slice("/widget/".length);
    const item = manifest[mode];
    if (!item) return response.writeHead(404).end();
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return response.end(readFileSync(join(root, "release/jenkins/dist/ui", item.file)));
  }
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Jenkins MCP Apps 宿主预览</title><style>body{margin:0;font-family:system-ui;background:#f3f5f7}header{padding:12px 18px;background:white;border-bottom:1px solid #ddd}nav{display:inline-flex;gap:12px;margin-left:24px}a{color:#376aab}#theme{margin-left:24px}iframe{display:block;width:100%;height:calc(100vh - 85px);border:0;background:white}iframe.expanded{height:calc(100vh - 85px)}body:has(a[href*="card"].active) iframe{max-width:420px;height:360px;margin:20px auto}body:has(a[href*="panel"].active) iframe{max-width:360px;margin-left:auto}#message{padding:8px 18px;color:#69778a;font-size:12px}body[data-theme=dark]{background:#202124;color:#eef0f3}body[data-theme=dark] header{background:#292b30;border-color:#3b3f46}body[data-theme=dark] a{color:#a6c8ff}body[data-theme=dark] #message{color:#b8c1cd}body[data-theme=dark] iframe{background:#17191c}</style><body data-live="${live}"><header>Jenkins MCP Apps 构建产物预览<nav><a href="?mode=workspace" class="${request.url.includes("workspace") || request.url === "/" ? "active" : ""}">工作台</a><a href="?mode=panel" class="${request.url.includes("panel") ? "active" : ""}">侧边栏</a><a href="?mode=card" class="${request.url.includes("card") ? "active" : ""}">内联卡片</a></nav><select id="theme" aria-label="预览主题"><option value="light">浅色</option><option value="dark">深色</option></select>${live ? "" : '<nav aria-label="内联场景"><a href="?mode=card&scenario=queue">排队</a><a href="?mode=card&scenario=running">运行</a><a href="?mode=card&scenario=running-no-stages">无阶段</a><a href="?mode=card&scenario=success">成功</a><a href="?mode=card&scenario=failed">失败</a><a href="?mode=card&scenario=choices">选择</a><a href="?mode=card&scenario=comparison">对比</a></nav>'}</header><div id="message">${live ? "当前 Jenkins 连接的只读数据（模拟 MCP Apps 宿主）。" : "模拟宿主与 Jenkins 数据，不连接真实服务。"}</div><iframe title="Jenkins MCP Apps 界面"></iframe><script>${hostScript}</script></body></html>`);
}).listen(port, host, () => process.stdout.write(`MCP Apps UI preview: http://127.0.0.1:${port}/\n`));
