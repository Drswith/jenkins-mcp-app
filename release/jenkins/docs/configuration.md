# Configuration and tool coverage

## Connection

Run `node dist/configure.mjs` from the installed plugin directory, or `node release/jenkins/dist/configure.mjs` from the source checkout, in an interactive terminal. The default private file is `~/.config/jenkins-codex-plugin/config.json`; override its path with `JENKINS_CONFIG_FILE`. On Unix, the bridge rejects a config file readable by group or others. Environment variables named below override matching file values.

The bridge reads this configuration when its process starts. Restart the plugin's MCP server after changing the controller URL or credentials. A Jenkins restart invalidates existing MCP HTTP sessions; reconnect the plugin if it reports `Session not found`. New sessions can connect with the existing API token.

| Key | Meaning |
| --- | --- |
| `JENKINS_URL` | Controller root URL, including a context path such as `/jenkins/` when used. No credentials, query or fragment. |
| `JENKINS_USER` | Jenkins username. |
| `JENKINS_API_TOKEN` | Jenkins user API token. |
| `JENKINS_MODE` | `mcp` (default) or `api`. Selection is explicit; connection errors do not silently change mode. |
| `JENKINS_CONFIG_FILE` | Optional path to a private JSON file containing these keys. |

Use HTTPS for connections outside a trusted local network. The bridge sends HTTP Basic authentication on every request. Jenkins [recommends API tokens for scripted clients](https://www.jenkins.io/doc/book/system-administration/authenticating-scripted-clients/) and [exempts API token requests from crumbs](https://www.jenkins.io/doc/book/security/csrf-protection/). API mode does not follow redirects; the MCP SDK follows only redirects within the same origin. The bridge never returns the token in tool metadata.

The controller must permit the user to read the requested jobs. `triggerBuild` also requires the Jenkins permission to build the selected job. Jenkins enforces permissions; the bridge does not grant any.

## Modes

**MCP mode** connects to `<JENKINS_URL>/mcp-server/mcp` using the Jenkins MCP Server plugin's [Streamable HTTP transport](https://plugins.jenkins.io/mcp-server/). It forwards the upstream schemas and results for these tools when Jenkins exposes them: `whoAmI`, `getStatus`, `getJobs`, `getJob`, `getBuild`, `getBuildLog`, `searchBuildLog`, `getTestResults`, `getQueueItem`, `getJobScm`, `getBuildScm`, `getBuildChangeSets`, `findJobsWithScmUrl`, `triggerBuild`. Other upstream tools, including replay and build metadata updates, are not exposed by this package. Jenkins plugin versions and permissions may change the visible list.

**API mode** needs no Jenkins MCP plugin. It exposes `getJobs`, `getJob`, `getJobParameters`, `getGitParameterChoices`, `getBuild`, `getBuildLog`, `getQueueItem`, and `triggerBuild`. Jobs use slash-separated full names. Build parameters are submitted as URL-encoded strings, numbers, or booleans; Choice and GitParameter values work when supplied as strings. File, secret, and structured plugin-specific submissions are unsupported. Recognized job, build, and queue links are rebuilt under the configured controller root; unknown or out-of-root response links become `null`. A build `Location` is accepted only when it identifies `queue/item/<id>/` within the configured context path (or as a relative Jenkins path). The log result is capped at 64 KiB. API mode does not provide test results, SCM or log search.

## Parameter reads

Both modes provide these two local read tools through Jenkins REST, independent of the upstream MCP plugin:

| Tool | Input | Result |
| --- | --- | --- |
| `getJobParameters` | `jobFullName` | `{jobFullName, parameters}`; each definition has `name`, normalized `type`, `description`, `defaultValue`, optional Choice `choices`, Git `gitType`, and `sensitive`. |
| `getGitParameterChoices` | `jobFullName`, `parameterName` | `{jobFullName, parameterName, choices:[{name,value}], errors, truncated}`. |

Definitions use the job JSON API, not the administrator-only `config.xml`. Types normalize to `string`, `choice`, `boolean`, `git`, `password`, or `unknown`. Boolean defaults remain booleans; empty strings remain empty strings. Password/Credentials/Secret classes and sensitive names have a `null` default and `sensitive:true`; object defaults are not exposed. These definitions describe task defaults, not the values selected for a particular historical build.

Git choices require a declared Git Parameter and its supported `PT_*` type. The plugin descriptor GET uses `param=<parameterName>` (verified with Git Parameter 0.9.13). Candidates are deduplicated and limited to 200; `truncated:true` means more candidates exist. Plugin errors are returned in `errors` with no usable choices; HTTP 403/404/500 remain errors and are not reported as an empty successful list. Available candidates depend on the job's SCM configuration, plugin version, and Jenkins account permissions. Reading definitions or candidates does not schedule a build.

Triggering a build is a write action and may run deployment jobs. Inspect the exact job and parameters before calling it. Jenkins build logs can contain sensitive output; handle results according to the organization's Jenkins access policy.
