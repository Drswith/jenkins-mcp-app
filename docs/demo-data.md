# SG 演示数据

本页记录迁移前在 Jenkins 2.580.1 源服务上建立的 SG 合成演示数据与当时的操作方式。迁移与补跑的核验结果以 [兼容测试最终快照](legacy-test.md#迁移与补跑后的最终快照) 为准。`scripts/seed-jenkins-demo.mjs` 及其扩展脚本读取 `.local/jenkins-test/zeabur/config.json` 并限制到原 Jenkins URL alias；该 alias 已重绑定到 legacy 服务，所以这些脚本现在会连接到目标。写入命令仍沿用旧作业模板，运行前须核对其对目标插件和已迁移数据的影响。

## 场景

| 任务 | 场景 |
| --- | --- |
| `demo-web-build` | 前端检出、构建日志、失败后恢复 |
| `demo-api-tests` | JUnit 成功和失败、UNSTABLE 测试趋势 |
| `demo-release-package` | 参数化版本与环境、压缩包及发布清单 |
| `demo-config-validation` | 配置校验失败、错误日志 |
| `demo-deploy-preview` | 生成预览发布计划文件，不执行真实部署 |
| `demo-long-log` | 警告、日志搜索、超过 64 KiB 的长日志 |
| `demo-cancelled` | 实际启动后取消构建，保留 ABORTED 历史 |
| `demo-disabled` | 构建后停用，保留历史与产物 |
| `demo-branches/web-dashboard` | 文件夹内的前端功能分支 |
| `demo-branches/api-validation` | 文件夹内的 API 校验分支 |

每个任务运行六轮，结尾有成功、失败、不稳定、中止、停用等不同状态。并发由 Jenkins 的两个执行器控制；批次执行期间会自然形成队列。JUnit 报告内容是明确标注的合成测试夹具，由真实插件解析。构建记录使用实际执行时间，不伪造过去日期。

扩展批次另有 16 个任务，其中 15 个运行三至四轮，另一个保留为零构建历史：

| 任务 | 扩展场景 |
| --- | --- |
| `demo-scm-checkout-failure` | 不存在分支，真实 SCM 失败 |
| `demo-missing-test-report` | 构建命令完成，但 JUnit 文件缺失导致失败 |
| `demo-skip-only-tests` | 全部测试跳过 |
| `demo-test-recovery` | 连续 UNSTABLE 后恢复，失败测试项转为 PASSED |
| `demo-unicode-logs` | 中文、emoji、ANSI、标准错误及中文产物文件名 |
| `demo-large-artifact` | 256 KiB 二进制文件和校验文件 |
| `demo-empty-artifacts` | 成功但无产物 |
| `demo-command-timeout` | `timeout` 命令真实超时，退出码 124 |
| `demo-private-checkout` | 私有仓库使用只读 token 检出 |
| `demo-private-permission-failure` | 私有仓库未配置凭据，检出失败 |
| `demo-platform/SG 运维/配置 校验` | 多层目录、中文与空格、布尔参数 |
| `demo-tag-checkout` | 检出固定 Git 标签 |
| `demo-pipeline-release` | Pipeline 阶段、归档、布尔参数及下游构建 |
| `demo-pipeline-parallel` | Pipeline 并行分支 |
| `demo-pipeline-recovery` | Pipeline 阶段失败和恢复 |
| `demo-never-built` | 可构建，但保留为从未运行 |

Gitea 使用 `demo-web-portal`、`demo-order-api`、`demo-infra-config` 三个公开演示仓库，包含合成源码、CI 脚本、六轮版本提交、功能分支、发布分支和标签。每个仓库增加三个 Issue、一个开放 PR 和一个已合并 PR；真实 Jenkins 构建结果回写为 Git 提交状态，并链接到对应构建。

扩展批次还创建私有的 `demo-private-config`，仅包含合成配置。Gitea token 只授予 `read:repository`，放入 Jenkins 加密凭据库中的 `demo-gitea-readonly`；本机恢复材料保存在被忽略的 `.local/jenkins-demo/private-git-token.json`，权限为 `0600`。脚本不会在源文件、控制台或参数中输出 token。三个公开仓库还各有三种标签、开放/关闭两个里程碑，以及预发布/正式发布两份演示 Release。

第三批通过 `scripts/seed-jenkins-broad-demo.mjs` 补充行为场景，复用已安装插件，不新增执行器或定时构建：

| 任务 | 第三批场景 |
| --- | --- |
| `demo-pipeline-retry` / `demo-pipeline-retry-exhausted` | 暂时错误重试成功、预算耗尽及恢复 |
| `demo-pipeline-catch-error` | 阶段失败后继续执行，整体 UNSTABLE |
| `demo-pipeline-timeout` | Pipeline timeout 真实中止及恢复 |
| `demo-input-approved` / `demo-input-rejected` | 实际等待 input，再由演示脚本批准或拒绝，保留闸门历史 |
| `demo-pipeline-stash` | stash/unstash 在不同工作目录传递文件 |
| `demo-workspace-cleanup` | deleteDir 后重新检出 |
| `demo-command-return-status` | 捕获非零退出码，继续并标记 UNSTABLE |
| `demo-platform-matrix` | 四种平台名称的并行合成校验；并非在四种真实操作系统上执行 |
| `demo-pipeline-from-scm` | 从仓库 Jenkinsfile 读取 Pipeline 定义 |
| `demo-multi-repository-pipeline` | 同一 Pipeline 检出两个仓库，聚合变更集、24 个测试及产物 |
| `demo-artifact-fingerprint` | 相同产物跨构建指纹关联 |
| `demo-multiple-test-suites` | 聚合多份 JUnit XML |
| `demo-large-test-report` | 180 个测试项、失败堆栈及标准输出 |
| `demo-malformed-test-report` | 损坏 XML 被 JUnit 插件转换为失败测试项，整体 UNSTABLE，随后修复 |
| `demo-test-error-exception` | JUnit error 异常堆栈及恢复 |
| `demo-unicode-test-names` | 中文、空格及 XML 特殊字符测试名称 |
| `demo-test-duration-trend` | 合成测试用时随构建次数增长 |
| `demo-parameter-escaping` | 参数中的中文、引号、空格、换行和特殊字符回读 |
| `demo-no-scm` | 无 SCM、无测试报告的维护任务 |
| `demo-batch-changes` | 单次构建汇集多个提交，以及文件新增/删除 |
| `demo-empty-repo-checkout` | 空仓库没有可构建 revision |
| `demo-archived-repo-checkout` | 已归档仓库仍可只读检出 |
| `demo-build-display-name` | 自定义构建名称与多行描述 |
| `demo-concurrent-builds` | 同一任务使用不同参数并发执行 |

第三批增加 `demo-ci-lab`、`demo-archived-project`、`demo-empty-repository`。高级 CI 仓库保留关闭但未合并的 PR、包含评审评论的 squash 合并、真实文件冲突的开放 PR、配置变更与回退、Issue 讨论与关闭，以及草稿 Release。归档操作只作用于新增的归档演示仓库，空仓库特意保持未初始化。

还通过 `scripts/seed-gitea-extra-demo.mjs` 增加实际 rebase 合并、Issue 关闭后重新打开、讨论评论、标签与里程碑，以及非草稿预发布中的小型附件。批量变更使用明确标为“演示”的不同提交作者和 `example.invalid` 邮箱，不冒用真实人员身份。

`scripts/seed-gitea-review-demo.mjs` 使用独立非管理员 `demo-reviewer` 完成真实评审往返：请求修改、仓库所有者更新新文件、评审者批准；PR 保持开放，便于与待审、冲突和已合并记录比较。评审账号只有 `demo-ci-lab` 的只读协作权限，不发送注册通知，随机密码仅保存在 `.local/jenkins-demo/demo-reviewer-access.json`（`0600`）。

第四批在旧 Jenkins 2.580.1 源服务新增 `demo-multibranch-lab` 仓库、`demo-multibranch` 父项及自动创建的分支/PR 子任务，并验证 webhook 与扫描构建。每日 `demo-daily-history` 也曾在该源服务按实际日期生成提交。迁移后的 timer、Multibranch 与 Pipeline 阶段验证结果见[兼容测试最终快照](legacy-test.md#迁移与补跑后的最终快照)及 [Multibranch、Webhook 与跨天历史](multibranch-history.md)。

## 运行与读取

下方命令和插件清单描述的是旧 2.580.1 测试环境的历史生成流程。目标使用 2.263.1 锁定插件闭包，见 [legacy 测试说明](legacy-test.md)。这些脚本通过已重绑定的旧 URL alias 连接目标；写入步骤会在现有迁移数据上操作，运行前应先核对作业模板和可能影响。

```sh
# 创建演示对象并追加六轮真实构建，需要明确的写入授权。
node scripts/seed-jenkins-demo.mjs --run

# 仅回读远端数据并生成本机汇总。
node scripts/seed-jenkins-demo.mjs --verify

# 在基础批次完成后，追加扩展任务和三至四轮构建。
node scripts/seed-jenkins-extended-demo.mjs --run

# 回读基础与扩展批次的全部演示任务和仓库。
node scripts/seed-jenkins-extended-demo.mjs --verify

# 仅补充发布、标签和里程碑元数据，再回读汇总。
node scripts/seed-jenkins-extended-demo.mjs --git-metadata

# 补充第三批场景，并追加构建历史。
node scripts/seed-jenkins-broad-demo.mjs --run

# 回读三批任务；空仓库、归档与 PR 状态另外生成元数据汇总。
node scripts/seed-jenkins-broad-demo.mjs --verify

# 中断后回读匹配的构建结果，跳过已完成场景，继续第三批。
node scripts/seed-jenkins-broad-demo.mjs --build-only --resume

# 补充独立的 Git 协作场景，--merge 同时完成已创建的演示 rebase PR。
node scripts/seed-gitea-extra-demo.mjs --run
node scripts/seed-gitea-extra-demo.mjs --merge

# 增加不同用户的“请求修改→批准”评审记录。
node scripts/seed-gitea-review-demo.mjs --run
```

上述前三批脚本重复运行 `--run` 会继续追加历史，恢复演示任务的构建配置，再在最后停用 `demo-disabled`；这些脚本不会配置定时构建。第四批的原生每日任务独立配置，首次仓库夹具不应用来重置已积累的自然数据。网络异常时先区分直连和代理路径，按需给单次命令设置当前有效的代理环境变量；不要把临时代理端口写入仓库配置。

本机结果写入被 Git 忽略的 `.local/jenkins-demo/`：`builds.json` 记录当次新增构建，`summary.json` 是远端当前汇总。原始日志与本机结果不加入版本控制。任务最多保留 100 次构建及其产物。

扩展脚本复用基础脚本的服务校验、API 客户端、任务模板及构建调度，结果保存在 `extended-builds.json`、`extended-summary.json`。下游构建的记录保留在对应任务中，并在最终回读时计入总数。

第三批输出 `broad-builds.json`、`broad-summary.json` 和 `broad-git-metadata.json`，均留在被忽略的本机目录。构建分组运行以限制云端并发；input 闸门使用最长 60 秒的超时，并由脚本跟踪处理，不留下长期等待的审批。

第三批的历史保留策略显式设置天数为 `-1`、数量为 `100`，避免默认天数导致记录过早清理。XML 更新明确发送 UTF-8；input 操作使用 Jenkins 实际返回的 ID。建立场景时产生且仍留存的脚本编译失败和 input 等待超时，也保留为真实的配置修复历史。

## 已验证的数据规模

2026-10-12 三个批次完成后的旧源服务回读快照，以下统计仅计入 `demo-*` 对象，不包含原有冒烟任务和仓库：

| 数据 | 数量 |
| --- | ---: |
| 演示任务 | 52（含 16 个 Pipeline、1 个停用任务、1 个从未构建任务） |
| 构建历史 | 198（130 SUCCESS、35 FAILURE、22 UNSTABLE、11 ABORTED） |
| 归档产物 | 444 |
| 演示仓库 | 7（6 公开、1 私有；含 1 个归档仓库、1 个空仓库） |
| 提交 | 119（各仓库所有分支按 SHA 去重后求和） |
| 分支 / Git 标签 | 21 / 12 |
| Issue / PR | 11 / 11（5 开放、5 已合并、1 关闭但未合并） |
| Release / 发布附件 | 8（含 1 草稿） / 1 |
| 里程碑 / Issue 标签 | 7 / 11 |

已实测测试失败后恢复、全部 12 项跳过、5 个 Pipeline 阶段及真实下游构建关联、私有检出成功与无凭据失败、无产物、256 KiB 产物下载和约 245 KiB 日志。工作台预览已读取云端数据，并打开中文嵌套任务的构建详情。上述三个批次完成时队列和执行器均空闲，当时未配置定时构建。

通过新建 MCP 连接实测三页顶层任务读取（10、10、7 项，包含原有任务和文件夹）、中文任务、停用与从未构建状态，以及 Pipeline 失败测试筛选。`pnpm test` 的 4 项模拟测试与脚本语法检查通过；这些检查不代表当前 Codex 宿主中的原生 Apps 面板已重新验证。

第三批增加 26 个任务、86 条实际留存构建和 144 个产物。17 项只读行为断言通过，包括三次重试、异常捕获后继续、timeout、实际 input 批准/拒绝、SCM Jenkinsfile、多报告与大报告、中文测试项、跨构建指纹、特殊参数回读、同任务并发区间重叠、测试用时递增、双仓库变更集及 JUnit 解析错误。新 MCP 连接读取了六页共 53 个顶层条目，并核对双仓库 Pipeline 的两份非空变更集和 180 项报告中的 3 个失败项。SCM Jenkinsfile 来源通过原生配置和构建日志确认；当前 MCP 的 SCM 工具只返回 Git 信息，没有暴露 Jenkinsfile 定义。

2026-10-13 第四批完成后，在旧 2.580.1 源服务重新回读所有演示任务：

| 数据 | 当时数量 |
| --- | ---: |
| 演示构建任务 | 58（不计文件夹与 Multibranch 父项） |
| 构建历史 | 213（142 SUCCESS、36 FAILURE、24 UNSTABLE、11 ABORTED） |
| 归档产物 | 483 |
| 演示仓库 | 8 |
| 新 Multibranch 仓库 | 20 个唯一提交、5 个分支、2 个 PR（1 开放、1 关闭未合并） |

本批新增 6 个构建任务、15 条构建历史和 39 个产物，其中 8 条由真实 webhook 事件触发。回读时队列为零、执行器空闲。每日任务配置和未来自然积累的验证边界见 [运行说明](multibranch-history.md)。当前统计证据是被忽略的 `.local/jenkins-demo/multibranch-totals.json`。

## 覆盖边界

迁移数据仍未覆盖真实外部构建节点与不同操作系统、节点断线后恢复，以及长期跨周趋势。Multibranch 自动发现、PR 自动构建和真实 webhook 曾在 2.580.1 源服务验证；迁移后的核验、旧 Pipeline 图数据边界与重放结果见[兼容测试最终快照](legacy-test.md#迁移与补跑后的最终快照)。平台组合是合成校验；全部历史构建使用实际执行时间，未伪造日期。真实生产发布和长时间压力测试也未执行。
