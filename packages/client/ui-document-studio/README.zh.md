# @deepseek-ai/dsh-client-ui-document-studio

[English](README.md) | 中文

面向[文档模式 preset](../../../apps/cli/config/agent-presets/document/README.zh.md)的文档交付工作室：一个 `conversation.view` 标签（`document`，标签「交付物」），列出会话已交付文件，经宿主预览 HTML/文本，并提供打开 / 在文件夹中显示 / 打印动作。当会话的 agent preset 是文档智能体时，还会自动切换到该视图。

## 挂载内容

- **交付工作室视图**——`conversation.view` 环形槽的一个条目（id `document`，order 20）。插件加载后每个会话都会出现该标签；选中即在中心列显示工作室。
- **产物词汇**——一个 turn 级 `ConversationNodeDefinition`（`documentDeliverables`），把成功变更的 `locations`（diff 卡与 generic edit 卡）折叠为 turn 数据；外加一个会话级视图目标（`documentDeliverables`），把窗口内所有 turn 折叠为一份按首次出现排序的去重列表。推导与 `ui-deliverables` 使用同一词汇；本包自持自己的 key，因此无论是否组合 `ui-deliverables`，工作室都能工作。
- **预览**——选中文件后经宿主 `host.readFileText` RPC 读取文本（上限 4 MiB；超限文件显示开头并附截断提示）。HTML 在沙箱 iframe（`sandbox=""`，不执行脚本）中渲染；Markdown/JSON/YAML/CSV/LOG 以文本渲染。
- **动作**——用系统默认应用打开、在文件夹中显示（仅当宿主在回环权威下报告原生打开能力时）、打印 / 导出 PDF（通过浏览器打印对话框打印 HTML 预览，可"另存为 PDF"）。
- **自动跳转**——当当前会话的 preset 是文档智能体时，进入会话即激活工作室视图。切换经 `ctx.conversation.setActiveView`——这是受认可的跨插件通道（按设计，per-session store 句柄仅限 apply 局部）；setter 随会话的 conversation seat 挂载，因此切换在有限窗口内重试。

Web patch（`packages/bundle/web-app/cordis.patch.yml`）是加载本包的唯一组合。移除其唯一条目即同时移除标签、词汇、预览与自动跳转。

## 前提

文档会话选择的是文档模式 preset（`apps/cli/config/agent-presets/document/`）；工作室对每个会话都渲染，与 preset 无关。`host.readFileText` RPC 随宿主发货；无需 OpenDesign 或任何外部进程。

## 模型体验

无：本包是浏览器端 UI 管线，不触达任何模型请求。产物数据派生自变更工具自身的 `locations`，而非模型的收尾文案。

### KV 缓存影响

无；本包既不组装也不发送 provider 请求。

## 已知限制与待办

- **预览是预览而非执行**——HTML 以 `sandbox=""` 渲染，交互式工件（JS 驱动的 Deck、实时仪表盘）只显示首帧而不运行。信任会话自身产物文件的渲染器留待后续。
- **本迭代 PDF 走浏览器打印**——打印动作打开系统打印对话框；经桌面壳静默 `webContents.printToPDF` 导出是文档智能体方案的 P3 后续。
- **自动跳转仅在进入会话时触发**——手动切回聊天标签后，离开并重新进入会话前不会被覆盖。
- **预览按扩展名仅限文本**——二进制格式（`.docx`、`.pptx`、`.pdf`）可列出与打开，尚无内联预览。
