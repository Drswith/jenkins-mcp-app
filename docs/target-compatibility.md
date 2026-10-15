# 内网目标兼容性基线

2026-10-13 再次只读核验 `http://jenkins.kukahome.com:8090/`，并回读当前 SG 服务。**双方 Jenkins 核心版本均为 2.263.1；已知主要功能已在 SG 覆盖，但完整插件与构建运行环境尚未确认一致。** 当前 SG 配置与实测历史统一见 [SG 兼容实例](legacy-test.md)，下表不再使用已停机的 2.580.1 实例作对照。

首次核验使用目标 HTTP 响应头及已登录浏览器的 GET 请求；随后用户自行创建 API Token，通过本机输入页保存后，又使用 Token 完成项目 API 桥接器与 REST 的只读核验。没有触发内网构建、读取控制台日志或修改远端配置。企业任务名称、参数选项、节点名称和实际内网返回地址只保存在被忽略的 `.local/jenkins-target/`，本机证据文件权限为 `0600`。

## 当前对照

| 项目 | 内网目标：本次已确认 | 当前 SG 2.263.1 |
| --- | --- | --- |
| 核心版本 | HTTP `X-Jenkins: 2.263.1` | 运行时 `Jenkins.VERSION: 2.263.1` |
| 接入方式 | 登录态与 API Token 的 REST 读取均已通过；MCP 与 health 路径均返回 404 | 显式 API 模式，未安装 MCP Server |
| Pipeline | 当前账号可见 48 个 WorkflowJob；46 个有历史。抽查包含 Declarative 自动阶段，但各任务的具体 Pipeline 定义不可读 | 保留原有任务，现为 39 个 Freestyle、31 个 WorkflowJob；新增目标参数组合、Declarative 阶段及队列夹具 |
| 阶段查询 | Token 已读取 46 条最近构建的阶段数据；桥接器 UI 阶段工具抽查返回 7 个阶段 | 阶段 API 已验证；模拟重跑记录具有非空阶段数据 |
| Git 分支参数 | 47 个任务使用 `GitParameterDefinition`，类型为 `PT_BRANCH` | `git-parameter:0.9.13`；4 个场景任务使用 Git Parameter，包括 Git + 两个 Choice + String、Git + Choice + Boolean；候选、实际检出及 SHA 已实测 |
| Choice | 45 个任务、85 个参数定义，共 259 个选项 | Choice 提交与分支条件已实测 |
| 其他参数 | 11 个任务使用 String、3 个使用 Boolean | String、Boolean 与中文及特殊字符回读已实测 |
| 节点与执行器 | 4 个在线节点、共 13 个执行器 | 1 个节点、1 个执行器，保留轻量测试规模 |
| 任务绝对 URL | 48 个任务返回的 URL origin 均与访问入口不同 | 项目已修正链接规范化；不同 origin/context 的链接和队列 Location 已在 SG 验证 |
| 队列读取 | `queue/api/json` 返回 200；当次为空 | API 队列 ID 到构建编号跟踪已实测 |
| Java | 尚未取得 | JDK 11.0.9 |
| 关键插件版本 | 完整清单接口返回 403，具体版本未知 | Git 4.7.0、Workflow Job 2.40、JUnit 1.49 等；锁定版本均 active |

上述目标数量仅代表当前账号可见任务与最近构建。不能据此断言目标没有 Multibranch、Webhook、定时任务或 JUnit。Declarative 重启动作表明相关插件可用，但该动作也会出现在 Scripted 构建上，不能仅凭动作存在认定全部目标任务使用 Declarative。本次没有执行阶段重启。最近构建的归档产物列表为空，也不能代表更早构建没有产物。

## 尚未对齐的部分

目标插件清单 API、任务 `config.xml` 和全局工具页均返回 403。因而尚未核实目标各插件的 ID/版本/active/enabled、JVM、节点操作系统、Git/Maven/Node/Docker/Helm 等工具版本、Jenkinsfile、凭据引用和实际部署步骤。SG 的历史插件版本是兼容 2.263.1 的测试选择，不能当作目标的实际版本。

节点规模不同是 SG 轻量测试的设置。它可以验证任务和参数交互，但尚未复现目标的节点标签选择、并发调度、工作区、工具链及内网部署资源。目标使用何种 Git 服务与部署平台，也不能由 SG 的 Gitea 测试链路代替确认。

## 项目接入与验证边界

目标应采用项目的显式 `api` 模式，无需安装 Jenkins MCP Server。工具及参数契约统一见 [连接配置](configuration.md)。Choice 和 Git Parameter 的选中值可以作为字符串提交。项目现已补齐参数定义和 Git 候选的读取工具并在 SG 验证；目标内网的新工具行为仍未实测，本轮没有向内网发请求。

项目当前已将识别出的任务、构建和队列链接规范到配置入口，相关实现和真实 SG 验证见 [配置说明](configuration.md) 与 [SG URL/队列场景](legacy-test.md)。目标返回不同 origin 的任务链接已确认；因为本次没有向目标 POST，目标构建 POST 的队列 Location 行为仍未实测。

目标 API Token 已通过认证。当时的项目 stdio 桥接器会话成功执行 `getJobs`（48 个任务）、`getJob`、`getBuild` 与 `uiGetBuildStages`；48 个任务的返回链接均规范到内网访问入口。参数定义与 Choice 选项通过只读 REST 获取，计数为 String 11、Choice 85、Git Parameter 47、Boolean 3。该次评估没有使用后续新增的参数工具，内网 Git Parameter 的动态分支候选仍未验证。

46 条已有构建的阶段数据最终全部读取成功；一条阶段请求首次超时，单独重试通过。队列列表读取成功且当次为空，所以没有可用于验证 `getQueueItem` 的在队列项目；未创建构建来填充队列。构建权限及实际 CI/CD 执行仍未验证。`buildable:true` 或页面出现构建入口不等于已经验证执行权限。

内网专用配置保存于 `~/.config/jenkins-codex-plugin/kukahome.json`，仅供显式指定后的只读评估使用。**默认 `config.json` 已恢复为 SG API 配置**，同目录的 `sg.json` 保留 SG 备份；这些文件均为 `0600`，不进入版本控制。开发、模拟任务和历史积累继续以 SG 为默认实例。此前短暂写入内网默认配置属于误解用户意图，已恢复；当前已加载插件连接也保持 SG。

## SG 更贴合目标的对齐重点

用户随后授权在 SG 补齐普通账号可确认的任务形态、参数组合、阶段及队列场景。以下保留差异依据；本轮完成的 SG 验收见下一节。内网仍只读，默认实例仍为 SG。

| 差异 | 目标证据 | SG 现状 | 后续开发应补齐 |
| --- | --- | --- | --- |
| 任务形态 | 可见的 48 个任务全是 WorkflowJob | 39 个 Freestyle、31 个 WorkflowJob，新增两个目标参数化 Declarative Pipeline | 优先使用新增 Pipeline 开发；继续保留通用历史 |
| 参数组合 | 40 个任务同时有 Git Parameter 与两个 Choice，其中 11 个再带 String；另有 3 个任务使用 Git Parameter、Choice、Boolean | 已新增这两类组合，实际 master/develop 候选、Choice/String/Boolean 回读及检出 SHA 均通过 | 目标的具体默认值和分支过滤规则仍未知，SG 使用合成配置，不声称复制生产参数值 |
| 阶段规模 | 46 条最近构建的阶段数量为 2–7，中位数 6 | 新增六业务阶段，另有自动 Post Actions，阶段 API 共返回七阶段 | 已验证成功、不稳定、失败、when 跳过、人工审批中止和继续；实际部署命令仍未知 |
| 权限 | 普通读取可用，插件清单、任务配置、工具页返回 403 | 新增受限 reader；读取可用，管理、配置、构建请求返回 403 | SG 的 Build=false 是边界测试，不代表内网账号没有构建权限 |
| 节点与队列 | 4 个节点、13 个执行器；有节点标签 | 保持 1 个节点、1 个执行器；补充前次构建阻塞、取消及不可用标签等待 | 已验证队列到构建关联及清理；真实节点工具链仍未知 |
| 插件与工具版本 | 插件/JVM/工具清单与 Jenkinsfile 未取得 | 固定了兼容 2.263.1 的插件及 JDK 11.0.9 | 待管理员提供脱敏清单后再精确调整，不能用 SG 的版本反推目标 |

参数统计基于已成功读取的只读 REST 数据。扩大到额外参数属性的探索查询出现超时与 HTTP 500，未把这些属性列为已确认能力，也没有为此变更目标配置。后续桥接器已补齐参数定义/动态候选工具；使用较窄的参数定义查询，不读取管理员配置，内网对新查询的响应仍待将来只读核验。


用户没有内网管理员权限，插件版本、JVM/工具链及 Jenkinsfile 继续标记为未知；不以提升权限作为本轮开发测试的前提。将来若有脱敏资料，再调整对应测试能力，不复制生产凭据。内网 Token 仅保存在本机私有评估配置；实际 CI/CD 验证仍需明确允许执行的任务与参数。

## SG 补齐后的实测验收

2026-10-13 新增 5 个 `sg-target-` 任务。最终回读为 70 个叶子构建任务、269 条构建和 557 个产物；顶层 API 为 63 个任务（Multibranch 的分支任务计入叶子统计）。队列与运行中构建均为零，执行器仍为 1 个。原有每日任务及 Gitea webhook 配置未改动。

| 夹具 | 实测结果 |
| --- | --- |
| `sg-target-parameter-pipeline` | PT_BRANCH + 两个 Choice + String；#8 SUCCESS、#9 UNSTABLE、#10 合成故障 FAILURE、#11 人工审批中止 ABORTED、#12 人工继续后 SUCCESS |
| `sg-target-boolean-pipeline` | PT_BRANCH + Choice + Boolean；#1 false 跳过可选阶段，#2 true 执行可选阶段，两次均 SUCCESS |
| 两个参数化 Pipeline | master/develop 动态候选均读取成功；提交参数逐项回读，归档的 SHA 精确匹配所选 Gitea 分支 HEAD；六个业务阶段和自动 Post Actions 均可读，跳过返回 NOT_EXECUTED |
| `sg-target-queue-pipeline` | 新 stdio API 会话触发并跟踪；第二项因前次构建等待，再转为 executable；第三项启动前取消、没有生成构建。两轮核验保留 #1–4 SUCCESS 历史 |
| `sg-target-queue-label` | 不改现有节点标签，使用不存在的合成标签观察等待原因；随后停止 #1，结果 ABORTED，节点队列项移除 |
| `sg-target-restricted` / `sg-target-reader` | 新 stdio 会话读取任务、构建和阶段成功；插件清单、任务 config.xml、隔离夹具构建 POST 均返回 403；构建号前后保持 1，没有产生构建 |

参数化任务使用独立公开 `[DEMO]` 仓库 `demo-target-ci`，不修改已有仓库。六业务阶段为检出、环境校验、可选检查、打包模拟、人工审批和结果模拟，产物仅用于检出/参数验证，没有实际发布或部署。

原有 250 条构建的 1,030 个 build.xml、日志与归档文件逐个 SHA-256 校验，零缺失、零变化。新增 19 条历史包含 7 条参数/阶段验收构建、5 条队列构建，以及夹具编写时保留的 5 条调试失败和 2 条成功 bootstrap；验收故障结果与早期调试失败按以上编号区分。

SG 已动态加载兼容旧 core 的 `matrix-auth:2.6.11`，无需重启；插件 SHA 与[独立权限锁](../test/legacy-jenkins/permissions-plugins.tsv)一致。矩阵策略写入数据卷 config.xml；原管理员仍有 Administer，reader 仅有 Overall.Read、Item.Read、View.Read，匿名权限保持关闭。原 config/策略和 reader Token 保存在被忽略的 `.local/jenkins-target-fixtures/`，权限 0600。插件用于 SG 权限模拟，不能推断目标安装了相同版本或采用相同策略。

默认 profile 文件 SHA-256 与执行前一致，已加载插件返回的任务 URL 仍使用 SG 原域名。没有访问内网 Jenkins、触发内网构建或切换默认实例。

复核入口（显式使用 SG 专用配置）：

```sh
node scripts/seed-jenkins-target-pipeline.mjs --verify
node scripts/verify-jenkins-target-queue.mjs --verify
node scripts/verify-jenkins-target-permissions.mjs
node scripts/verify-jenkins-target-history.mjs
```

前两个 `--verify` 只回读已有记录；权限复核会先确认 reader 的 Build=false，再向隔离夹具发送预期被拒绝的 POST。`seed-jenkins-target-pipeline.mjs --run` 与 `verify-jenkins-target-queue.mjs --run` 会在 SG 创建构建历史。权限复核依赖私有 reader profile；重建空数据卷时需要重新建立矩阵策略和 reader 账号。生成模板已包含权限插件锁，但本轮没有重新部署模板或重启控制器。

Git Parameter 0.9.13 候选接口必须传 `param=BRANCH`；传 `name=BRANCH` 会返回空列表，不能据此断言插件无法发现分支。[对应版本源码](https://github.com/jenkinsci/git-parameter-plugin/blob/git-parameter-0.9.13/src/main/java/net/uaznia/lukanus/hudson/plugins/gitparameter/GitParameterDefinition.java#L551)

本机存在 Node 直连偶发超时；已分别检查直连与当前本机代理路径。验证时仅使用进程级代理变量，不持久化代理或临时端口。仓库测试 5/5 通过；这些 mock 测试与上表的真实 SG 验收分别成立。

## 项目 API 模式与界面回归

2026-10-13 在上述 SG 夹具上完成项目 API 模式开发回归；本轮没有访问内网或修改默认实例。新工具契约统一见[连接配置](configuration.md#parameter-reads)，界面行为见[UI 文档](ui.md)。

| 验证 | 实测结果 |
| --- | --- |
| 新 stdio 会话，管理员与受限 reader | 两个账号均读取两类参数组合、类型、默认值和 master/develop 动态候选；模型工具与 App-only 包装结果相同 |
| 已有七条目标构建 | 两个账号均通过项目 `getBuild`、`uiGetBuildStages` 读取七条结果与各七个阶段；核对 SUCCESS/UNSTABLE/FAILURE/ABORTED，未新增这些参数化任务的构建 |
| 队列历史与实时跟踪 | 旧 queue ID 精确匹配对应历史构建；真实两轮新增队列场景的 #5–8 SUCCESS、两个取消项没有构建；标签等待 #2–3 ABORTED 并清理 |
| 打包 UI + SG 实时只读预览 | 参数候选按钮、构建编号切换、无历史任务参数显示、失败/不稳定/中止阶段通过；队列 #135 自动从等待转为 #8 SUCCESS，取消卡片停止刷新 |
| 界面尺寸与日志 | 桌面及 390×844 深色卡片检查，七阶段完整可读，无横向溢出；修复卡片高度通知与异步任务/日志响应归属。队列过渡及阶段页面的错误/警告采集为空 |
| Mock 与安装包 | `pnpm test` 11/11 通过，包含敏感默认值遮蔽、候选错误与截断、403/404、过期队列和任务归属；生成包文件清单通过，`git diff --check` 通过 |

此轮追加六条轻量队列历史，结束时为 **70 个叶子任务、275 条构建、557 个产物**；队列与运行中构建均为零。原 250 条构建的 1,030 个元数据、日志和产物文件再次 SHA-256 核验零变化；默认配置文件 SHA-256 也保持不变。

复核：`node scripts/verify-jenkins-api-mode.mjs` 只读取 SG 的现有构建和参数；`node scripts/verify-jenkins-target-queue.mjs --run` 会在 SG 合成夹具生成队列历史，`--ui-wait` 把单次等待延长到 120 秒方便观察。私有报告保存于 `.local/jenkins-api-mode/` 与 `.local/jenkins-target-fixtures/`，不进入版本控制。

上述开发回归使用重新生成的 `release/jenkins/` 和新 stdio 进程；随后完成下述原生宿主验证。

## Codex 原生宿主验证

2026-10-13 安装 0.1.9，生成包与安装缓存 19 个文件逐字节一致。未重启 Codex；新会话连接加载了新版工具，重新打开 Jenkins 面板后可通过 MCP Apps 控制接口检查实际 DOM 和截图。默认实例继续为 SG 的 API 模式。

- 原生面板读取参数 Pipeline #9 和 #11，各七个阶段显示完成、跳过、不稳定和中止；分支候选按钮实际返回 develop/master，历史编号输入切换成功。
- 历史队列 #135 精确关联 #8；#136 显示过期，未猜测最近构建。
- SG 合成任务新增 queue #140 → #9 SUCCESS、#142 → #10 SUCCESS；原生卡片显示执行器等待原因与运行阶段。#143 在执行前取消，原卡片自动显示已取消，未生成构建。完成结果另行通过原生工具回读；同一等待卡片最终自动转为完成的视觉检查受控制接口超时影响。
- 原面板的任务列表请求与构建共用错误状态，导致构建及阶段已成功读取时仍显示笼统的 fetch failed。0.1.9 分离错误范围并提供列表重试；REST 连接诊断及安全重试规则见[连接配置](configuration.md#connection)。原始错误没有保留底层原因码，无法追溯具体断链原因。
- 部分已打开 App 标签的 DOM 或截图控制持续超时；重新调用入口工具后可检查新标签。此限制与读取工具的现场结果分别记录，未尝试重启或终止 Codex。

管理员与受限 reader 的安装包只读回归通过；`pnpm test` 17/17 通过，新增网络重试边界与错误脱敏测试，`git diff --check` 通过。现有历史保留，本轮仅新增两条合成队列构建；未触发内网构建。Token 曾因先前测试日志误输出而轮换，默认 URL 和 API 模式保持不变；不再沿用轮换前的配置文件整体哈希作为当前基线。私有证据位于 `.local/jenkins-native-host/`。

同日继续验证同一卡片自动更新：原生工具给队列 #147 返回排队数据，用户展开后记录标签 10 与固定 initId；保留该文档，不点刷新、不重开卡片。宿主控制命令一度在派发前超过期限；聚焦当前文档，并通过 `cua.getTab` 重新绑定既有标签、使用 `getAXState` / `getScreenshot` 观察后恢复响应。同一标签最终显示 #12 SUCCESS、两个阶段已完成，队列与构建号经原生读取工具复核匹配。最终截图已保存，补齐同一卡片从排队数据自动更新到完成状态的验收。排队时的实际工具结果保留，但当时的渲染截图和中间运行画面未能捕获；未把重新打开的静态成功卡片当作此次证据。

本轮另有 #145 → #11 SUCCESS 占位构建，两个合成任务均已结束，默认配置文件整体哈希保持不变，未触发内网构建。控制恢复经过聚焦与接口重新绑定两项操作，尚未独立证实哪个操作消除了超时，也未宣称永久修复 Codex。宿主 ResizeObserver 警告的来源未确认，未据此改动卡片尺寸或轮询逻辑。

随后追加同一卡片三态截图验收，最终场景为 `sg-native-card-gate`：同任务串行占位使 queue #157 实际进入 BlockedItem；占位 #1 的十分钟保护超时后，#157 精确关联 #2，运行约 121 秒并以 SUCCESS 完成。Luna 子代理独立读取排队、运行及完成事实。用户展开的标签 13 和固定 initId 全程保留，没有手动刷新、重开卡片或重启 Codex。MCP Apps 的 DOM 与截图命令仍在派发前超时，Codex 窗口的备用观察通道被工具明确禁止，因此 **三态原生截图验收未通过，尚未确认这一轮卡片全程自动更新**。API 结果与原生视觉验收分别记录，不用其他卡片或预览页面替代截图。此前尝试 #151 → `sg-target-queue-pipeline` #14 SUCCESS 仅获得运行截图；#155 → 同任务 #15 ABORTED 已结束。占位 #1 ABORTED 和最终 #2 SUCCESS 的历史均保留，私有证据位于 `.local/jenkins-native-host/three-state-157*.json`。

此后集中排查宿主控制，无新增卡片或构建。2026-10-13 的本机日志将 #157 的固定 initId 关联到其 App 会话：北京时间 17:52:27 记录 `tab_close`，显示模式由侧栏 `fullscreen` 转为对话内 `inline`；17:57:27 记录 `offscreen_timeout` 和 sandbox 释放。新控制连接中的 MCP Apps 标签列表为空，导航回当前对话后仍为空。这解释当前原控制目标缺失，但该会话在先前侧栏观察超时期间没有挂起记录，**此前派发前超时原因仍未确认**。已安装卡片未发现同步无限循环；可见性日志、请求入口可达及慢状态聚合均不足以证明根因。没有已暴露的恢复旧 App 文档接口，因此宿主恢复与三态截图继续列为未完成。脱敏诊断保存在 `.local/jenkins-native-host/host-control-diagnosis.json`，默认 SG 配置整体哈希未变。

用户随后确认当前右侧面板未展开；因此当前空标签列表属于预期状态，不作为宿主控制故障证据。需继续调查的是此前面板已展开期间的派发前超时，后续诊断不得将这两种状态混同。

定向日志检查找到此前 126 次内置浏览器路由不可用的异常，可能解释控制连接的 request-header policy 加载失败，但尚不能建立它与 MCP App 派发前超时的因果关系。通过正式 CUA API 创建一个隐藏 `about:blank` 诊断标签后，初始观察及只读文档查询均成功，后者耗时不足一秒；当时计划保留该诊断标签，但下一轮列表中已不存在。此结果只确认该次内置浏览器路由可用，当时尚未验证 Jenkins App 控制恢复；该次诊断没有新增 Jenkins 卡片、构建或重启 Codex。


### 0.1.10 单卡三态验收

同日新增自动展开能力后，仅创建一张 SG 卡片，queue **#161 → `sg-native-card-gate` #4 SUCCESS**。占位构建 #3 和待测构建 #4 使用显式 input 闸门，分别在排队截图和运行截图保存后放行；两次合成构建完成后恢复原任务配置，已有历史保留。执行期间未重启 Codex、切换默认 SG/API 配置或访问内网 Jenkins。

| 原生观察 | UTC 时间 | DOM / DOM+截图耗时 | 结果 |
| --- | --- | --- | --- |
| 稳定性检查 | 12:09:04 | 48 / 161 ms | 排队 #161 |
| 排队截图 | 12:10:11 | 55 / 172 ms | BlockedItem，等待 #3 |
| 运行截图 | 12:12:29 | 39 / 117 ms | 构建 #4，Pipeline 等待输入 |
| 完成截图 | 12:13:17 | 37 / 88 ms | SUCCESS，两个阶段已完成 |

四次记录的 `data-document-id` 完全一致；全程未点刷新、关闭或重新打开卡片，也未要求用户展开。卡片自动出现在右侧，宿主从首次创建就报告 fullscreen；界面记录 `already-fullscreen`，故本次真实宿主没有执行 `requestDisplayMode` 分支。该分支及拒绝、超时、缺失能力、通知顺序和显式关闭选项由单元测试验证，宿主是否接受 inline→fullscreen 请求仍取决于具体宿主。自动展开契约见 [UI 文档](ui.md#自动展开)。

定位确认两项独立问题：旧 UI 仅声明支持的显示模式，没有调用展开接口，现已补齐；安装新版本时 CLI 会删除旧缓存目录，尚未重连的 MCP 进程仍引用旧资源文件，可能出现资源 ENOENT。本次从构建产物部署兼容副本使旧连接可回读新 HTML，随后原生连接已切换到新资源 URI。兼容副本保留在旧版本缓存路径，正式 0.1.10 安装包的 19 个文件与生成包逐字节一致；这不是公开的 Codex 热重载 API。

此前的派发前控制超时根因仍未确认；本次观察持续快速响应，不能推断它已永久修复。IAB 路由告警、Jenkins REST 超时和 MCP Apps DOM/截图控制分别记录：本次放行前出现一次 SG 连接超时，直连与当前本地代理复查均返回 200，确认 input 仍待处理后重试成功，没有重新提交构建。

`pnpm test` 25/25 通过，`git diff --check` 通过。三张真实截图及同文档观测保存在被忽略的 `.local/jenkins-native-host/161-*.jpg`、`161-ui-observations.json` 和 `three-state-161.json`。此前 #147、#151、#157 的证据继续保留，未混用于本轮验收。

### 0.1.11 内联到全屏验收

2026-10-13 继续定位到两处配置缺口：卡片资源未声明初始 inline 偏好，UI 的 `App` 初始化也未声明显示模式能力。两者已修复，具体契约见 [自动展开](ui.md#自动展开)。请求状态额外保留发起时的模式；打包资源 hash 包含版本号，避免仅版本属性变化时沿用资源地址。Luna 子代理复审了声明及请求来源记录，`pnpm test` 25/25 和 `git diff --check` 通过。

通过 `codex plugin add` 安装 0.1.11，19 个包文件与生成产物逐字节一致。先备份并恢复被安装器清除的 0.1.10 缓存，保留既有连接的资源可读性。安装后直到 12:36 UTC，当前原生连接的 `resources/list` 与 `resources/read` 仍返回 0.1.10 的 `7a45bb13d330` 资源及缺少初始偏好的 metadata；新包资源为 `3b4878533346`。导航到当前已保留对话后也未观察到连接切换。公开 CLI 提供的独立 app-server 控制 socket 在本机不存在，当前桌面连接没有可调用的公开重载入口；未改用内部 IPC 或终止进程。

该安装轮次尚未验收真实 inline→fullscreen 请求，没有消耗允许新增的一张卡片，也没有新增构建。安装及旧连接回读摘要保存在 `.local/jenkins-native-host/inline-fullscreen-0.1.11.json`，作为当时的状态保留。

后续对话已回读到原生 0.1.11 资源和 inline 初始偏好。14:23 UTC 仅调用一次 `showJenkinsBuildCard`，使用既有 `sg-native-card-gate` #4 SUCCESS，并传 `autoExpand: true`。卡片自动出现在原生右侧标签 3，固定 initId 为 `7fe908db-deea-42ec-8d88-364fbc92cf36`。14:25:07 UTC 的只读 DOM 和截图确认 UI 版本 0.1.11、`initialDisplayMode=inline`、`autoExpandFrom=inline`、`autoExpandState=expanded`、`displayMode=fullscreen`，documentId 为 `5337ec94-433a-4518-a6ab-38dd86c860ba`。构建与两个阶段均显示成功；DOM 读取 30 ms，连同截图共 100 ms。

Luna 独立核对同一 initId 的宿主日志：14:23:55.178Z `session_created` 为 inline；.382Z `widget_running` 仍为 inline；.474Z 记录 `display_mode_changed`，前一模式 inline、当前 fullscreen、原因为 `display_mode_request`，同毫秒记录全屏 `session_opened`。从 session 创建到模式切换为 296 ms；后续发现标签和保存截图的时间不计为展开耗时。该 initId 未出现失败或派发超时事件。宿主未输出应用的 `jenkins-display-mode` 日志标记，验收依靠上述宿主事件和实际 DOM。脱敏原始行及出处保存在 `.local/jenkins-native-host/inline-fullscreen-v011-host.log`。

此证据补齐了真实宿主从内联发起全屏请求并成功展开的分支。MCP Apps 控制接口只列出已展开的卡片，因此初始内联状态由宿主日志和请求来源记录确认，没有声称取得内联瞬间截图。全程未点击卡片、刷新、关闭或重开卡片，未要求用户展开，未重启 Codex。仅新增这一张卡片、零次构建；默认 SG/API 配置文件 hash 未变，未访问内网 Jenkins。截图和 DOM 证据保存在 `.local/jenkins-native-host/inline-fullscreen-v011-expanded.jpg`、`inline-fullscreen-v011-observations.json`；此前三态截图继续作为独立验收保留。
