---
name: jenkins-trigger-build
description: Use when the user explicitly asks to run or trigger a Jenkins build.
---

# Trigger a build

1. **Input and authorization.** Read the user's requested job and parameters. Explicit user instructions take precedence over this workflow. A request to investigate, preview, or test the plugin does not authorize a build. Ask only for missing or ambiguous target details; stop if the user cancels or prohibits execution.
2. **Resolve facts.** Use `getJob` for the full job name, then `getJobParameters` for declared types and safe defaults. Use `getGitParameterChoices` when a requested Git value needs checking. Defaults are not historical selections. Do not infer a branch, deployment environment, build permission, or successful candidate lookup from missing, truncated, or failed data. Sensitive, file and unsupported parameters must be handled in Jenkins; do not request secrets in chat.
3. **Review.** Call `showJenkinsTriggerConfirmation` with the exact job and proposed parameters. The card permits editing and sends the final values back through the conversation. If the host cannot render or send the card, present the same safe values in text and wait for explicit confirmation. Cancel or ambiguous delivery means stop, not an automatic retry.
4. **Submit once.** After explicit confirmation, call `triggerBuild` with the final parameters, subject to host approval. Jobs may deploy or irreversibly change external systems. Tool annotations do not guarantee that this host will prompt for approval. Never bypass a denial. Repeated calls queue repeated builds; if submission times out, inspect the queue before any resubmission and ask if the outcome remains uncertain.
5. **Output and tracking.** Preserve the returned queue ID. Call `showJenkinsQueueCard` without automatic expansion when an ID exists. Use `getQueueItem` and `getBuild` for later factual status reports. The visible card polls only while open. Do not claim completion while queued/running, infer a build from “latest” when queue correlation fails, or repeat the card's facts below it. Report only a necessary next step or unresolved issue.

Tool and security contract: [configuration](../../docs/configuration.md).
