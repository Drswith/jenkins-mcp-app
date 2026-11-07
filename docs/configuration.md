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

Local REST requests have a 30-second timeout per attempt. GET requests retry once only for recognized transient connection errors; HTTP errors and write requests are never automatically retried. Network diagnostics expose a known error code or a fixed timeout label, without including credentials, query strings or raw error details. An error after submitting a build therefore requires checking its queue before any manual resubmission.

## Modes

**MCP mode** connects to `<JENKINS_URL>/mcp-server/mcp` using the Jenkins MCP Server plugin's [Streamable HTTP transport](https://plugins.jenkins.io/mcp-server/). It forwards the upstream schemas (without the free-form `tree` field selector) and filtered results for these tools when Jenkins exposes them: `whoAmI`, `getStatus`, `getJobs`, `getJob`, `getBuild`, `getBuildLog`, `searchBuildLog`, `getTestResults`, `getQueueItem`, `getJobScm`, `getBuildScm`, `getBuildChangeSets`, `findJobsWithScmUrl`, `triggerBuild`. Other upstream tools, including replay and build metadata updates, are not exposed by this package. Jenkins plugin versions and permissions may change the visible list.

**API mode** needs no Jenkins MCP plugin. It exposes `getJobs`, `getJob`, `getJobParameters`, `getGitParameterChoices`, `getBuild`, `getBuildLog`, `getQueueItem`, and `triggerBuild`. Jobs use slash-separated full names. Build parameters are submitted as URL-encoded strings, numbers, or booleans; Choice and GitParameter values work when supplied as strings. File, secret, and structured plugin-specific submissions are unsupported. Recognized job, build, and queue links are rebuilt under the configured controller root; unknown or out-of-root response links become `null`. A build `Location` is accepted only when it identifies `queue/item/<id>/` within the configured context path (or as a relative Jenkins path). The log result is capped at 64 KiB. API mode does not provide test results, SCM or log search.

## Result filtering

Every tool result passes through `src/sanitize.js` before it leaves the bridge, in both modes.

- **Secret masking (all tools, including app-only UI tools):** credentials embedded in URLs, `Authorization`/Bearer values, `password`/`secret`/`token`/`api_key`-style key–value pairs, PEM private keys, common token formats (GitHub, GitLab, Slack, AWS access keys, Jenkins API tokens) and the caller address that the Jenkins MCP Server plugin records in build causes are replaced with `****`. Masking is pattern-based and cannot recognize every secret; Jenkins credential bindings remain the primary protection.
- **Field minimization (model-visible tools):** the upstream `{message, result, status}` envelope is removed; `_class`, `absoluteUrl`, `authorEmail` and `addr` are dropped; `color` becomes `status` (`success`, `failure`, `unstable`, `aborted`, `notBuilt`, `disabled`) plus `building:true` for running jobs; folders gain `type:"folder"`; `queueId` is kept only for queue tools (`triggerBuild`, `getQueueItem`, `showJenkinsQueueCard`); a change-set `date` is dropped when `timestamp` exists; test `errorStackTrace` keeps its first 8 lines.
- **MCP mode field selection:** the upstream `tree` argument is removed from tool schemas and ignored in calls, so each tool returns the Jenkins MCP Server plugin's default field set.

App-only UI tools keep their structure because the bundled views depend on it.

## Parameter reads

Both modes provide these two local read tools through Jenkins REST, independent of the upstream MCP plugin:

| Tool | Input | Result |
| --- | --- | --- |
| `getJobParameters` | `jobFullName` | `{jobFullName, parameters}`; each definition has `name`, normalized `type`, `description`, `defaultValue`, optional Choice `choices`, Git `gitType`, and `sensitive`. |
| `getGitParameterChoices` | `jobFullName`, `parameterName` | `{jobFullName, parameterName, choices:[{name,value}], errors, truncated}`. |

Definitions use the job JSON API, not the administrator-only `config.xml`. Types normalize to `string`, `choice`, `boolean`, `git`, `password`, or `unknown`. Boolean defaults remain booleans; empty strings remain empty strings. Password/Credentials/Secret classes and sensitive names have a `null` default and `sensitive:true`; object defaults are not exposed. These definitions describe task defaults, not the values selected for a particular historical build.

Git choices require a declared Git Parameter and its supported `PT_*` type. The plugin descriptor GET uses `param=<parameterName>` (verified with Git Parameter 0.9.13). Candidates are deduplicated and limited to 200; `truncated:true` means more candidates exist. Plugin errors are returned in `errors` with no usable choices; HTTP 403/404/500 remain errors and are not reported as an empty successful list. Available candidates depend on the job's SCM configuration, plugin version, and Jenkins account permissions. Reading definitions or candidates does not schedule a build.

Triggering a build is a write action and may run deployment jobs. Inspect the exact job and parameters before calling it. Jenkins build logs can contain sensitive output; handle results according to the organization's Jenkins access policy.

## Tool annotations and packaging

Every API, forwarded MCP, and UI tool explicitly declares all three hints.
`openWorldHint: false` describes the configured, bounded private Jenkins workspace.
`triggerBuild` uses `readOnlyHint: false` and `destructiveHint: true`: a job may
deploy, overwrite data, or mutate external systems through its pipeline, and
those effects may be irreversible. Each invocation schedules another build;
never retry a submission automatically. User intent, parameter review and host
approval safeguards remain necessary; annotations do not enforce permissions.

The annotation rationale above is retained. As of 2026-11-07, official guidelines
and remote review/error documentation still disagree about mandatory submission
justifications; the local-MCP submission path is documented but requires an
approved organization. Confirmed requirements, project gaps and the remaining
policy questions are maintained in the
[public submission assessment](https://github.com/Drswith/jenkins-mcp-app/blob/main/docs/public-submission.md).

This package uses the Agent Plugins 1.0.0 schema. Root `skills/` is discovered
automatically; a top-level `skills` field belongs to the Codex compatibility
manifest and is not allowed by this schema. Each skill's `agents/openai.yaml`
declares the bundled `jenkins` MCP dependency; its stdio launch contract stays
in root `mcp.json`. See [packaging](https://developers.openai.com/plugins/build/plugins).

Filtering also applies to UI-only result `_meta`. No secret-masking setting exists.

## Display settings

The server advertises `openai/settings` with `readJenkinsSettings` and
`updateJenkinsSettings`. The read tool accepts `{}` and returns `schema`, `values`
and `layout`; the update tool accepts `{set:{...changedFields}}` and preserves
other values. These app-only tools do not read or change credentials.

| Field | Type and bounds | Default |
| --- | --- | --- |
| `watchedJobs` / 关注的任务 | Comma-separated full names, up to 8 distinct jobs and 2048 characters | Empty |
| `evidenceLines` / 卡片中的日志证据行数 | Integer 1–10 | 3 |

Values persist at `<credential-config-path>.settings.json`, normally
`~/.config/jenkins-codex-plugin/config.json.settings.json`. The file contains only
these two fields. It must be a private regular file (0600 on Unix); symlinks and
invalid content are rejected. Writes use a private temporary file and atomic
rename. A malformed existing file is never silently reset. The configured
credential file remains separate and unchanged.

If the host has no native settings UI, edit this display file in a private local
editor, set its mode to 0600, then reopen the view. Example (placeholders only):

```json
{"watchedJobs":"folder/example-job", "evidenceLines":3}
```

The settings action `checkJenkinsConnection` has UI metadata so supporting hosts
can show its result in a settings modal. It reads accessible jobs, one sample or
watched job, parameter definitions, an existing build, its log and stages. It
reports denied, unavailable, failed and unverified separately. It never posts to
a build endpoint. `buildable:true` does not prove permission to execute a build;
build permission stays unverified. MCP transport is separately verified through
model read tools in MCP mode. URLs and tokens are not settings fields or check
results; secret masking is always enabled.

## Confirmation and evidence tools

`showJenkinsTriggerConfirmation({jobFullName, parameters?})` reads declared
parameters, validates types and Choice values, and displays safe defaults plus
changes. Unknown, secret and unsupported submissions are rejected. It does not
schedule anything. Card edits are sent to the conversation with `ui/message`;
only the model can then call `triggerBuild` after user confirmation, subject to
host safeguards. A hint alone cannot guarantee an approval dialog.

`uiGetBuildEvidence({jobFullName, buildNumber?})` resolves one exact build before
reading stages, bounded log excerpts and the last 50 build change sets. Results
include original line numbers, truncation and unavailable-baseline indicators.
Card results keep display data under `_meta.card` and model-needed facts under
`structuredContent`. Both are sanitized. No card calls `triggerBuild` directly.
