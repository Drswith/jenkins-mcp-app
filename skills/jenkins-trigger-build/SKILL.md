---
name: jenkins-trigger-build
description: Trigger a Jenkins job requested by the user and follow its queue item and resulting build.
---

# Trigger a build

Resolve the exact job with `getJob` and check requested parameters before using `triggerBuild`. When available, use `getJobParameters` to read declared defaults and Choice options, and `getGitParameterChoices` for the requested Git parameter. Definitions describe task defaults, not selected values in a historical build. Treat candidate errors or truncation explicitly; do not invent branches or infer that an error means no candidates. The tool contract is in [configuration](../../docs/configuration.md#parameter-reads).

A build may deploy or mutate external systems, so ask for missing job or parameter details when the intended target is ambiguous. Use the user request as the authorization for the build; do not trigger one while merely investigating or browsing. After scheduling, return the queue item ID or URL. When a queue ID is available and a visual tracker would help, call `showJenkinsQueueCard` with the exact job full name and numeric queue ID. The card refreshes only while open. Use `getQueueItem` and then `getBuild` for model-side status reports; never claim completion while the run is queued or building.
