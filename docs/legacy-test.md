# SG Jenkins 2.263.1 兼容测试

2026-10-13 在既有 `jenkins-mcp-test` 项目中新增独立 `jenkins-legacy` 服务，复用公开合成 Gitea 仓库。迁移后的稳定拓扑为 Jenkins 2.263.1 + Gitea：旧 Jenkins URL 已绑定并 provision 到新服务，Codex 默认配置与本机 profile 均使用 `api` 模式，legacy URL alias 继续保留。当前迁移、补跑和核验结果以本页的[最终快照](#迁移与补跑后的最终快照)为准。

旧 Jenkins 服务已停机并提交延迟删除：最近回读的状态为 `SUSPENDED`、domains 为空，GraphQL 报告的 `scheduledDeleteAt` 为 `2026-10-13T04:15:18.926Z`（北京时间 12:15:18）；服务列表仍有待删除条目。服务尚不能描述为完全移除，数据卷也未确认释放。保留运行的服务是 `jenkins-legacy` 与 Gitea。目标完整插件/JVM/工具版本尚未取得，因此它复现的是已知 core 与功能场景，不是生产环境的精确副本。

| 资源 | 当前配置 |
| --- | --- |
| 服务 | `jenkins-legacy` / `6acd85ec4873e494859dfe5b` |
| 项目 / 环境 | `6acce79dfaa6e043a4b6f5ba` / `6acce79d5a13ed952d7efe6b` |
| SG 服务器 | `6ac4694176befe187a6069ee` |
| URL | https://jenkins-legacy-drs-sg.zeabur.app/ |
| 镜像 | 官方 `jenkins/jenkins:2.263.1-jdk11`，amd64 digest `sha256:bde1c86c0e6bac9477b2220cb0d5c33d3a80daa37e995397cd17795525d19a00` |
| Java / 运行用户 | 镜像内 JDK 11.0.9；应用 UID 1000 |
| 资源 | 1 个执行器，JVM 堆 128–512 MiB；堆限制不等于容器总内存限制 |
| 数据卷 | 独立 `legacy-jenkins-home`，挂载 `/var/jenkins_home` |
| 接入模式 | 显式 `api`，不安装 Jenkins MCP Server；默认配置和 legacy profile 已切换到 API 模式 |

## 迁移与补跑快照

数据迁移时，源与目标间 1,507 个不可变文件逐个 SHA-256 匹配。迁移基线为 227 条构建、494 个产物。API 将 63 项 `getAllItems` 结果作为迁移时的项目计数；对 227 条构建元数据逐条比较，比较内容包含各构建的 artifact 列表，结果为零差异。216 条旧构建日志可读取，146 项旧 JUnit 统计匹配。原有 Pipeline 历史、日志和产物保留。

随后补跑新增 23 条构建，当次回读为 **65 个构建任务、250 条构建、530 个产物**。其中普通 demo Pipeline 补跑 17 条；每条的 `wfapi` 阶段数据非空，阶段结果符合预期。还验证了 master push 构建 `#3` SUCCESS、新分支 `legacy-migration #1` SUCCESS、关闭后保留的 PR-3 新构建 SUCCESS、每日构建 `#3` SUCCESS，以及下游构建与 `legacy-demo-declarative #8` 的 API 队列验证。Multibranch 根索引 SUCCESS。队列与运行中构建均为零。

56 个锁定插件的版本均匹配且 active；没有安装 `mcp-server`。迁入的 3 个凭据保存在 Jenkins 加密凭据库，明文 bootstrap 文件已删除。新 stdio 会话通过默认 API profile 读取 `demo-pipeline-release #5` SUCCESS，返回的 URL 已规范到旧 Jenkins URL alias。每日 timer 按 Asia/Shanghai 每天 03:14 运行并禁止并发；下一次运行时间随日期变化，不固定记录。Gitea hook 保持 active，支持 push、pull_request 和全部 PR 子事件。

随后按内网普通账号可见的参数组合和阶段结构新增目标夹具及权限插件，现有历史保持。最新数据规模、任务、权限、队列与历史校验统一见[目标兼容性验收](target-compatibility.md#sg-补齐后的实测验收)，以上 250/530 为新增目标夹具前的迁移快照。

旧 Pipeline completed graph 与 Jenkins 2.263.1 的图数据格式不同。按用户决定不转换旧图；历史构建、日志和产物仍保留，由重放构建补充阶段图验证。使用 [`scripts/replay-jenkins-pipeline-demo.mjs`](../scripts/replay-jenkins-pipeline-demo.mjs) 的 `--plan` 预览或 `--run` 执行普通 demo Pipeline；`--run` 会触发构建。完整 raw backup 保存在本机私有目录，不进入版本控制。

## 插件和启动

[锁定清单](../test/legacy-jenkins/plugins.txt) 是带 core、SHA-256、来源信息的历史锁文件，不是直接交给最新版 plugin CLI 的安装文件。包含 56 个插件及所有必需依赖，按 2021-03-31 截止的官方历史元数据选择；包括兼容 Jenkins 2.263.1 的 Gitea Branch Source 1.2.1。各 HPI 的 SHA、Manifest core 要求与依赖最低版本均已核对。

主要功能插件是 Declarative `pipeline-model-definition:1.8.4`、Git Parameter `git-parameter:0.9.13`、Git `4.7.0`、JUnit `1.49`、Workflow Job `2.40` 与 Credentials Binding `1.24`。版本来源是 [Jenkins 官方插件历史索引](https://updates.jenkins.io/current/plugin-versions.json)；当前索引已移除的 ace-editor 使用官方归档 HPI 核验，日期记为 unknown。

[下载 TSV](../test/legacy-jenkins/plugins-downloads.tsv) 提供固定 URL 和 SHA。[启动脚本](../test/legacy-jenkins/start.sh) 在数据卷缓存中逐个校验、补齐缺失文件，然后启动官方 `jenkins.sh`；插件锁摘要标记使后续启动跳过安装。扩展后的 56 项锁定插件现已全部 active。迁移导入的 3 个 credential ID 均保存在 Jenkins 加密凭据库中，明文 bootstrap 文件已删除。

Zeabur 的启动 UID 配置也作用于卷初始化容器，因此用 root 完成卷 chown，再切换到 Jenkins 用户启动。入口保留该固定镜像的 `/sbin/tini` 和官方 `jenkins.sh`，用户切换命令按实际 PATH 查找，不沿用新版镜像中的绝对路径。

## 实测场景

| 任务 | 验证内容 |
| --- | --- |
| `legacy-demo-declarative` | Declarative stages、when、Choice 的 dev/staging/prod-demo 与 success/unstable/failure、Boolean、中文/引号/XML 字符/换行 String、JUnit 与归档 |
| `legacy-demo-git-parameter` | Freestyle 的 PT_BRANCH 动态候选、实际 master/develop 检出与 SHA |
| `legacy-demo-git-parameter-pipeline` | PT_BRANCH 选择分支，再通过 CpsScmFlowDefinition 加载该分支的 Declarative Jenkinsfile |

公开 `[DEMO]` 仓库 `demo-legacy-ci` 两个分支有不同 SHA 和分支标记，不改动原有演示仓库。浏览器实际显示 develop/master 两个动态候选，默认 master。四次分支构建的日志与 Gitea head SHA 均吻合。

迁移前，真实 stdio MCP 客户端使用项目生成包的 API 模式执行了 getJobs/getJob/triggerBuild/getQueueItem/getBuild/getBuildLog，完成队列 ID 到实际构建编号的跟踪。legacy 初始留存 **3 个任务、11 条构建、11 个产物**：9 SUCCESS、1 UNSTABLE、1 FAILURE。预期失败/不稳定由合成夹具产生，恢复构建已成功。Declarative 的 9 条记录均有阶段重启动作，其中 7 条属于参数场景任务、2 条属于 Git Parameter Pipeline；未执行阶段重启操作。迁移后回读和补跑结果见上方[最终快照](#迁移与补跑后的最终快照)。

URL 验证分两种：

- 在真实新控制器上暂时设置其他 origin 的 canonical URL；原始 API 返回该 URL，而项目返回的任务/构建链接已规范到配置入口，仍能执行和读取构建。测试结束后恢复正确公网 URL。
- 使用仅监听本机回环地址的受控转发器，把真实 Jenkins 的响应链接和队列 Location 重写为其他 origin，并加 `/jenkins/` 前缀。真实队列 `19` 成功跟踪到 Declarative `#7`；项目没有向那个示例域名发送请求。转发器测试后关闭，不常驻、不使用本地 Docker。

第一次受控转发器把无 body 的 HTTP 201 误当 JSON，导致响应丢失；目标实际已排队并完成 `#6`。已回读确认并保留该记录，修复测试转发器后另建一次验证。此错误属于测试转发器，不是 Jenkins 进程崩溃。

API 的链接规范化和严格队列 Location 契约见 [配置说明](configuration.md)。这里只验证了已知 Choice/Git Parameter 标量值的提交，尚未增加项目工具的动态参数候选查询。未验证内网目标的 API token、构建权限、CI/CD 执行或 Codex 原生 Apps 面板交互。

源服务迁移前的完整总量及 demo-only 历史统计见 [演示数据](demo-data.md)；旧服务当前删除状态与旧 URL 绑定方式见本页开头。迁移和补跑后的权威 API 快照统一见上方章节。

## 崩溃通知与模板对照

QQ 邮箱中 2026-10-13 北京时间 09:18:18/19 的两封部署崩溃通知指向新 `jenkins-legacy`。首次部署日志有明确的 `exec /usr/sbin/runuser failed: No such file or directory`：把新版镜像中的路径沿用到旧镜像是此次启动错误。已修正为 PATH 查找与 su 后备，应用实际 UID 回读为 1000。

2026-10-12 22:08:08 的较早通知指向 Gitea。保留的日志明确报 `Gitea is not supposed to be run as root`；已由此前的 git 用户启动修复解决。这两个具体故障属于不同服务的启动封装，不应合并为 Jenkins JVM 反复崩溃。

首次下载插件和 JVM 初始化期间会出现 `/login` startup probe 失败。修正启动命令后，日志记录 Jenkins fully up and running，公网/API、参数页面和连续真实构建均通过。最新容器 cgroup OOM/oom_kill 为零；这个观察不代表长期运行稳定性已证明。

当前 Zeabur 目录检索到的 [JFVSRE Jenkins 模板](https://zeabur.com/templates/JFVSRE) 由 `ridemountainpig` 发布，部署计数 52；是社区模板。对比其 CLI 导出的原始 YAML：

| 配置 | 社区模板 JFVSRE | 本兼容实例 |
| --- | --- | --- |
| 镜像 | `jenkins/jenkins`，未锁定 tag/digest | 固定 2.263.1-jdk11 与 digest |
| 服务类型 | PREBUILT | PREBUILT_V2 |
| 启动 | 未覆盖 command | 固定镜像的 Tini/jenkins.sh，加 UID 切换和缓存插件准备 |
| 账户/插件 | 用户完成官方安装向导 | 挂载 Groovy 创建随机私有凭据，锁定旧版插件闭包 |
| 卷 | `/var/jenkins_home` | 独立 home 卷，加 UID 1000 权限初始化 |
| 健康/资源 | 未显式配置 | `/login` 检查、单执行器、512 MiB 堆 |

[Jenkins 官方 Docker 文档](https://github.com/jenkinsci/docker)提供官方镜像、启动方式与 UID 1000 卷权限约定。社区模板是通用 Jenkins 起点，无法直接满足目标旧版与参数功能对齐。当前 [Zeabur PREBUILT schema](https://schema.zeabur.app/prebuilt.json) 提供 healthCheck，未暴露 startupProbe 参数；不能在模板里随意添加该字段。

## 复用

```sh
# 准备并校验全部固定 HPI；不用启动本地 Docker。
node scripts/prepare-legacy-jenkins-plugins.mjs

# 只生成模板；已有服务应按保存的 service ID 更新，勿再次部署创建副本。
node scripts/jenkins-legacy-zeabur-template.mjs

# 导出已有新服务的私有凭据，不覆盖默认 MCP 配置。
node scripts/jenkins-legacy-zeabur-access.mjs <legacy-service-id> <environment-id>

# 合成仓库与任务；运行前检查标记、版本和插件。
node scripts/seed-jenkins-legacy-repo.mjs --run
node scripts/seed-jenkins-legacy-demo.mjs --run
node scripts/seed-jenkins-legacy-demo.mjs --verify

# 追加真实 API 构建与 URL/队列场景。
node scripts/legacy-jenkins-smoke.mjs --run
```

默认连接配置 `~/.config/jenkins-codex-plugin/config.json` 与本机旧 profile `.local/jenkins-test/zeabur/config.json` 均已更新为新 token、`api` mode 和旧 Jenkins URL alias；该 alias 已绑定到 legacy 服务。独立 `.local/jenkins-legacy/config.json` 仍保留 legacy URL alias。配置内容及 token 不进入版本控制。新旧测试和迁移只使用合成仓库与演示任务，没有生产部署步骤。
