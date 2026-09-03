---
description: "函数插件，将 Sati 专利域工具集原生移植到 DeepSeek Harness。它注册 24 个模型可见工具，覆盖检索、元数据、知识查询、权利要求对照表、撰写、分析报告、证据判定、规则检查以及工作流/计划状态机。每个工具返回可无损 JSON 序列化的规范值，并暴露纯 `output.render` 函数生成模型可见 prose（Sati 没有 render 拆分，这是新的 dsh 契约）。"
kind: "package-reference"
---

# @deepseek-ai/dsh-patent-tools

[English](README.md) | 中文

## 概述

函数插件，将 Sati 专利域工具集原生移植到 DeepSeek Harness。它注册 24 个模型可见工具，覆盖检索、元数据、知识查询、权利要求对照表、撰写、分析报告、证据判定、规则检查以及工作流/计划状态机。每个工具返回可无损 JSON 序列化的规范值，并暴露纯 `output.render` 函数生成模型可见 prose（Sati 没有 render 拆分，这是新的 dsh 契约）。

## 目录

- [工具](#tools)
- [配置](#configuration)
- [Model Experience](#model-experience)
- [已知局限与延后工作](#known-limitations-and-deferred-work)

<a id="tools"></a>
## 工具

| 工具 | 类别 | 数据源 / 引擎 |
| --- | --- | --- |
| `patent_search` | 检索 | `@deepseek-ai/dsh-patent-data`（nuo `searchPatents`，LRU 缓存） |
| `patent_metadata` | 检索 | `@deepseek-ai/dsh-patent-data`（nuo `scrapePatent`，LRU 缓存） |
| `patent_legal_status` | 检索 | `@deepseek-ai/dsh-patent-data`（nuo `LegalStatusChecker`） |
| `patent_case_search` | 知识 | `ctx.patentKnowledge.caseLawSearch`（knowledge.db FTS5） |
| `patent_wiki_search` | 知识 | `ctx.patentKnowledge` wiki 卡片 |
| `patent_kg_query` | 知识 | `ctx.patentKnowledge` 知识图谱 |
| `patent_eval` | 质量 | 确定性（内联反套话引擎） |
| `patent_analysis_report` | 分析 | `@deepseek-ai/dsh-patent-core` analysis-report 聚合器 + 可选 ModelPort |
| `claim_chart_build` | 撰写 | `@deepseek-ai/dsh-patent-core` claim-chart 原子 + ModelPort |
| `draft_claims` | 撰写 | 确定性 |
| `draft_specification` | 撰写 | 确定性 |
| `validate_specification` | 质量 | 确定性 |
| `evaluate_evidence` | 证据 | `@deepseek-ai/dsh-patent-core` 证据引擎 |
| `rule_check` | 质量 | `@deepseek-ai/dsh-patent-rule` 规则引擎 |
| `analyze_patent_figure` | 分析 | 经 `FigureAnalysisEngine` 走视觉 ModelPort（Config.figureAnalysisMode：`single`=一次调用，默认；`two-step`=结构抽取+说明生成两次调用）；按附图模型做图片输入门禁 |
| `search_patent_figure` | 检索 | 附图索引关键词检索（索引由 `analyze_patent_figure` 写入，见 Config.figureIndexFile） |
| `generate_patent_figure` | 撰写 | 附图 DOT 构建器 + Graphviz 渲染：SVG 默认内置 `@viz-js/viz` WASM，png/pdf 与 `figureRenderer: 'cli'` 走 `dot` CLI（Config.graphvizExecutable / figureOutputDir / dotFont）；提交规格 page/dpi/margin/orientation；框图/层级图 SVG 默认引线标号；`panels` 多面板输出与 `figure_family` 跨图标号续接；结果写入附图索引（Config.figureIndexFile） |
| `add_patent_figure_references` | 撰写 | SVG 标号后处理：内嵌模式按 `<text>`/`<tspan>` 文本匹配追加 `(标号)`；`leader_lines: true` 绘制引线并放置独立标号 |
| `patent_pdf_download` | 文档 | browser-backend 冷决策：ego-browser 下载拦截（统一 ego 栈） |
| `recognize_chemical_structure` | 分析 | 可选（rdkit 未随包）；索引写入已接线（Config.chemistryIndexFile） |
| `flexible_plan` | 工作流 | `@deepseek-ai/dsh-patent-workflow` flexible-plan |
| `patent_workflow` | 工作流 | `@deepseek-ai/dsh-patent-workflow` 收口 |
| `patent_workflow_run` | 工作流 | `@deepseek-ai/dsh-patent-workflow` + ModelPort |
| `patent_plan_task` | 工作流 | `@deepseek-ai/dsh-patent-workflow` plantask 状态机 |
| `patent_worker_validate` | 质量 | `@deepseek-ai/dsh-patent-workflow` worker 契约 |
| `knowledge_note_save` | 知识 | Config.noteDir 下的文件写入器（默认 `<cwd>/99-知识库`） |
| `workbench_link_patent_case` | 工作流 | 个人工作台 loopback HTTP API：幂等案件桥接（patent_* 字典种子化；根任务 + L1–L5 阶段子任务，`source='patent'`；`_matter-log.md` 状态投影；不写案件目录、不改根任务状态） |

`render_patent_document` 由 `@deepseek-ai/dsh-patent-document` 拥有（其 `apply()` 注册该工具）；本包仅再导出 `createRenderPatentDocumentTool` 与 `renderDocumentResult` 供库消费者使用，不重复注册，因此同时组合两个插件不会产生重名错误。

`slop-gate` 是工作流原子，而非模型可见工具：`apply()` 将 `slopGateAtom` 与 `SlopGateHandler` 注册进全局注册表，因为该门依赖本包内联的反套话引擎。它基于 `state.claims_draft` 做确定性分析，写入 `slop_report` 与 `slop_score`；当草稿未达通过线时，额外写入仅含证据的 `slop_revision_hint`（命中短语与建议替换、结构性问题行级定位；绝不包含评分数字、总分或通过线）。`patent_disclosure_v1` manifest 的 `slop_clean` 阶段门控草稿，命中失败信号即回退到 `draft_claims`，使重写时注入该提示。库消费者同样获得 `slopGateAtom`、`SlopGateHandler`、`SLOP_GATE_PASS_THRESHOLD` 与提示构造器 `buildSlopRevisionHint`。

<a id="configuration"></a>
## 配置

Schemastery 配置，所有字段可选。

| 键 | 类型 | 默认 | 含义 |
| --- | --- | --- | --- |
| `provider` | string | — | LLM 消费工具（`patent_analysis_report`、`claim_chart_build`、`patent_workflow_run`、`flexible_plan`、`analyze_patent_figure`）的 provider 路由。 |
| `model` | string | — | LLM 消费工具的模型 id。 |
| `imageModel` | object | — | 专用附图/图片模型路由（`{ provider, model }`），其声明的输入模态用于门禁 `analyze_patent_figure`；未设置时回退到 `provider`/`model`。 |
| `maxTokens` | number | — | LLM 消费工具的输出 token 上限（可选）；省略时用 provider 默认值。 |
| `noteDir` | string | `<cwd>/99-知识库` | `knowledge_note_save` 的知识笔记目录（绝对或相对 cwd）。 |
| `figureIndexFile` | string | `<cwd>/.sati/figures-index.json` | 附图索引文件：`analyze_patent_figure` 写入分析条目、`search_patent_figure` 检索（绝对或相对 cwd）。 |
| `chemistryIndexFile` | string | `<cwd>/.sati/chemistry-index.json` | `recognize_chemical_structure` 写入的化学索引文件（绝对或相对 cwd）。 |
| `graphvizExecutable` | string | 自动探测 | `dot` 可执行路径覆盖；探测顺序：覆盖值 → `DSH_GRAPHVIZ_DOT` → 平台候选路径 → `PATH`。 |
| `figureOutputDir` | string | `<cwd>/patent/figures` | `generate_patent_figure` 的输出目录（绝对或相对 cwd）。 |
| `workbenchBaseUrl` | string | 进程内 webServer 端口 | `workbench_link_patent_case` 的工作台 API 基址；显式配置优先，web 组合内自动取 `http://127.0.0.1:<webServer 端口>`；不可用（非 web profile）时工具在执行期以 `setup_required` 失败。 |
| `workbenchCaseRoot` | string | `<cwd>/patent-workspace` | `workbench_link_patent_case` 的案件根目录：每案位于 `<root>/<案号>/`，内含 `_matter-log.md`。 |
| `dotFont` | string | 平台相关 | DOT 字体名覆盖；默认 Helvetica，label 含 CJK 时按平台候选（PingFang SC / Microsoft YaHei / Noto Sans CJK SC）。 |
| `figureRenderer` | `'wasm' \| 'cli'` | `wasm` | `generate_patent_figure` 的 Graphviz 渲染器：`wasm` 为内置 `@viz-js/viz`（SVG，无系统依赖）；`cli` 走 `dot` 子进程。png/pdf 一律路由到 CLI。 |
| `figureAnalysisMode` | `'single' \| 'two-step'` | `single` | `analyze_patent_figure` 模式：`single` 为一次视觉调用；`two-step` 在同一路由先做结构抽取再做说明生成（模型成本翻倍）。 |
| `figurePageSize` | `'a4' \| 'letter'` | — | 提交规格页面尺寸；设置时输出 DOT `page`/`size` 属性（per-call `page_size` 覆盖）。 |
| `figureOrientation` | `'portrait' \| 'landscape'` | portrait | 提交规格页面方向（per-call `orient` 覆盖）。 |
| `figureDpi` | number | — | 提交规格渲染 DPI（栅格输出生效；per-call `dpi` 覆盖）。 |
| `figureMargin` | number（厘米） | — | 四边同值页边距；与 `figurePageSize` 同给时收缩绘图区 `size`（per-call `margin` 覆盖）。 |

未设置 `provider`/ `model` 时，LLM 消费工具照常注册，但调用时 fail loud（`setup_required`）。知识类工具需要经 `patent-knowledge:install` 准备的 knowledge.db；缺失时 fail loud 并给出安装引导。

<a id="model-experience"></a>
## Model Experience

### 工具 schema

#### 模型所见

25 个已注册工具定义（见上表），各含描述、参数 schema 与将规范结果渲染为 Markdown prose 的 `output.render`。精确描述与参数见生成的[`patent-tools` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-patent-tools)。

#### Token 影响

每个已注册工具在每次请求产生固定定义开销；结果文本随数据变化，仅到压缩时才会重发。本包不注册任何 system-prompt 段，因此无额外固定 prompt 开销。

#### KV Cache 影响

在已注册工具集与其描述不变时前缀稳定；修改配置或注册集会使工具定义偏移，并从该点起失效复用。

<a id="known-limitations-and-deferred-work"></a>
## 已知局限与延后工作

- **`render_patent_document` 归属** — 该工具由 `@deepseek-ai/dsh-patent-document` 注册，而非本包；本包仅再导出其工厂。
- **`flexible_plan` 命名** — Sati 的 `patentFlexiblePlanTool.ts` 声明名为 `flexible_plan`（非 `patent_flexible_plan`）；dsh 工具信任 Sati 的 name 字段。
- **图片模态门禁范围** — `analyze_patent_figure` 把附图发送给解析出的附图模型路由，并按该路由声明的图片输入做准入（缺失时以错误码 `model_cannot_accept_image` 拒绝）；图片字节经 harness 附件服务入库后以持久引用随请求发送，附件服务或路由缺失时以 `setup_required` 显式报错。`search_patent_figure` 读取索引，刻意不做门禁（与 Sati 一致，仅门禁 analyze）。索引由 `analyze_patent_figure` 写入 Config.figureIndexFile；索引缺失或为空时返回零命中并附引导提示，而非报错。
- **化学引擎未移植** — `recognize_chemical_structure` 与 `validate_specification` 的化学表征检查降级为不可用，因为 `@rdkit/rdkit` 是未随包的可选原生依赖。
- **附图/化学引擎未移植** — Sati 的 `src/patent/figure` 与 `src/patent/chemistry` 引擎不在任何 dsh 包内；附图工具仅实现最小 ModelPort 路径与关键词检索，附图/化学索引存储（`figure/index-store`、`chemistry/index-store`）已接线写+读。网表可视化与 SMILES（RDKit）解析延后。
- **附图生成范围** — `generate_patent_figure` 的 SVG 默认经内置 `@viz-js/viz` WASM 引擎渲染（Config.figureRenderer）；png/pdf 与 `figureRenderer: 'cli'` 走 `dot` 子进程，后者仍是系统依赖——这些路径缺失时 fail loud 并给出安装引导。引线标号对框图/层级图 SVG 默认开启（流程图与 `raw_dot`/`template` 默认关闭；per-call `leader_lines` 覆盖）：标号置于部件外侧并以 `<line>` 引线相连，替代内嵌标签后缀；非 SVG 格式保持内嵌标号并返回警告。`panels` 渲染多面板组合（`fig1A`/`fig1B`，…）并共用同一标号系列；per-call `figure_family` 对附图索引中同一家族记录的组件跨代续接标号——未声明家族即逐图独立编号，索引中无 `figureFamily` 的条目永不参与。`semantic` 彩色填充仅当色彩承载技术内容时使用（依据《专利审查指南》第一部分第一章 4.3，2023 修订；默认 `grayscale` 黑白）；`raw_dot`/`template` 模式无结构化组件/连接还原（索引条目残缺）。
- **两步分析降级** — `figureAnalysisMode: 'two-step'` 下，结构抽取趟不可解析时按空组件返回尽力结果并附警告，跳过说明生成趟；图片门禁与结果形状与 `single` 一致。
- **知识笔记 / PDF 下载接线** — `knowledge_note_save` 将笔记写入 Config.noteDir 下的文件（knowledge.db 原生写 API 延后）；`patent_pdf_download` 经 browser-backend 冷决策（`@deepseek-ai/dsh-browser-backend`）解析批量运行器：统一 ego 栈让下载只路由到 ego-browser（挂载 patent-data 服务时经 `ctx.patentData.createEgoSession()`）；browseros-neo、playwright 与 browser-use 参与探测但从不参与下载。未挂载 patent-data 时 ego 通道以 setup 指引 fail-loud。ego-browser 下载拦截为尽力而为——浏览器无法保存的条目回退为对提取的 CDN URL 做带超时/重试/Retry-After 退避的 fetch。
- **移除语义召回** — `patent_case_search` 仅保留 FTS/LIKE；基于 embedding 的语义召回未移植（dsh 暂无向量基建）。
- **证据规则资产** — `evaluate_evidence` 经 `@deepseek-ai/dsh-patent-rule` 的资产定位解析 `evidence-rules.yaml`；缺失时引擎降级为默认权重。

### 开发备注

无。
