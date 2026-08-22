# 文档模式 preset（文档智能体）

[English](README.md) | 中文

`document` agent preset 在 DeepSeek Harness 上组装一个文档交付智能体。它基于 `standard` preset，替换了 persona 与计划模式章节为文档交付版，新增六个交付技能，并挂载一个隔离的 OpenDesign 技能源——当存在 OpenDesign checkout 时，为智能体提供完整的渲染模板与设计技能库。

## 挂载内容

在文档工作流所需的标准编码行（shell、filesystem、jobs、skills、goals、plan mode、compaction、delegation、ask-user、todo、web）之外，本 preset 贡献：

- **六个交付技能**（`skills/`）：`document-brief`（需求→交付规范）、`document-html`（单文件 HTML 工件）、`document-report`（长报告：Markdown → HTML → 可 PDF）、`document-deck`（HTML Deck + 可选 PPTX）、`document-word`（经 officecli 技能生成 `.docx`）、`document-quality-gate`（P0/P1 交付前检查清单）。
- **OpenDesign 技能源**：第二个 `skill-filesystem` 实例（名为 `open-design`），当 `OPEN_DESIGN_DIR` 设置时挂载 checkout 的 `skills/` 与 `design-templates/` 目录——与 `examples/opendesign` 相同的接线，已内建。未设置该变量时以零根注册（显式空目录），preset 可独立工作。
- **文档交付 persona**（身份、六条作业纪律、标准作业流程、输出纪律）与文档版计划模式章节：交付规范、大纲、模板选择、导出清单都属于"计划"——获批前不生成任何对外交付文件。

## 技能

`skills/` 下六个技能构成一条管线：`document-brief` → 大纲 → `document-html` / `document-report` / `document-deck` / `document-word` → `document-quality-gate` → 交付。

- `document-brief` — 捕获目标、受众、格式、设计系统、成功标准与约束，写入 `brief.md`；是其余所有技能的输入契约。
- `document-html` — 单文件 `index.html` 管线；优先使用 OpenDesign 渲染模板（web-prototype / saas-landing / dashboard），否则用内置基线。
- `document-report` — `report.md` 源 + `report.html` 渲染（目录、锚点、页脚）。
- `document-deck` — `deck.html` 横向滑动 Deck，杂志版式；officecli 可用时生成 `.pptx`。
- `document-word` — 经 officecli 技能生成 `.docx`；officecli 不可用时回退 Markdown 交付。
- `document-quality-gate` — P0（不通过不得交付）与 P1 检查清单：命名、自包含、无占位残留、断链、事实来源、可访问性、移动端重排、篇幅预算。

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

- **PDF 是导出指引而非渲染器**——`document-report` / `document-html` 交付自包含 HTML；PDF 导出经浏览器/桌面打印或规划的交付页（文档智能体方案 P2）完成，不在 preset 内部。
- **`document-word` 依赖用户级 `officecli` 技能**——preset 无法内置；缺失时回退 Markdown。
- **OpenDesign 技能为可选**——未设置 `OPEN_DESIGN_DIR` 时使用内置基线模板，模板多样性降低但交付不被阻塞。
