---
name: jenkins-build-triage
description: Investigate a Jenkins job, failed build, queue delay, build log or test failure using the Jenkins plugin tools.
---

# Build triage

Identify the exact folder and job full name with `getJobs` and `getJob`, then inspect `getBuild` for the requested build number or latest build. For a queued run, use `getQueueItem`. Read a relevant part of the log with `getBuildLog`; in MCP mode, use `searchBuildLog` or `getTestResults` when available. Attribute the failure only to evidence in returned Jenkins data, name the build number and link, and distinguish a current running build from a completed failure. Logs are potentially sensitive; summarize what is needed rather than reproducing secrets or large outputs.
