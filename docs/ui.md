# MCP Apps 界面

插件的界面由 `ui/src/` 构建，`pnpm build` 将工作台、对话侧边栏和内联卡片分别写入 `release/jenkins/dist/ui/`。每个 HTML 包含构建好的 JavaScript、CSS 和 Jenkins 官方头像资源；安装时不需要源码、pnpm 或前端依赖。内容哈希进入资源 URI，避免宿主复用旧界面。

## 入口和数据

| 工具 | 展示位置 | 数据 |
| --- | --- | --- |
| `openJenkinsWorkspace` | 全局侧栏入口、全屏工作台 | 在界面中读取任务；搜索、筛选、查看构建和日志。 |
| `openJenkinsPanel` | 对话侧边栏入口 | 可指定任务和构建号；也可在界面中选择任务。 |
| `showJenkinsBuildCard` | 对话内状态／证据卡 | 读取指定构建，运行期间刷新；失败时按需读取日志片段。 |
| `showJenkinsQueueCard` | 对话内操作追踪卡 | `triggerBuild` 返回队列 ID 后使用；追踪队列、执行中的构建和结果。 |
| `showJenkinsJobChoices` | 对话内选择卡 | 从可见顶层任务中呈现最多五项；可筛选失败或运行中的任务。 |
| `showJenkinsBuildComparison` | 对话内对比卡 | 比较同一任务的两个构建结果与耗时，并可让 Codex 继续分析。 |

这些工具通过 `_meta.ui.resourceUri` 关联 `text/html;profile=mcp-app` 资源；前两个还声明 OpenAI 扩展入口。界面使用 MCP Apps 宿主桥接调用 `uiListJobs`、`uiGetJob`、`uiGetBuild`、`uiGetBuildLog`、`uiGetQueueItem`、`uiTrackQueue`、`uiGetBuildStages`、`uiGetJobParameters` 和 `uiGetGitParameterChoices`。这些数据工具仅供 App 调用，经 Jenkins REST 提供统一的数据结构，**包括配置为 MCP 模式时**。参数工具的唯一契约见[连接配置](configuration.md#parameter-reads)。阶段工具在控制器安装 [Pipeline REST API](https://plugins.jenkins.io/pipeline-rest-api/) 时读取 `/wfapi/describe`；403 明确显示无权限，404 显示没有可用阶段，其他请求失败显示读取失败。界面不会获得 Jenkins API 令牌，也不会直接请求控制器。

工作台和侧边栏可查看任务默认参数、Choice 选项、Boolean 默认值及按需读取的 Git 候选；参数面板保持只读，不能提交构建。没有历史的任务仍可查看参数。构建编号输入会读取指定历史记录；阶段信息同时覆盖运行中和已结束构建。不稳定、中止、失败和未构建分别显示，`NOT_EXECUTED` 在运行中表示待执行、结束后表示跳过，`PAUSED_PENDING_INPUT` 表示等待审批输入。

全局侧栏入口在 `tools/list` 中以 `Jenkins` 为标题，并提供浅色、深色主题的 Jenkins 官方构建锤子单色 SVG；对话侧边栏入口标题为 `Jenkins 构建`。插件清单中的 `logo` 和 `logoDark` 使用正方形彩色 Jenkins 头像，供插件市场展示；`composerIcon` 和 `composerIconDark` 使用小尺寸单色构建图标。入口工具仍单独声明 `title` 和 `icons`。

工作台与侧边栏目前只读。用户主动点击“询问 ChatGPT”时，界面通过宿主桥接发送一条包含任务和构建号的提问；“打开 Jenkins”交由宿主打开构建 URL。内联卡片可选择任务、展开真实日志证据、刷新状态或发送针对构建的分析请求。卡片本身不会触发构建；模型只有在用户明确要求后才使用 `triggerBuild`，再以返回的队列 ID 打开追踪卡。卡片显示 Jenkins 事实，Codex 的分析在实际读取证据后由对话给出。

追踪卡仅在界面挂载且可见时每六秒查询一次；关闭卡片后没有后台任务或通知。`uiTrackQueue` 与 `showJenkinsQueueCard` 共用关联校验，先确认任务归属，再转为 `executable.number`，后续固定到该构建。队列 404 时只在指定任务最近 50 条构建中查找相同 `queueId`，可匹配较旧构建；没有匹配则明确显示过期并停止跟踪，不猜测最新构建。取消的队列不会转为构建，取消和过期都会停止轮询。卡片切换时旧异步响应不会覆盖新卡片。

排队卡只让当前“排队中”横条闪烁；运行中图标旋转。Pipeline 阶段同时列出完整名称及状态，避免多个阶段的横排文字被挤成省略号；卡片高度随内容报告给宿主。通用 Jenkins API 不提供可靠的完成百分比，阶段横条只表达各阶段状态。系统开启减少动态效果时，图标、横条和阶段动画保持静态。任务选择卡当前只涵盖顶层任务；更深的文件夹定位继续通过对话中的 `getJob` 完成。

界面从 MCP Apps 宿主上下文读取浅色或深色主题，并响应运行时主题切换；宿主未提供主题时采用系统外观。`pnpm ui:preview` 的主题选择器会把同样的上下文发送给打包后的界面，供本地验证。

## 当前运行边界

本仓库安装的是本地 stdio 插件。MCP Apps 兼容宿主可读取界面资源，但 Codex 是否呈现 iframe 由宿主决定。ChatGPT 私有测试可走 [Secure MCP Tunnel](https://developers.openai.com/plugins/deploy/connect-chatgpt) 连接本地 stdio 服务；公开目录提交则需要稳定的 HTTPS `/mcp` 服务、用户认证、独立界面域名和宿主内验证。本仓库当前没有公开服务或部署配置。不要将仅凭 Jenkins 凭据访问的本地桥接直接放到公开隧道后面。

`pnpm test` 用本地 Jenkins 模拟服务检查安装包、MCP 资源、工具元数据和卡片数据。运行 `pnpm build && pnpm ui:preview` 可在本地模拟宿主中操作**安装包内的实际界面构建产物**；`?mode=card&scenario=queue|running|running-no-stages|success|failed|choices|comparison` 可逐一查看内联状态。默认预览使用模拟数据。显式设置 `JENKINS_UI_PREVIEW_LIVE=1` 和专用 `JENKINS_CONFIG_FILE` 后，宿主通过新 stdio 会话读取对应 Jenkins；预览白名单只允许读取工具，不允许 `triggerBuild`。`?mode=panel&job=<完整任务名>&build=<编号>` 和 `?mode=card&job=<完整任务名>&queue=<队列ID>` 可指定真实案例。预览读取当前 UI manifest，重新构建后不会引用已删除的旧 HTML 文件。SG 的 API/浏览器验证见[目标兼容性验收](target-compatibility.md)；这些检查不代替 Codex 或 ChatGPT 原生宿主中的安装验证。视觉方案和独立设计原型保留在 [原型目录](../prototype/README.md)。

协议依据：[OpenAI MCP Apps UI](https://developers.openai.com/plugins/build/chatgpt-ui)、[插件扩展入口](https://developers.openai.com/plugins/build/extensions)、[插件参考](https://developers.openai.com/plugins/reference)。
