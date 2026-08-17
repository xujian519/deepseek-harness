# @deepseek-ai/dsh-patent-tools

[English](README.md) | 中文

函数插件，将 Sati 专利域工具集原生移植到 DeepSeek Harness。它注册 23 个模型可见工具，覆盖检索、元数据、知识查询、权利要求对照表、撰写、证据判定、规则检查以及工作流/计划状态机。每个工具返回可无损 JSON 序列化的规范值，并暴露纯 `output.render` 函数生成模型可见 prose（Sati 没有 render 拆分，这是新的 dsh 契约）。

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
| `claim_chart_build` | 撰写 | `@deepseek-ai/dsh-patent-core` claim-chart 原子 + ModelPort |
| `draft_claims` | 撰写 | 确定性 |
| `draft_specification` | 撰写 | 确定性 |
| `validate_specification` | 质量 | 确定性 |
| `evaluate_evidence` | 证据 | `@deepseek-ai/dsh-patent-core` 证据引擎 |
| `rule_check` | 质量 | `@deepseek-ai/dsh-patent-rule` 规则引擎 |
| `analyze_patent_figure` | 分析 | ModelPort（按附图模型做图片输入门禁） |
| `search_patent_figure` | 检索 | 附图索引关键词检索（不做图片门禁） |
| `patent_pdf_download` | 文档 | `@deepseek-ai/dsh-patent-data` ego-browser / fetch |
| `recognize_chemical_structure` | 分析 | 可选（rdkit 未随包） |
| `flexible_plan` | 工作流 | `@deepseek-ai/dsh-patent-workflow` flexible-plan |
| `patent_workflow` | 工作流 | `@deepseek-ai/dsh-patent-workflow` 收口 |
| `patent_workflow_run` | 工作流 | `@deepseek-ai/dsh-patent-workflow` + ModelPort |
| `patent_plan_task` | 工作流 | `@deepseek-ai/dsh-patent-workflow` plantask 状态机 |
| `patent_worker_validate` | 质量 | `@deepseek-ai/dsh-patent-workflow` worker 契约 |
| `knowledge_note_save` | 知识 | storage 落盘（knowledge.db 写 API 延后） |

`render_patent_document` 由 `@deepseek-ai/dsh-patent-document` 拥有（其 `apply()` 注册该工具）；本包仅再导出 `createRenderPatentDocumentTool` 与 `renderDocumentResult` 供库消费者使用，不重复注册，因此同时组合两个插件不会产生重名错误。

## 配置

Schemastery 配置，所有字段可选。

| 键 | 类型 | 默认 | 含义 |
| --- | --- | --- | --- |
| `provider` | string | — | LLM 消费工具（`claim_chart_build`、`patent_workflow_run`、`flexible_plan`、`analyze_patent_figure`）的 provider 路由。 |
| `model` | string | — | LLM 消费工具的模型 id。 |
| `imageModel` | object | — | 专用附图/图片模型路由（`{ provider, model }`），其声明的输入模态用于门禁 `analyze_patent_figure`；未设置时回退到 `provider`/`model`。 |

未设置 `provider`/ `model` 时，LLM 消费工具照常注册，但调用时 fail loud（`setup_required`）。知识类工具需要经 `patent-knowledge:install` 准备的 knowledge.db；缺失时 fail loud 并给出安装引导。

## Model Experience

### 工具 schema

#### 模型所见

23 个已注册工具定义（见上表），各含描述、参数 schema 与将规范结果渲染为 Markdown prose 的 `output.render`。精确描述与参数见生成的[`patent-tools` schema](../../../docs/tool-catalog.md#deepseek-aidsh-patent-tools)。

#### Token 影响

每个已注册工具在每次请求产生固定定义开销；结果文本随数据变化，仅到压缩时才会重发。本包不注册任何 system-prompt 段，因此无额外固定 prompt 开销。

#### KV Cache 影响

在已注册工具集与其描述不变时前缀稳定；修改配置或注册集会使工具定义偏移，并从该点起失效复用。

## 已知局限与延后工作

- **`render_patent_document` 归属** — 该工具由 `@deepseek-ai/dsh-patent-document` 注册，而非本包；本包仅再导出其工厂。
- **`flexible_plan` 命名** — Sati 的 `patentFlexiblePlanTool.ts` 声明名为 `flexible_plan`（非 `patent_flexible_plan`）；dsh 工具信任 Sati 的 name 字段。
- **图片模态门禁范围** — `analyze_patent_figure` 按解析出的附图模型路由声明的图片输入做准入（缺失时以错误码 `model_cannot_accept_image` 拒绝）；`search_patent_figure` 读取预建索引，刻意不做门禁（与 Sati 一致，仅门禁 analyze）。
- **化学引擎未移植** — `recognize_chemical_structure` 与 `validate_specification` 的化学表征检查降级为不可用，因为 `@rdkit/rdkit` 是未随包的可选原生依赖。
- **附图/化学引擎未移植** — Sati 的 `src/patent/figure` 与 `src/patent/chemistry` 引擎不在任何 dsh 包内；附图工具仅实现最小 ModelPort 路径与关键词检索，多图一致性、网表可视化与 SMILES 解析延后。
- **知识笔记写入路径** — `knowledge_note_save` 经案件目录 / storage 写入，而非 knowledge.db（其无写 API）；原生写 API 延后。
- **移除语义召回** — `patent_case_search` 仅保留 FTS/LIKE；基于 embedding 的语义召回未移植（dsh 暂无向量基建）。
- **证据规则资产** — `evaluate_evidence` 经 `@deepseek-ai/dsh-patent-rule` 的资产定位解析 `evidence-rules.yaml`；缺失时引擎降级为默认权重。
