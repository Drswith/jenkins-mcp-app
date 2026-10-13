import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { apiTools, publicTool } from "./api.js";
import { readConfig } from "./config.js";
import { callUiTool, readUiResource, uiIcons, uiResources, uiTools } from "./ui.js";

const pluginVersion = JSON.parse(readFileSync(new URL("../plugin.json", import.meta.url), "utf8")).version;

const allowed = new Set([
  "whoAmI", "getStatus", "getJobs", "getJob", "getBuild", "getBuildLog",
  "searchBuildLog", "getTestResults", "getQueueItem", "getJobScm",
  "getBuildScm", "getBuildChangeSets", "findJobsWithScmUrl", "triggerBuild",
]);
const localApiToolNames = new Set(["getJobParameters", "getGitParameterChoices"]);

function validateApiArguments(tool, args) {
  const schema = tool.inputSchema;
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Arguments must be an object");
  for (const key of schema.required ?? []) if (!(key in args)) throw new Error(`Missing ${key}`);
  for (const [key, value] of Object.entries(args)) {
    const property = schema.properties[key];
    if (!property) throw new Error(`Unknown argument ${key}`);
    if (property.type === "string" && (typeof value !== "string" || !value.trim() || (property.enum && !property.enum.includes(value)))) throw new Error(`${key} must be a supported nonempty string`);
    if (property.type === "integer" && (!Number.isInteger(value) || value < property.minimum)) throw new Error(`${key} must be a positive integer`);
    if (property.type === "object") {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${key} must be an object`);
      for (const [name, item] of Object.entries(value)) {
        if (!name || !["string", "number", "boolean"].includes(typeof item) || (typeof item === "number" && !Number.isFinite(item))) {
          throw new Error(`Invalid parameter ${name}`);
        }
      }
    }
  }
}

function upstreamUrl(config) {
  return new URL("mcp-server/mcp", config.baseUrl);
}

export function createBridge(env = process.env) {
  const config = readConfig(env);
  let client;
  let connecting;

  async function upstream() {
    if (client) return client;
    if (!connecting) {
      connecting = (async () => {
        const next = new Client({ name: "jenkins-codex-bridge", version: pluginVersion });
        await next.connect(new StreamableHTTPClientTransport(upstreamUrl(config), {
          requestInit: { headers: { Authorization: config.authorization } },
        }));
        client = next;
        return next;
      })().finally(() => { connecting = undefined; });
    }
    return connecting;
  }

  const server = new Server({ name: "jenkins-codex-plugin", version: pluginVersion, icons: uiIcons }, { capabilities: { tools: {}, resources: {} }, instructions: "Use read tools to identify the exact Jenkins job and build before acting. triggerBuild schedules work; call it only when the user requests a build. Jenkins permissions apply. For concise conversation UI, use showJenkinsQueueCard after triggerBuild returns a queue ID, showJenkinsBuildCard for one build, showJenkinsJobChoices for a short job selection, or showJenkinsBuildComparison for two builds. Never claim a Jenkins build has a numeric percent complete unless Jenkins supplies it." });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: uiResources }));
  server.setRequestHandler(ReadResourceRequestSchema, async ({ params }) => readUiResource(params.uri, config));

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    if (config.mode === "api") return { tools: [...apiTools.map(publicTool), ...uiTools] };
    const result = await (await upstream()).listTools();
    return {
      tools: [...result.tools.filter((tool) => allowed.has(tool.name)).map((tool) => ({
        ...tool,
        annotations: {
          ...tool.annotations,
          readOnlyHint: tool.name !== "triggerBuild",
          destructiveHint: tool.name === "triggerBuild",
          openWorldHint: true,
        },
      })), ...apiTools.filter((tool) => localApiToolNames.has(tool.name)).map(publicTool), ...uiTools],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    try {
      const uiTool = uiTools.find((entry) => entry.name === params.name);
      if (uiTool) {
        const args = params.arguments ?? {};
        validateApiArguments(uiTool, args);
        return await callUiTool(config, uiTool.name, args);
      }
      if (config.mode === "api") {
        const tool = apiTools.find((entry) => entry.name === params.name);
        if (!tool) throw new Error("Unknown tool");
        const args = params.arguments ?? {};
        validateApiArguments(tool, args);
        return await tool.call(config, args);
      }
      if (localApiToolNames.has(params.name)) {
        const tool = apiTools.find((entry) => entry.name === params.name);
        const args = params.arguments ?? {};
        validateApiArguments(tool, args);
        return await tool.call(config, args);
      }
      if (!allowed.has(params.name)) throw new Error("Tool is not exposed by this plugin");
      return await (await upstream()).callTool({ name: params.name, arguments: params.arguments ?? {} });
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Jenkins request failed" }] };
    }
  });

  return { server, config, upstreamUrl: upstreamUrl(config) };
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  try {
    const { server } = createBridge();
    await server.connect(new StdioServerTransport());
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Failed to start Jenkins plugin"}\n`);
    process.exitCode = 1;
  }
}
