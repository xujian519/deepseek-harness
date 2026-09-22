# 文档模式 preset（文档智能体）

[English](document.md) | 中文

`document` agent preset 在 DeepSeek Harness 上组装一个文档交付智能体。本 bundle 在 `presets/document.patch.yml` 中声明它，其六个交付技能随附在 `skills/document/` 下。它基于 `standard` preset，替换了 persona 与计划模式章节为文档交付版，并挂载一个隔离的 OpenDesign 技能源——当存在 OpenDesign checkout 时，为智能体提供完整的渲染模板与设计技能库。

## 挂载内容

在文档工作流所需的标准编码行（shell、filesystem、jobs、skills、goals、plan mode、compaction、delegation、ask-user、todo、web）之外，本 preset 贡献：

- **六个交付技能**（`skills/document/`）：`document-brief`（需求→交付规范）、`document-html`（单文件 HTML 工件）、`document-report`（长报告：Markdown → HTML → 可 PDF）、`document-deck`（HTML Deck + 可选 PPTX）、`document-word`（先从模板生成 `.docx`，模板不覆盖的排版再交 officecli）、`document-quality-gate`（P0/P1 交付前检查清单 + 工具侧确定性核验）。
- **OpenDesign 技能源**：第二个 `skill-filesystem` 实例（名为 `open-design`），当 `OPEN_DESIGN_DIR` 设置时挂载 checkout 的 `skills/` 与 `design-templates/` 目录——与 `examples/opendesign` 相同的接线，已内建。未设置该变量时以零根注册（显式空目录），preset 可独立工作。
- **结构化交付登记**：`document_deliver` 工具把交付文件、导出格式与 P0/P1 质量门结果记录进会话日志，并自行读取每个交付文件、在结果里给出确定性核验结论（残余占位符、未声明锚点、空章节、风格禁用词、声明字数预算）；阻断级问题直接拒绝登记。[交付工作室](../../../client/ui-document-studio/README.zh.md)据此从日志条目与结果元数据推导文件列表、质量门徽标与机器核验徽标——变更工具之外产出的二进制产物（经 officecli 的 `.docx`/`.pptx`、打印动作的 PDF）经登记后也能出现在工作室。
- **文档模板与样式行**：`doc-template` 基于随包模板资产注册 `list_doc_templates` 与 `render_doc_template`，并把 `assistant-neutral` 书写风格指南（`styleGuide`）注入为系统提示段落——与 `document_deliver` 核验所用的是同一份风格，因此"被告知要避开的词"与"门禁会拒绝的词"是同一张表。
- **文档交付 persona**（身份、六条作业纪律、标准作业流程、输出纪律）与文档版计划模式章节：交付规范、大纲、模板选择、导出清单都属于"计划"——获批前不生成任何对外交付文件。

## 技能

`skills/document/` 下六个技能构成一条管线：`document-brief` → 大纲 → `document-html` / `document-report` / `document-deck` / `document-word` → `document-quality-gate` → 交付。

- `document-brief` — 捕获目标、受众、格式、设计系统、成功标准与约束，写入 `brief.md`；是其余所有技能的输入契约。
- `document-html` — 单文件 `index.html` 管线；优先使用 OpenDesign 渲染模板（web-prototype / saas-landing / dashboard），否则用内置基线。
- `document-report` — `report.md` 源 + `report.html` 渲染（目录、锚点、页脚）。
- `document-deck` — `deck.html` 横向滑动 Deck，杂志版式；officecli 可用时生成 `.pptx`。
- `document-word` — 用 `render_doc_template`（format 为 `docx`）生成 `.docx`，把工具返回的 base64 包落盘；页眉页脚、页码、目录字段继续用 officecli 加工同一文件。
- `document-quality-gate` — P0（不通过不得交付）与 P1 检查清单：命名、自包含、无占位残留、断链、事实来源、可访问性、移动端重排、篇幅预算；另附工具侧确定性核验表，命中阻断项时登记会被拒绝。

## 前提

无硬性依赖，preset 可独立完整工作。如需 OpenDesign 增强，克隆 OpenDesign 并导出其根目录：

```sh
git clone https://github.com/nexu-io/open-design.git
export OPEN_DESIGN_DIR="$PWD/open-design"
```

此时 `open-design` 技能源会把 checkout 的 276 个技能/模板目录纳入目录（已对 main 0.20.3 实测验证）。`document-word` 另受益于用户级 `officecli` 技能；缺失时智能体会交付 Markdown 并说明。

## 模型体验

模型看到中文文档交付 persona（身份、六条作业纪律、标准作业流程与输出纪律：交付物即文件、无来源即撤回、不发明品牌、自包含输出、强制 HITL 确认点、强制质量门）、文档版计划模式章节、六个内置技能及（挂载时的）OpenDesign 技能、以及标准编码工具。

## 已知限制与待办

- **PDF 是导出指引而非渲染器**——`document-report` / `document-html` 交付自包含 HTML；PDF 导出经交付工作室的打印按钮（桌面端 print-to-PDF 或浏览器打印）完成，不在 preset 内部。
- **`document-word` 依赖用户级 `officecli` 技能**——preset 无法内置；缺失时回退 Markdown。
- **OpenDesign 技能为可选**——未设置 `OPEN_DESIGN_DIR` 时使用内置基线模板，模板多样性降低但交付不被阻塞。
- **`document_deliver` 只登记不转换**——工具仅校验声明的文件存在于会话工作区；PDF 导出或二进制转换仍需要相应管线步骤（打印动作 / officecli），工作区外保存的文件无法登记。
