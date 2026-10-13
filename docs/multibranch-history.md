# Multibranch、Webhook 与跨天历史

本节记录 2026-10-13 在旧 Jenkins 2.580.1 源服务上配置与验证的 Multibranch、Webhook 和定时历史链路。迁移后的核验与补跑数据以 [兼容测试最终快照](legacy-test.md#迁移与补跑后的最终快照) 为准。旧 Pipeline 完成图未转换，阶段图验证通过新模拟构建补充；旧服务已停机并提交延迟删除，状态见[云端说明](zeabur-test.md)。目标插件清单见 [legacy 锁定清单](../test/legacy-jenkins/plugins.txt)。

## 迁移前链路

`codex-test/demo-multibranch-lab` 是新增的公开合成仓库；`demo-multibranch` 是真实 `WorkflowMultiBranchProject`，从各分支的 `Jenkinsfile` 自动建立子任务。使用 Scripted Pipeline，两个现有执行器，单次构建最长 60 秒，通常约 2–3 秒。

- 普通分支策略为 `BranchDiscoveryTrait(1)`，排除已有开放 PR 的来源分支，避免分支和 PR 重复构建。
- PR 策略为 `OriginPullRequestDiscoveryTrait(1)`，构建 PR 与目标分支的合并结果。
- 不含 Jenkinsfile 的分支不建立任务；`feature/no-jenkinsfile` 是这个负例。
- 关闭 PR 后保留停用子任务及历史，原来源分支重新成为普通分支任务。子任务保留最近 60 次/60 天构建，产物保留最近 15 次/15 天。

Jenkins 的 Gitea server 使用项目内网 URL，并以公开 Gitea URL 作为 `aliasUrl`，匹配 webhook payload 中的公开仓库地址。Webhook 名称为 `[DEMO] Jenkins Multibranch`，目标是 Jenkins 根 URL 下的 `/gitea-webhook/post`，选取 push 与 PR 事件，JSON 格式。全局自动管理 hooks 和 source 的 webhook registration 均关闭；手工配置单个演示仓库的 hook，避免扩大管理范围。

此版本 Gitea 插件不校验 webhook secret/HMAC，因此这里没有把 secret 当作认证措施。相关行为以 [Gitea 插件源码](https://github.com/jenkinsci/gitea-plugin/blob/master/src/main/java/org/jenkinsci/plugin/gitea/GiteaWebhookAction.java) 为准。Webhook 只通知已配置的演示 SCM 源，构建代码由其分支或 PR 的实际 Git revision 提供。

非管理员 `demo-ci-bot` 仅对这个仓库有 Write 协作权限。PAT scope 为 `write:repository` 与 `read:user`，前者用于 Git 推送和构建提交状态，后者供插件读取身份；没有授予 webhook 管理所需的仓库 Admin 权限。Jenkins 中保存加密的 PAT 和 Git username/password 凭据；本机恢复材料只在 `.local/jenkins-demo/multibranch-ci-bot-access.json`（`0600`）。令牌不进入 Git URL、源码、参数或日志。

## 每日自然积累

`demo-daily-history` 在目标 Jenkins 原生运行：Asia/Shanghai 时区，计划表达式为 `TZ=Asia/Shanghai` 与 `H 3 * * *`，当前解析为每天 03:14，任务禁止并发。具体分钟由任务完整名称的 hash 决定，重命名会改变分钟；下次运行时间会随日期变化，不固定记录。

每天最多一个 Git 提交，只更新 `master` 的 `ci/daily-history.json` 和 `ci/scenario.txt`。日期使用实际的 Asia/Shanghai 日期，场景按真实 epoch day 选择成功为主、偶尔不稳定或失败的合成夹具；构建描述会记录 `synthetic=true` 和预期结果。当天重复执行直接跳过提交。

任务禁止自身并发，运行上限 60 秒、保留最近 60 次/60 天，无产物留存。Git 使用专用 bot 凭据推送，临时 askpass 文件只引用环境变量，结束时删除。

Push webhook 自动构建 master。该插件的 push 事件仅列出被推送的分支，不会自动重建所有以它为目标的 PR，所以 updater 还通过 `build job:'demo-multibranch', wait:false, quietPeriod:15` 请求一次延迟扫描。扫描发现 PR 合并目标 SHA 改变后，再自动构建 PR；这条记录的来源是 branch indexing。它不向 PR 分支追加提交，也不等待扫描完成占住执行器。能力依据 [BuildTriggerStepExecution 601 源码](https://github.com/jenkinsci/pipeline-build-step-plugin/blob/601.v6d4c6d1a_9dc7/src/main/java/org/jenkinsci/plugins/workflow/support/steps/build/BuildTriggerStepExecution.java) 与现场构建记录。

每日成本是一个短 updater、至多一个提交、一次扫描和 revision 发生变化的短分支/PR 构建。目标 timer 配置已回读；迁移后的运行结果见[最终快照](legacy-test.md#迁移与补跑后的最终快照)。

## 已完成的现场验证

迁移前于 2026-10-13 在 2.580.1 源服务配置并实测：

- 初次索引自动建立 `master`、`develop`、`PR-1`；无 Jenkinsfile 分支被排除，开放 PR 的来源分支没有重复任务。
- 实际 Git/API 变更触发 8 条 `BranchEventCause` 构建：develop 恢复、新分支自动发现、PR 打开、PR 同步的 UNSTABLE/FAILURE/SUCCESS、既有 PR 同步、PR 关闭后普通分支恢复。没有手工触发子任务冒充 webhook。
- PR 合并构建日志包含 `CHANGE_ID`、`CHANGE_TARGET`，检出日志包含对应真实 head SHA；Gitea 原生 hook 页面最新可见 10 条投递均 HTTP 200/成功，包括 push、PR synchronized 与 closed。UI 只显示最近 10 条，当前窗口不含更早的 opened 投递。
- updater 首次运行 SUCCESS，约 2.6 秒；同日第二次约 1 秒，SUCCESS 且没有重复提交，令牌未出现在日志中。延迟扫描随后实际产生 `PR-1 #3`，由 `BranchIndexingCause` 触发。
- 新 stdio MCP 连接分页读取六页共 55 个顶层条目，确认 Multibranch 父项类名与文件夹识别规则；读到父项的 5 个子任务，并成功读取包含斜杠的分支完整名称 `demo-multibranch/feature%2Fwebhook-auto` 及其构建。工作台源码已把 Multibranch 父项识别为文件夹；未重新验证 Codex 原生 Apps 面板交互。

自然跨天数据需要实际日期到来；这里不伪造过去时间，也没有将手工 smoke 运行声称为已经发生的定时触发。

原记录提到每周日 09:00 的 `sg-ci` 只读巡检，但在本机 `$CODEX_HOME/automations/` 未找到对应配置文件，无法确认该 automation 仍存在或执行。不要把该巡检作为当前监控承诺；如恢复巡检，需先重新建立并核实配置。该巡检不是每日历史生成链路的依赖。

## 迁移前复用与停用

以下命令仍读取原 profile 路径，但其中的旧 Jenkins URL alias 已绑定到 2.263.1 服务。只读回查会访问当前目标；配置、扫描、构建等写入步骤也会作用于目标控制器。由于脚本模板沿用旧 2.580.1 作业定义，执行前须逐项核对对目标插件和现有迁移数据的影响。

```sh
# 仅首次建立仓库夹具；后续自然数据变化时不要用它重置内容。
node scripts/seed-jenkins-multibranch-fixture.mjs --run

# 建立专用 bot、加密凭据、Multibranch、Webhook 和原生 daily timer。
node scripts/configure-jenkins-multibranch-demo.mjs --configure

# 首次扫描由父任务触发，子任务由分支源自动创建和构建。
node scripts/configure-jenkins-multibranch-demo.mjs --scan

# 真实 push、PR 打开/同步/关闭事件与构建来源验证。
node scripts/exercise-jenkins-multibranch-demo.mjs --run

# 手工测试 daily updater；同一天不会产生重复提交。
node scripts/configure-jenkins-multibranch-demo.mjs --daily

# 只读回查控制器、子任务、Webhook 与下一次定时运行。
node scripts/configure-jenkins-multibranch-demo.mjs --verify
```

停用每日积累时，禁用 `demo-daily-history` 即可；保留构建、仓库和原有样本。需要停用事件构建时，再将这个仓库的 hook 标为 inactive。Multibranch、hook 与备份状态见[最终快照](legacy-test.md#迁移与补跑后的最终快照)，本机原始证据与完整 raw backup 保留在私有目录，不加入版本控制。此前提及的每周 `sg-ci` 巡检配置尚未在本机找到，恢复或停用说明待核实。
