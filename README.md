# Jenkins for Codex

An installable local OpenAI Codex plugin that packages a Jenkins MCP bridge and focused skills. It uses the [Jenkins MCP Server plugin](https://plugins.jenkins.io/mcp-server/) when available. A limited fallback uses the [Jenkins Remote Access API](https://www.jenkins.io/doc/book/using/remote-access-api/) for older controllers.

## What it does

- Read jobs, declared parameters, Git parameter choices, builds, logs, test results and queue state (the exact tool set follows Jenkins permissions and the chosen mode).
- Schedule a build when requested, then follow its queue item and build.
- Show compact, interactive conversation cards for queue tracking, build status, job selection and build comparison in compatible MCP Apps hosts.
- Keep Jenkins credentials in a private local config file or process environment. No credentials belong in this repository or plugin manifest.

This is a local plugin. It includes built MCP Apps UI resources for compatible hosts, but does not include a public MCP endpoint or hosted authentication. Private ChatGPT testing can use a [Secure MCP Tunnel](https://developers.openai.com/plugins/deploy/connect-chatgpt); public directory submission requires a deployed HTTPS MCP server and separate review.

The installable package is **`release/jenkins/`**. Its contents are built ahead of installation: bundled Node executables, three self-contained UI resources, plugin manifests, skills, one configuration guide, icon and license. The marketplace points at that directory. Codex does not install this repository's `src/`, `ui/src/`, `test/`, `node_modules/`, package manifest or lock file.

The plugin marketplace uses the square, full-color Jenkins portrait. Small Codex entrypoints use a monochrome build icon adapted from an official Jenkins symbol; the UI artwork is unmodified [official Jenkins artwork](assets/ATTRIBUTION.md). This is a community-maintained integration and is not endorsed by the Jenkins project.

## Start

1. Install Node.js 20 or newer. For MCP mode, install the Jenkins [MCP Server plugin](https://plugins.jenkins.io/mcp-server/) on your controller and ensure its Streamable HTTP endpoint is available.
2. Run `node release/jenkins/dist/configure.mjs` in a terminal. Enter the controller root URL, Jenkins user, API token, and `mcp` or `api` mode. The executable writes a private `~/.config/jenkins-codex-plugin/config.json` with `0600` permissions. Use a dedicated Jenkins account with only the required permissions.
3. Register the local source with `codex plugin marketplace add /absolute/path/to/jenkins-mcp-app`, then install with `codex plugin add jenkins@jenkins-local` or from the `Jenkins local` source in Codex desktop's Plugins Directory. Run the onboarding skill through a fresh plugin connection to check the installation; an already-open App or connection may retain the previous version. The repository marketplace is defined in [marketplace.json](.agents/plugins/marketplace.json).

Installation copies the plugin into the Codex plugin cache; refresh the marketplace after source changes. The config file remains outside that cache.

Installed users need Node.js to run the already bundled server, but do not need pnpm, dependencies or a build step. For development, run `pnpm install --frozen-lockfile && pnpm test`; `pnpm build` regenerates `release/jenkins/`. Distribute that directory as the updated package; the marketplace entry already points at it. The build inputs remain in `src/`, `scripts/`, `skills/` and the root manifests.

## Documentation

- [Configuration, security and tool coverage](docs/configuration.md)
- [Bridge architecture and limits](docs/architecture.md)
- [MCP Apps interface and host requirements](docs/ui.md)
- [Local Docker Jenkins test](docs/local-test.md)
- [SG cloud migration and Gitea test](docs/zeabur-test.md)
- [SG demo jobs, build history and Git collaboration data](docs/demo-data.md)
- [Multibranch discovery, PR webhooks and daily history](docs/multibranch-history.md)
- [Internal Jenkins target compatibility baseline](docs/target-compatibility.md)
- [SG Jenkins 2.263.1 API compatibility test](docs/legacy-test.md)
- [Contributor rules](AGENTS.md)

The skill files under `skills/` are runtime instructions packaged with the plugin, rather than maintenance docs.

## Interface preview

Run `pnpm build && pnpm ui:preview` to inspect the current installable MCP Apps UI. The preview page includes queue, running, running without stage data, success, failure, selection and comparison scenarios for the inline card. The [earlier interactive design prototype](prototype/README.md) and its images are exploratory material; they are not the current built UI or part of the installable package.

## Project status

The repository includes a local plugin, a Jenkins MCP proxy, an API mode and MCP Apps UI resources. Automated tests use simulated Jenkins HTTP and MCP servers. Version 0.1.11 is installed and active in the current Codex connection, with all 19 packaged files matching `release/jenkins/`. SG native-host validation on 0.1.10 captured the same card progressing from queue #161 to running build #4 and SUCCESS across three screenshots. A separate 0.1.11 card for that existing build verified an actual inline-to-fullscreen request and successful automatic expansion, without manual expansion, refresh, reopening, or restarting Codex. No new builds were needed for the display-mode test. Earlier host-control timeouts remain unexplained; current validation and installation-resource compatibility details are recorded in [target compatibility](docs/target-compatibility.md).

The SG cloud now retains Jenkins 2.263.1 with Gitea 28.1.0. Migration, replay, and current API readback evidence—including the delayed deletion state of the stopped source service—is recorded in the [authoritative compatibility snapshot](docs/legacy-test.md); [cloud test operations](docs/zeabur-test.md) retains the service history. Historical 2.580.1 smoke testing passed MCP/API calls, UI resources, sample builds and Gitea checkout/change-set queries; it does not establish MCP Apps rendering inside Codex desktop or ChatGPT.
