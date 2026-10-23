---
name: jenkins-setup
description: Use when the user asks to install, configure, connect, or verify the Jenkins plugin.
---

# Set up Jenkins

1. **Input and scope.** Determine the intended controller and connection mode from user-provided context. Explicit user instructions take precedence. Ask only if these are missing or ambiguous. Never ask for an API token in chat, infer an internal URL, or reuse credentials from unrelated systems.
2. **Configure privately.** Follow the packaged [configuration guide](../../docs/configuration.md). Ask the user to run `node dist/configure.mjs` from the installed package in their terminal (from this repository use `node release/jenkins/dist/configure.mjs`). The terminal prompts for credentials privately. Do not print or commit the private file. Stop on unsafe file permissions or invalid configuration.
3. **Verify reads.** In MCP mode use `getStatus` or `whoAmI` if available; in API mode use `getJobs`. The settings action “检测连接与权限” provides read-only checks. No sample build is needed. Successful reads do not prove build permission or host approval behavior. Do not silently switch modes; report unavailable endpoints, permissions and network failures separately.
4. **Preferences and UI.** In native plugin settings set only the watched job names (at most eight) and evidence lines (1–10). Credentials never appear there; masking is always enabled. If native settings are absent, follow the private display-settings file fallback in the configuration guide. An empty watch list is a valid initial state. Check the actual host's rendering and capabilities; a local preview is not native-host evidence.
5. **Output or stop.** Report the connection mode and read tool that succeeded, UI capabilities actually tested, and any remaining failure. On network failure inspect direct/proxy paths and current local routing before retrying; keep internal addresses off public proxies. Never trigger a real build, change Jenkins permissions, deploy a public endpoint, or promise approvals as part of setup.
