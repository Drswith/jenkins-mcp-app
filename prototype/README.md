# Jenkins 界面原型

这个交互原型展示三种 ChatGPT 插件界面：由全局侧栏入口打开的全屏工作台、约 360px 宽的对话右侧构建面板，以及只呈现结果和“查看详情”操作的对话内卡片。工作台不是插件详情页。对话视图中的浅灰背景、提问和文字回答只是宿主位置示意；白色卡片与右侧面板才是插件内容。原型没有复刻 ChatGPT 的导航栏和输入框。

界面直接使用简体中文，没有语言切换。任务标识和示例控制台原始日志保留原文。所有数据均为示例；原型不会连接 Jenkins，也不会收集凭据。原型不在 `release/jenkins/` 安装包内。

在仓库根目录使用 Node.js 20.19+ 或 22.12+ 运行 `pnpm prototype`，打开命令输出的本地地址。`pnpm prototype:build` 可检查独立前端构建。界面使用 `assets/` 中的 Jenkins 官方图像，来源见 [资源说明](../assets/ATTRIBUTION.md)。

预览图：[工作台](previews/workspace.png)、[对话右侧面板](previews/thread-panel.png)、[对话内卡片](previews/inline-card.png)。交互和自适应布局以运行中的原型为准。

[OpenAI 插件扩展文档](https://developers.openai.com/plugins/build/extensions)介绍全局侧栏和对话面板入口；[MCP Apps UI 文档](https://developers.openai.com/plugins/build/chatgpt-ui)介绍组件协议。后续接入宿主还需要 MCP UI 资源、扩展元数据和可访问的 MCP 服务；本地原型尚未验证宿主中的真实呈现。
