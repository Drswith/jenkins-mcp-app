# Architecture

`release/jenkins/` is the [portable Agent Plugins package](https://developers.openai.com/plugins/build/plugins). Its `plugin.json` defines identity and onboarding; `mcp.json` starts the bundled stdio server. The repository marketplace points at this built directory. No remote server is deployed by this repository.

```text
Codex / MCP client
  -> local stdio bridge (dist/server.mjs)
     -> mcp mode: Jenkins MCP Server plugin, Streamable HTTP
     -> api mode: Jenkins Remote Access API, HTTP JSON
     -> MCP Apps UI resources (dist/ui/*.html)
        -> app-only data tools -> Jenkins Remote Access API
```

Source files stay outside the installable directory. `src/server.js` owns MCP transport, tool allowlisting and explicit mode selection. `src/config.js` loads private connection details and builds safe job paths. `src/api.js` implements the limited Remote API route. `src/ui.js` declares UI tools and resources. `ui/src/` contains the browser views. `scripts/configure.mjs` creates local private configuration. `scripts/build.mjs` bundles the server, configuration executable and browser views, then copies only runtime metadata and skills into `release/jenkins/`. `package.json` and `pnpm-lock.yaml` govern development; neither is included in the installed plugin. The [UI guide](ui.md) owns the UI contract and host requirements.

The bridge applies the same credentials to the selected controller. API mode rejects redirects; the MCP SDK follows only redirects within the same origin. Tool results are returned to the MCP host as Jenkins data. There is no persistence or job mutation beyond `triggerBuild`; a mounted inline UI can poll read-only queue and build tools while visible, with no background service after it closes. MCP mode retains upstream tool schemas and behavior; API mode has its own smaller schema and response shape. The optional UI reads through its app-only Remote API tools in either mode.

For current endpoint and protocol details, consult the [Jenkins MCP Server plugin](https://plugins.jenkins.io/mcp-server/), [Jenkins Remote Access API](https://www.jenkins.io/doc/book/using/remote-access-api/) and [OpenAI plugin packaging guide](https://developers.openai.com/plugins/build/plugins/).

## Verification boundary

`pnpm test` exercises a copy of the installable package outside the repository against local HTTP fixtures in both modes. It does not prove compatibility with a particular Jenkins controller, installed MCP Server plugin version, proxy configuration, permission model or Codex desktop UI. Use the onboarding skill with the intended controller for those checks.
