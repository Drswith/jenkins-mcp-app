---
name: jenkins-setup
description: Set up and verify this Jenkins Codex plugin against a user-owned Jenkins controller.
---

# Jenkins setup

Read the packaged `docs/configuration.md` for supported connection modes. Ask the user for the Jenkins controller URL and preferred mode if unknown. Do not ask them to paste an API token into chat. Guide them to run `node dist/configure.mjs` from the installed plugin folder, or `node release/jenkins/dist/configure.mjs` from the source checkout, in their own terminal; it prompts for the token without echoing it and stores a private local file.

Use a read tool (`getStatus` or `whoAmI` in MCP mode, `getJobs` in API mode) to verify the actual connection and authorization. Report which mode and tool worked. If the tool cannot connect, distinguish a missing configuration, Jenkins permission failure, unsupported MCP endpoint and network route. Do not switch to API mode silently.
