# 公开提审要求核实

核实日期：**2026-11-07**。依据当前 OpenAI 官方文档和仓库 `0.2.0` 包；未登录提交门户、上传包、申请资格或公开发布。本文统一维护提审结论；功能与原生验收见[兼容性记录](target-compatibility.md)。

**结论：本地 stdio 插件已有官方提审路径，但仅向获批组织开放。本项目完成本地改造不等于具备公开上架资格。** 过去笼统的“公开提审要求待核实”收敛为下列已确认条件与明确待办。

## 已确认的路径与条件

| 范围 | 官方要求及本项目影响 |
| --- | --- |
| 本地 MCP | 先由 OpenAI 代表确认资格并将提交组织加入允许名单，再在门户选择 **Skills only** 上传含 stdio 配置的 ZIP；名称不能理解为必须删除 MCP。本项目根 `mcp.json` 已是 stdio，符合这一路径的运行形态，尚未确认组织资格。[桌面插件提交](https://developers.openai.com/plugins/deploy/desktop-only) |
| 桌面分发 | 官方页面将该路线描述为带 Desktop only 标记、从 ChatGPT 桌面安装、仅本地对话可提及；还要求干净安装和主要流程测试。它不证明本项目已获 Codex 公共目录或移动端兼容认证。本地 Codex 安装验收仍是独立证据。[桌面插件提交](https://developers.openai.com/plugins/deploy/desktop-only) |
| 提交身份 | 需已验证的个人/企业身份，以及组织所有者或 Apps Management Write 权限。首次 ZIP 应包含 MCP；不能先发布纯技能包再假定可以补加 MCP。[提交流程](https://developers.openai.com/plugins/deploy/submission#confirm-access-and-publishing-identity) |
| 包检查 | 上传校验、审核和批准后的发布是不同步骤。当前源包 21 个文件不是已通过门户校验的提交 ZIP。门户接受受支持的根 `plugin.json`；上传不能夹带凭据、私有日志或本地配置。[提交流程](https://developers.openai.com/plugins/deploy/submission)、[错误参考](https://developers.openai.com/plugins/deploy/submission-errors#plugin-manifest-errors) |
| 社区连接器 | 指南不批准主要作为非官方第三方连接器的插件，也要求授权访问。README 明确本项目是社区集成，因此这是需要确认的资格风险；文档没有给出本项目或用户自托管 Jenkins 的豁免，不能自行判定通过或已被拒绝。[第三方集成政策](https://developers.openai.com/plugins/plugin-guidelines#third-party-content-and-integrations) |
| 隐私说明 | 指南要求公开隐私政策，说明数据种类、用途、接收方、保留时间和用户控制；本地保存凭据与响应脱敏不能替代该说明。[隐私要求](https://developers.openai.com/plugins/plugin-guidelines#privacy-policy) |

`requires_local_executor` 的示例位于官方“无 MCP 的插件”小节；它不是本项目取得本地 MCP 提审资格的替代方案。本轮不为上架猜测增加字段，也不把本地连接改造成公共服务。

## 工具注解：理由保留，必填性仍待核实

所有工具显式提供三个布尔 hint，`triggerBuild` 的 `destructiveHint:true` 理由继续由[工具注解契约](configuration.md#tool-annotations-and-packaging)维护：任务可能产生不可逆部署或覆盖，每次调用也会再次排队。注解不替代 Jenkins 权限和宿主审批。

当前官方页面仍存在可复现的不一致：

| 官方页面 | 核实到的内容 |
| --- | --- |
| [Plugin guidelines / Correct annotation](https://developers.openai.com/plugins/plugin-guidelines#correct-annotation) | 明确写着“Annotation justifications are no longer required.”，但三个布尔注解仍须准确声明。 |
| [Remote MCP server review requirements](https://developers.openai.com/plugins/deploy/app-review#metadata-stored-during-tool-scanning) | 仍要求提交理由解释服务器声明的值，并说明不可逆影响发生的条件。 |
| [Submission error reference / MCP and review errors](https://developers.openai.com/plugins/deploy/submission-errors#mcp-and-review-errors) | 在明确适用于远程 MCP 的错误表中仍列出 `justification_required`。 |

因此，“理由是否必填”以及获批本地 MCP 的实际表单要求继续标为**待门户或 OpenAI 确认**，不能用远程错误项反推本地必填，也不能仅据指南删掉现有理由。没有向运行时 schema 添加自造的 justification 字段。

## 本项目公开提审前的剩余工作

| 项目 | 当前状态与下一步 |
| --- | --- |
| 组织、发布身份与连接器资格 | 未核验允许名单、身份或门户权限；需提交方与 OpenAI 确认本地 MCP 和社区 Jenkins 集成的资格。 |
| 作者与公开资料 | `plugin.json` 有 `interface.developerName`，没有 `author.name`；错误参考列出 `plugin_developer_missing`，应在获准提审时补齐真实作者并验证。当前 manifest 只有网站 URL，未提供隐私、条款和支持 URL；未核验相应公开页面。ZIP 可接受部分字段缺省不代表满足全部公开审核政策。[字段要求](https://developers.openai.com/plugins/deploy/submission-errors#plugin-manifest-errors) |
| 审核材料 | 标准流程为带 MCP 的插件列出 5 个正例、3 个反例、演示视频及发行说明；需要登录时使用可供审核的独立样本账号。现有单元测试与私有截图不是这套提交材料，尚未整理或用审核账号跑完；获批本地路线的表单仍需确认。审核凭据仅进入门户私密字段，不进包或 Git。[审核信息](https://developers.openai.com/plugins/deploy/submission#complete-review-information) |
| 可验证的公开安装包 | 已有 Codex 本地安装证据；未执行 ChatGPT 桌面干净安装、公开 ZIP 上传检查或门户扫描。安装所需 Node.js 20+ 也需纳入干净环境验证。 |
| 写操作审批 | 真实 `triggerBuild` 权限与宿主审批未验收。本轮继续禁止真实构建；后续若需要完整写入验收，应另行确定允许执行的隔离任务和参数。 |
| 提交与发布 | 尚未申请审核或发布到官方目录；GitHub 提交和推送只是源代码与记录同步。 |

## 仅在另选远程 MCP 路线时适用

远程路线使用 **With MCP**、稳定的公网 HTTPS 端点、域名验证和工具扫描。远程审核还要求可从外部访问；本地 stdio 包、私有 Jenkins 地址或开发隧道不能直接作为已就绪的公网服务。[远程审核前提](https://developers.openai.com/plugins/deploy/app-review#prerequisites)

门户的远程连接表单支持无认证、OAuth 及混合访问，目前没有 API key、Bearer、Basic 或自定义认证头输入流程；不能把 token 填进服务器 headers 绕过。本项目本地进程到 Jenkins 的 Basic/API Token 连接不等于远程门户认证，不能据此判定本地路线不合格。[认证限制](https://developers.openai.com/plugins/deploy/submission#authentication-limitations)

公开远程提交还要求网站、隐私、条款和支持四个 URL；这不应直接套用成所有本地 ZIP 的同一组必填字段。[公开字段要求](https://developers.openai.com/plugins/deploy/submission-errors#listing-and-interface-errors) 本轮没有选择远程改造、部署服务、申请审核账号或改变凭据保存方式。
