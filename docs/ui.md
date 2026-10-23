# MCP Apps 界面

插件是对话里的 Jenkins 证据与动作层，界面围绕一次构建。任务浏览、目录、配置和节点管理使用“在 Jenkins 打开”。`ui/src/` 是界面源码；`pnpm build` 生成 `release/jenkins/dist/ui/` 中两份带内容哈希的 HTML（card、workspace）。安装不需要前端依赖。

## 入口与交互

| 工具 | 内容与行为 |
| --- | --- |
| `showJenkinsTriggerConfirmation` | 全部已声明参数、默认值差异、卡内编辑；仅“确认运行”和“取消”。确认通过 `ui/message` 把最终参数交回对话，界面不调用 `triggerBuild`。敏感或不支持的参数阻止卡内提交。 |
| `showJenkinsBuildCard` | 指定构建结果、阶段和失败日志片段；“查看证据”请求 fullscreen，“在 Jenkins 打开”打开构建。运行时显示刷新与深链。 |
| `showJenkinsQueueCard` | 按队列 ID 校验任务并追踪到构建；默认 `autoExpand:false`。 |
| `showJenkinsJobChoices` | 最多五个候选，以单选字段选择并通过一个主按钮交回对话。 |
| `showJenkinsBuildComparison` | 同一任务两次构建的结果、耗时；可交回对话进一步比较。 |
| `openJenkinsWorkspace` | 全局入口打开“关注”，仅列出设置中最多八个完整任务名的最新结果；打开时读取一次。 |
| `checkJenkinsConnection` | 设置页工具按钮；宿主支持时在原生设置上方显示检测结果。只做读取，不探测写端点。 |

已删除 `openJenkinsPanel` 和 thread 入口。插件不拉取、重建或推断聊天历史。全局入口接受 `{}`；其外观和实际打开方式由宿主控制。

关注页每项一个操作：失败/不稳定时在新对话排查，其余在 Jenkins 打开。仅当宿主声明 `openai/message` 且平台是 desktop/web 时请求 `target:"new"`；移动端或缺少能力时使用当前对话。消息拒绝或超时时不自动重发，显示可复制的请求文本。

## 内联与全屏

所有模型调用的卡片初始模式为 inline。资源声明 inline/fullscreen 和 `preferredDisplayMode:"inline"`，不使用 PiP 或 `window.openai.requestModal`。卡片最多一个主操作、一个次操作，没有标签页、深层导航或内部滚动；插件内容不绘制外层背景、边框和圆角，保留 `prefersBorder:true` 交由宿主绘制。卡内不放插件标识；按钮中的 Jenkins 深链名称仍明确保留。模型回复不复述卡片。

`autoExpand:true` 是显式兼容选项，握手后最多请求一次；默认关闭。请求先检查 `availableDisplayModes`，拒绝、超时或不支持时保留内联内容。手动“查看证据”同样检测全屏支持，成功后才进入证据视图；不支持时提示通过 Jenkins 深链查看。

全屏证据在同一文档展示阶段节点与连接线、带原始行号的日志片段、相对此前成功构建的变更。Pipeline REST API 只提供有序阶段列表，因此连接线表达接口顺序，**不声称还原并行 DAG**。403、404 与请求失败分别处理。变更汇总只覆盖最近 50 条构建记录内的成功基线至目标构建，去重已有提交；未找到基线时明确不可比较。没有变更记录不等于没有代码变化。

日志最多读取前 64 KiB，再按设置截取 1–10 行，保留空行计数与真实行号；单行显示上限 1000 字符并标注截短。只有宿主同时声明 `updateModelContext.text` 和 `openai/modelContext` 时才提供可移除附件按钮。选中行用 info 色淡底标记，通过 `ui/update-model-context` 携带 `openai/title` 加入输入框；接收宿主清空通知后取消选中。不支持时仍可复制带行号文本。

## 数据与安全

模型可见的 `structuredContent` 只保留任务、构建结果、队列事实或待确认参数。展示模式、参数定义和其他界面数据放在结果 `_meta.card`。两者及文本均经过同一桥接脱敏边界；只供 App 使用的数据工具保留现有结构。配置、字段精简、参数与工具契约见[配置文档](configuration.md)。

界面通过 `uiGetBuild`、`uiTrackQueue`、`uiGetBuildStages`、`uiGetBuildEvidence` 和 `uiGetWatchedJobs` 等工具读取数据，不持有凭据或直接访问控制器。队列 404 只从该任务最近 50 条构建中匹配 queueId，不猜“最新构建”。取消、过期和完成停止轮询；打开且可见的活动卡每六秒读取一次，旧响应不得覆盖新任务。

## 样式与可访问性

使用 SDK `applyHostStyleVariables` 接入宿主颜色、字体和圆角，监听宿主主题变化。未提供变量时使用本次设计指定的浅/深回退值。主按钮使用 Jenkins 的 oklch 强调色，次按钮用宿主三级面。状态几何来自 Jenkins 官方符号，语义颜色取 success/danger/warning/info/secondary。增加对比度时底色透明度为 0、色环为 1；减少动态效果时关闭动画。

运行进度只在构建数据返回前次耗时时估算，最多绘制到 99%，不显示精确百分比。没有前次耗时时不绘制进度弧。图形有可访问名称，字段有标签，焦点可见，文本和布局允许换行。

## 验证

`pnpm test` 构建实际安装包后使用模拟 Jenkins HTTP/MCP 服务器测试。`pnpm ui:preview` 提供打包产物的模拟宿主：`?mode=card&scenario=confirmation|queue|running|running-no-stages|success|failed|choices|comparison`；`?mode=workspace` 是关注页。显式启用 `JENKINS_UI_PREVIEW_LIVE=1` 和专用配置文件才读取真实 Jenkins，预览白名单不允许触发构建。

模拟宿主、真实 Jenkins 数据读取、Codex 原生宿主验证是三种独立证据；最新状态与限制见[目标兼容性](target-compatibility.md)。

协议：[UI guidelines](https://developers.openai.com/plugins/concepts/ui-guidelines)、[MCP Apps UI](https://developers.openai.com/plugins/build/chatgpt-ui)、[OpenAI MCP 扩展](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md)。
