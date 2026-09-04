---
description: "面向[文档模式 preset](../../preset/agent-presets/presets/document/preset.yml)的文档交付工作室：一个 `conversation.view` 标签（`document`，标签「交付物」），列出会话已交付文件，经宿主预览 HTML/文本，并提供打开 / 在文件夹中显示 / 打印动作。当会话的 agent preset 是文档智能体时，还会自动切换到该视图。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-document-studio

[English](README.md) | 中文

## 概述

面向[文档模式 preset](../../preset/agent-presets/presets/document/preset.yml)的文档交付工作室：一个 `conversation.view` 标签（`document`，标签「交付物」），列出会话已交付文件，经宿主预览 HTML/文本，并提供打开 / 在文件夹中显示 / 打印动作。当会话的 agent preset 是文档智能体时，还会自动切换到该视图。

不发布运行时不变式伴生；此纯消费插件不发出 cordis 事件、不持有跨插件可变状态——其视图槽注册与自动切换订阅是普通副作用，其释放由槽账本自身 spec 与本包行为 spec 直接观测。


## 目录

- [挂载内容](#what-it-mounts)
- [前提](#prerequisites)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)

<a id="what-it-mounts"></a>
## 挂载内容

- **交付工作室视图**——`conversation.view` 环形槽的一个条目（id `document`，order 20）。插件加载后每个会话都会出现该标签；选中即在中心列显示工作室。
- **产物词汇**——一个 turn 级 `ConversationNodeDefinition`（`documentDeliverables`），把成功变更的 `locations`（diff 卡与 generic edit 卡）以及 `document_deliver` 登记调用折叠为 turn 数据；外加一个会话级视图目标（`documentDeliverables`），把窗口内所有 turn 折叠为一份按首次出现排序的去重列表。登记调用会原地升级变更派生的条目，带上声明的格式与 P0/P1 质量门状态——因此经 shell/officecli 产出的二进制产物（`.docx`、`.pptx`）在登记后进入工作室；旧会话降级为变更派生列表并显示"未登记质量门"徽标。推导与 `ui-deliverables` 使用同一词汇；本包自持自己的 key，因此无论是否组合 `ui-deliverables`，工作室都能工作。
- **预览**——选中文件后经宿主 `host.readFileText` RPC 读取文本（默认 1 MiB 读取预算，宿主上限 4 MiB；超限文件显示开头并附截断提示）。HTML 在沙箱 iframe（`sandbox=""`，不执行脚本）中渲染；Markdown/JSON/YAML/CSV/LOG 以文本渲染。
- **动作**——用系统默认应用打开、在文件夹中显示（在操作系统文件管理器中打开产物所在目录；仅当宿主在回环权威下报告原生打开能力时；宿主没有 reveal-in-folder 意图，打开目录本身即交接）、打印 / 导出 PDF（预览头被截断时按 4 MiB 上限重新读取完整文件，再经桌面桥或浏览器打印对话框导出，其中「另存为 PDF」完成导出）。
- **自动跳转**——当当前会话的 preset 是文档智能体时，进入会话即激活工作室视图。切换经 `ctx.conversation.setActiveView`——这是受认可的跨插件通道（按设计，per-session store 句柄仅限 apply 局部）；setter 随会话的 conversation seat 挂载，因此切换在有限窗口内重试。

Web patch（`packages/bundle/web-app/cordis.patch.yml`）是加载本包的唯一组合。移除其唯一条目即同时移除标签、词汇、预览与自动跳转。

<a id="prerequisites"></a>
## 前提

文档会话选择的是文档模式 preset（`packages/preset/agent-presets/presets/document/`）；工作室对每个会话都渲染，与 preset 无关。`host.readFileText` RPC 随宿主发货；无需 OpenDesign 或任何外部进程。

<a id="model-experience"></a>
## 模型体验

无，本包仅渲染已登记的交付记录，不改变模型请求、工具执行或会话事件。

#### KV 缓存影响

无。本包为纯客户端展示。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

- **预览是预览而非执行**——HTML 以 `sandbox=""` 渲染，交互式工件（JS 驱动的 Deck、实时仪表盘）只显示首帧而不运行。信任会话自身产物文件的渲染器留待后续。
- **桌面端 PDF 静默导出**——在桌面 App（Electron）内，打印动作经 `window.desktop.printHtmlToPdf` 走隐藏窗口 + `webContents.printToPDF` 并弹出系统保存对话框；桌面壳之外回退浏览器打印对话框。
- **自动跳转仅在进入会话时触发**——手动切回聊天标签后，离开并重新进入会话前不会被覆盖。
- **预览按扩展名仅限文本**——二进制格式（`.docx`、`.pptx`、`.pdf`）在登记后列出并带格式与质量门徽标，但无内联预览；它们在系统默认应用中打开。
- **列表跟随会话日志窗口**——长会话中落在已加载窗口之外的早期 turn 会从列表丢失；批量导出与跨会话聚合属于延后的工作台 v2。

### 开发备注

无。
