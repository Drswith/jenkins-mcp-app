# SG 云端联调

云端当前保留 Jenkins 2.263.1 与 Gitea 28.1.0。源 Jenkins 已停机并提交延迟删除；最近回读为 suspended、无 domains，GraphQL 的 `scheduledDeleteAt` 是 `2026-10-13T04:15:18.926Z`（北京时间 12:15:18），服务列表仍显示待删除条目。迁移与补跑的权威核验数据及 Pipeline 图数据边界见 [兼容测试最终快照](legacy-test.md#迁移与补跑后的最终快照)。

原 2.580.1 环境用于功能演示，不能代替 2.263.1 兼容性验证；目标差异背景见 [内网目标基线](target-compatibility.md)。以下 2.580.1 的服务配置、部署方式和现场结果均是历史记录。旧版双服务模板只保留作历史参考；不要在现有项目再次部署，以免创建重复服务。

- 历史源 Jenkins：2.580.1 / JDK 21，使用 [插件清单](../test/local-jenkins/plugins.txt) 与挂载启动文件；服务删除请求已接受，当前仍有待删除条目。历史 Multibranch、Webhook 与每日历史配置见[专题记录](multibranch-history.md)。
- Gitea 28.1.0 rootless，内置 SQLite、网页、账号权限和 HTTP Git。数据及配置分别使用持久卷，不需要独立数据库。关闭公开注册、SSH 和 Actions runner；可登录后管理自己的仓库。

下方是旧双服务模板的配置说明：当时两个镜像均固定版本和多架构摘要，Zeabur 初始化容器以 root 修复 UID/GID 1000，再由主服务切换到 `jenkins`、`git` 用户。此段描述的是旧 Jenkins 2.580.1 与 Gitea 测试栈，不代表当前保留实例的完整配置；当前目标实例配置见 [2.263.1 兼容测试](legacy-test.md)。

`scripts/jenkins-zeabur-template.mjs` 是部署模板的源文件，它读取本地共用的启动文件和 `test/zeabur/gitea-seed.sh`，输出被 Git 忽略的 `.local/jenkins-test/zeabur-template.json`。不要单独编辑生成文件。此模板用于私人测试，不会发布到模板市场。

## 部署与初始化

以下命令仅记录旧版 Jenkins 2.580.1 + Gitea 双服务测试栈的创建方式。它会创建旧拓扑，不适用于当前迁移中的项目；不要执行以免重复部署。首次搭建隔离的历史测试栈时：

```sh
node scripts/jenkins-zeabur-template.mjs
npx zeabur@latest template deploy -i=false --json \
  -f .local/jenkins-test/zeabur-template.json \
  --project-id <project-id> \
  --var PUBLIC_DOMAIN=<jenkins-domain-prefix> \
  --var GITEA_DOMAIN=<gitea-domain-prefix>
```

Gitea 启动后执行一次挂载的初始化脚本。它生成随机管理员密码，保存到 Gitea 数据卷内的 `local-test-credentials.json`，并创建仅包含测试 README 的公开 `codex-test/sample` 仓库。Jenkins 的 SCM 任务通过项目内网 HTTP 检出此仓库。

```sh
npx zeabur@latest service exec -i=false --id <gitea-service-id> \
  --env-id <environment-id> -- su git -s /bin/sh -c 'exec sh /opt/gitea-bootstrap/seed.sh'
```

账户名均为 `codex-test`，密码分别生成。使用以下脚本将数据卷内凭据提取到被忽略的 `.local/jenkins-test/zeabur/`，权限为 `0600`；它只输出文件路径。不要把凭据、原始日志或本机配置加入版本控制。`jenkins-access.json` 和 `gitea-access.json` 含网页密码，`config.json` 只保留 Jenkins 连接配置，不包含网页密码。

```sh
node scripts/jenkins-zeabur-access.mjs <jenkins-service-id> <gitea-service-id> <environment-id>
```

## 验证

```sh
pnpm test
JENKINS_CONFIG_FILE="$PWD/.local/jenkins-test/zeabur/config.json" \
JENKINS_TEST_SCM_URL=<jenkins-job-internal-scm-url> \
JENKINS_TEST_GITEA_SERVICE_ID=<gitea-service-id> \
JENKINS_TEST_ENVIRONMENT_ID=<environment-id> \
pnpm test:local:scm
```

远端 SCM 模式通过 Zeabur service exec 在 Gitea 中追加一条测试提交，触发 Jenkins 构建并验证仓库地址、提交及变更集。普通 `pnpm test` 使用模拟服务，不能代替上述真实服务联调或 Codex 桌面宿主验证。

本地 UI 预览可直接连接远端 Jenkins，无需启动本地 Docker：

```sh
JENKINS_CONFIG_FILE="$PWD/.local/jenkins-test/zeabur/config.json" \
JENKINS_UI_PREVIEW_LIVE=1 pnpm ui:preview
```

## 部署标识

2026-10-12 创建的历史测试资源（Jenkins 源服务已停机并提交延迟删除）：

| 资源 | 标识 |
| --- | --- |
| 项目 | `jenkins-mcp-test` / `6acce79dfaa6e043a4b6f5ba` |
| SG 服务器 | `6ac4694176befe187a6069ee` |
| 环境 | `6acce79d5a13ed952d7efe6b` |
| Jenkins 服务 | `6acce8de4873e494859dc96d` |
| Gitea 服务 | `6acce8de4873e494859dc96e` |

历史资源 ID 用于识别迁移来源。当前运行服务为 `jenkins-legacy`（`6acd85ec4873e494859dfe5b`）与 Gitea（`6acce8de4873e494859dc96e`）。源 Jenkins `6acce8de4873e494859dc96d` 的删除请求已接受；最近回读为 suspended、domains 为空，GraphQL 的 `scheduledDeleteAt` 为 `2026-10-13T04:15:18.926Z`，但服务列表仍有待删条目。不要将它写成已完全删除，也不要推断 PVC 已回收。旧 Jenkins URL 已绑定并 provision 到 legacy 服务，legacy URL alias 保留。

2026-10-12 历史实测：两个服务的网页登录通过；真实 stdio MCP 联调通过 MCP、API、三份 UI 资源、普通构建，以及 Gitea 检出、提交、变更集验证（SCM 构建 #2 成功）。当时重启两项服务后，Jenkins 插件安装标记未变化，账户与构建记录保留，Gitea 账户及最新提交保留。新启动的已安装插件进程在 MCP 模式下通过 `getStatus` 和 `whoAmI`，账户为 `codex-test`。这些旧模式结果不代替当前 2.263.1 API 服务核验。已有会话的重连要求见 [连接配置](configuration.md)。

当次平台内存采样：Jenkins 平均约 538 MB、峰值约 705 MB，Gitea 平均约 103 MB；这是测试期间的样本，不代表长期资源上限。

更多任务、构建历史和 Gitea 协作数据的生成方式见 [SG 演示数据](demo-data.md)。
