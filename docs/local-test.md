# 本地 Jenkins 联调

这个测试环境只绑定本机 `127.0.0.1:8080`。Compose 直接运行固定版本及摘要的官方 `jenkins/jenkins:2.580.1-jdk21` 镜像，不构建自定义 Jenkins 镜像。`plugins.txt`、`start.sh` 和 `init.groovy` 以只读文件挂载：启动脚本使用官方 `jenkins-plugin-cli` 将 [插件清单](../test/local-jenkins/plugins.txt) 中的固定版本插件及依赖安装到持久数据卷，然后调用官方 `jenkins.sh`。插件清单和 Jenkins 版本未变化且插件文件存在时，重启不会重复安装；初始化脚本在每次启动时复制到数据卷，测试账户只创建一次。

首次启动会创建 `codex-smoke` 示例任务；它只输出一行测试文本。Jenkins 和这个任务不依赖 Git 服务。云端联调使用 [SG 上的 Jenkins 与 Gitea](zeabur-test.md)，可以停止本地容器来节约资源。

```sh
docker compose -f test/local-jenkins/compose.yaml up -d
```

等待 `http://127.0.0.1:8080/login` 返回响应后，提取首次启动时生成的测试凭据。下面的文件位于被 Git 忽略的 `.local/`，请勿提交或分享；Jenkins 的测试账户密码在 `access.json` 的 `testPassword` 字段中。

```sh
mkdir -p .local/jenkins-test
docker cp jenkins-codex-local-test:/var/jenkins_home/local-test-credentials.json .local/jenkins-test/access.json
chmod 600 .local/jenkins-test/access.json
node -e 'const fs=require("fs");const p=".local/jenkins-test/";const {testPassword,...config}=JSON.parse(fs.readFileSync(p+"access.json"));fs.writeFileSync(p+"config.json",JSON.stringify(config),{mode:0o600});'
```

构建包后运行真实服务冒烟测试。脚本通过打包后的 stdio MCP 服务器验证 Jenkins MCP 工具、三个 UI 资源、API 工具和 UI 数据工具，并触发一次 `codex-smoke` 构建。

```sh
pnpm test
JENKINS_CONFIG_FILE="$PWD/.local/jenkins-test/config.json" pnpm test:local
```

## 可选的 SCM 联调

要验证 `getJobScm`、`getBuildScm`、`getBuildChangeSets` 和 `findJobsWithScmUrl`，启动 Compose 内网的只读 Git daemon。它包含一个微型仓库，不向宿主机开放 Git 端口；测试脚本在容器内部增加一条提交，再触发 `codex-scm-smoke` 构建并核对变更集。

```sh
docker compose --profile scm --profile preview -f test/local-jenkins/compose.yaml up -d --build
JENKINS_CONFIG_FILE="$PWD/.local/jenkins-test/config.json" pnpm test:local:scm
```

不启动 Git daemon 时，Jenkins 仍可启动和使用，`codex-smoke` 仍可构建；只有 `codex-scm-smoke` 的检出需要这个仓库。Git 插件提供 Jenkins 的 SCM 能力，Git daemon 只是本地测试数据源，不需要完整的 Git 托管平台。

用 Docker 启动持久运行的本地预览，再查看真实 Jenkins 数据：

```sh
docker compose --profile preview -f test/local-jenkins/compose.yaml up -d --build preview
```

打开 `http://127.0.0.1:4175/`，在页面顶部切换工作台、侧边栏和内联卡片。这个预览模拟 MCP Apps 宿主消息，但数据由本地 Jenkins 经打包后的 MCP 服务器提供；它不能代替 ChatGPT 宿主兼容性检查。预览服务只映射到主机的 `127.0.0.1`，测试凭据通过只读文件挂载留在容器中，不发送给浏览器。重建插件 UI 后，重新运行上面的 Compose 命令更新预览镜像。

停止测试实例：

```sh
docker compose --profile scm --profile preview -f test/local-jenkins/compose.yaml stop
```

再次启动用 `docker compose --profile scm --profile preview -f test/local-jenkins/compose.yaml start`；数据卷会保留任务与测试账户。仅删除容器不会删除 Jenkins 数据卷；显式删除数据卷后，原测试凭据才会失效，需要重新提取和配置。
