---
description: "函数插件，将 Sati 专利域工具集原生移植到 DeepSeek Harness。它注册 30 个模型可见工具，覆盖检索、元数据、知识查询、权利要求对照表、通知书解析、TRIZ 矛盾分析、撰写、分析报告、证据判定、规则检查、附图生成以及工作流/计划状态机。每个工具返回可无损 JSON 序列化的规范值，并暴露纯 `output.render` 函数生成模型可见 prose（Sati 没有 render 拆分，这是新的 dsh 契约）。"
kind: "package-reference"
---

# @deepseek-ai/dsh-patent-tools

[English](README.md) | 中文

## 概述

函数插件，将 Sati 专利域工具集原生移植到 DeepSeek Harness。它注册 30 个模型可见工具，覆盖检索、元数据、知识查询、权利要求对照表、通知书解析、TRIZ 矛盾分析、撰写、分析报告、证据判定、规则检查、附图生成以及工作流/计划状态机。每个工具返回可无损 JSON 序列化的规范值，并暴露纯 `output.render` 函数生成模型可见 prose（Sati 没有 render 拆分，这是新的 dsh 契约）。

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
| `claim_chart_build` | 撰写 | `@deepseek-ai/dsh-patent-core` claim-chart 原子 + ModelPort；`mode: infringement` 另给确定性结论（逐被控产品全面覆盖、等同矛盾；`risk` 给出抗辩与补救事实时给出风险等级） |
| `parse_office_action` | 分析 | 确定性 `@deepseek-ai/dsh-patent-core` 通知书解析器（驳回类型、引用文献与相关性、涉及权项、审查员论点） |
| `triz_contradiction_analysis` | 分析 | `@deepseek-ai/dsh-patent-core` TRIZ 引擎（矛盾组装 + 经 `@deepseek-ai/dsh-methodology` 的矛盾矩阵落格）+ ModelPort 负责识别；产出发明人侧的方案方向与交底书参数缺口 |
| `draft_claims` | 撰写 | 确定性 |
| `draft_specification` | 撰写 | 确定性 |
| `validate_specification` | 质量 | 确定性 |
| `evaluate_evidence` | 证据 | `@deepseek-ai/dsh-patent-core` 证据引擎 |
| `rule_check` | 质量 | `@deepseek-ai/dsh-patent-rule` 规则引擎 |
| `analyze_patent_figure` | 分析 | 经 `FigureAnalysisEngine` 走视觉 ModelPort（Config.figureAnalysisMode：`single`=一次调用，默认；`two-step`=结构抽取+说明生成两次调用）；按附图模型做图片输入门禁 |
| `search_patent_figure` | 检索 | 附图索引关键词检索（索引由 `analyze_patent_figure` 写入，见 Config.figureIndexFile） |
| `generate_patent_figure` | 撰写 | 附图生成：Graphviz DOT 通路（流程图/状态图/框图/层级图/模板/原始 DOT）+ SVG 直绘通路（电路图/曲线图/剖视图/时序图/外观设计视图排布）；SVG 默认内置 `@viz-js/viz` WASM，png/pdf 与 `figureRenderer: 'cli'` 走 `dot` CLI（Config.graphvizExecutable / figureOutputDir / dotFont）；提交规格 page/dpi/margin/orientation；框图/层级图 SVG 默认引线标号；`panels` 多面板输出与 `figure_family` 跨图标号续接；`target_office` 按法域落版为固定幅面附图页并核算尺寸；返回图面用语检查警告；结果写入附图索引（Config.figureIndexFile） |
| `add_patent_figure_references` | 撰写 | SVG 标号后处理：内嵌模式按 `<text>`/`<tspan>` 文本匹配追加 `(标号)`；`leader_lines: true` 在部件轮廓外侧绘制引线并放置独立标号 |
| `generate_structure_figure` | 撰写 | FreeCAD TechDraw 结构线稿：经宿主 `freecadcmd` 子进程把 STEP/IGES/BREP 模型投影为黑白多视图 SVG（`iso`/`front`/`rear`/`top`/`bottom`/`left`/`right`，Config.freecadExecutable）；件号锚定到真实 3D 顶点的投影；默认关闭（Config.structureFigureEnabled）且 CAD 隔离；支持单模型文件或目录批量（目录批量与 `callouts` 互斥：件号 3D 锚点仅对单个模型有效）；`target_office` 按法域落版每个视图 SVG；结果写入附图索引（`figureType: 'structure'`） |
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
| `graphvizRenderTimeoutMs` | number | `60000` | CLI `dot` 单次渲染的超时；WASM 引擎为同步渲染，不受它约束。 |
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
| `freecadExecutable` | string | 自动探测 | `generate_structure_figure` 的 `freecadcmd` 可执行路径覆盖；探测顺序：覆盖值 → `DSH_FREECAD_CMD` → 平台候选路径 → `PATH`。 |
| `freecadRenderTimeoutMs` | number | `120000` | `generate_structure_figure` 单次投影的超时；FreeCAD 冷启动比 `dot` 慢，故默认值翻倍。 |
| `structureFigureEnabled` | boolean | `false` | `generate_structure_figure` 门禁：CAD 隔离、默认关闭；门禁未开启时工具在执行期以 `setup_required` 显式报错。 |
| `structureFigureScale` | number | `1` | `generate_structure_figure` 的 TechDraw 投影比例默认值（per-call `scale` 覆盖）。 |
| `structureFigureViews` | string[] | `['iso','front','top','right']` | `generate_structure_figure` 的缺省视图集（per-call `views` 覆盖）；每一项必须是受支持视图名（`iso`/`front`/`rear`/`top`/`bottom`/`left`/`right`），未知名称在配置加载时被拒绝。 |

有两项子进程预算保持固定、不做配置：SIGTERM→SIGKILL 升级宽限（3 秒），因为 `dsh-patent-data` 的 subprocess runner 与它共用，改一处就破坏收尾对称；单流输出上限（100 000 字节），因为它约束渲染器内存。导出的 `probeGraphviz`/`probeFreeCad` 由调用方自带超时（`DEFAULT_GRAPHVIZ_PROBE_TIMEOUT_MS`/`DEFAULT_FREECAD_PROBE_TIMEOUT_MS`）；插件自身不探测，因此没有可配置的探测预算。

未设置 `provider`/ `model` 时，LLM 消费工具照常注册，但调用时 fail loud（`setup_required`）。知识类工具需要经 `patent-knowledge:install` 准备的 knowledge.db；缺失时 fail loud 并给出安装引导。

<a id="model-experience"></a>
## Model Experience

### 工具 schema

#### 模型所见

30 个已注册工具定义（见上表），各含描述、参数 schema 与将规范结果渲染为 Markdown prose 的 `output.render`。精确描述与参数见生成的[`patent-tools` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-patent-tools)。

#### Token 影响

每个已注册工具在每次请求产生固定定义开销；结果文本随数据变化，仅到压缩时才会重发。本包不注册任何 system-prompt 段，因此无额外固定 prompt 开销。

#### KV Cache 影响

在已注册工具集与其描述不变时前缀稳定；修改配置或注册集会使工具定义偏移，并从该点起失效复用。

<a id="known-limitations-and-deferred-work"></a>
## 已知局限与延后工作

- **`render_patent_document` 归属** — 该工具由 `@deepseek-ai/dsh-patent-document` 注册，而非本包；本包仅再导出其工厂。
- **`flexible_plan` 命名** — Sati 的 `patentFlexiblePlanTool.ts` 声明名为 `flexible_plan`（非 `patent_flexible_plan`）；dsh 工具信任 Sati 的 name 字段。
- **图片模态门禁范围** — `analyze_patent_figure` 把附图发送给解析出的附图模型路由，并按该路由声明的图片输入做准入（缺失时以错误码 `model_cannot_accept_image` 拒绝）；图片字节经 harness 附件服务入库后以持久引用随请求发送，附件服务或路由缺失时以 `setup_required` 显式报错。`search_patent_figure` 读取索引，刻意不做门禁（与 Sati 一致，仅门禁 analyze）。索引由 `analyze_patent_figure` 写入 Config.figureIndexFile；索引缺失或为空时返回零命中并附引导提示，而非报错。
- **化学引擎未移植** — `recognize_chemical_structure` 与 `validate_specification` 的化学表征检查降级为不可用，因为识别流水线（VLM 两步法、name→SMILES、RDKit 校验）尚未移植：RDKit 只是其中缺失件之一，不是唯一一件，因此无论宿主机装了什么，该工具都返回不可用结果。
- **附图/化学引擎未移植** — Sati 的 `src/patent/figure` 与 `src/patent/chemistry` 引擎不在任何 dsh 包内；附图工具仅实现最小 ModelPort 路径与关键词检索，附图/化学索引存储（`figure/index-store`、`chemistry/index-store`）已接线写+读。网表可视化与 SMILES（RDKit）解析延后。
- **附图生成范围** — `generate_patent_figure` 的 SVG 默认经内置 `@viz-js/viz` WASM 引擎渲染（Config.figureRenderer）；png/pdf 与 `figureRenderer: 'cli'` 走 `dot` 子进程，后者仍是系统依赖——这些路径缺失时 fail loud 并给出安装引导。该 WASM 渲染是同步调用、一旦开始无法中断，故输入规模受限：原始 DOT 超过 64 000 个字符（分层/树形引擎 `dot`/`circo`/`twopi`）或 20 000 个字符（强制导向引擎 `neato`/`fdp`/`sfdp`）同样改走 `dot` 子进程，结构化图元素上限 200 个（节点 + 边，嵌套节点计入）——超出即 `invalid_tool_input`，请拆分为 `panels`。`raw_dot` 必须自包含：`image`/`shapefile`/`fontpath` 等文件引用属性被拒绝，因为子进程路径会按宿主文件系统解析它们。引线标号对框图/层级图 SVG 默认开启（流程图与 `raw_dot`/`template` 默认关闭；per-call `leader_lines` 覆盖）：标号置于部件外侧并以 `<line>` 引线相连，替代内嵌标签后缀；非 SVG 格式保持内嵌标号并返回警告。放置时按所在组的平移把节点坐标换算到根坐标系，跳过会压盖已绘边线、箭头或边标签的方向，并在标号或引线越出根元素声明画布时扩展 `viewBox`/`width`/`height`——画布之外的 SVG 内容不会渲染。节点位于缩放/旋转/翻转的组内时无法这样定位：其标号内嵌进部件名并给出警告。每次生成后按《专利法实施细则》第二十一条与《专利审查指南》第一部分第一章 4.3 返回图面用语检查警告：非必需注释（注释前缀、正文引用、尺寸标注、比例标注、句末标点）、非中文词语（缩写与数字符号除外）、图号入图、数字与括号引号连用、非阿拉伯数字标号；检查只提示、不改写输入。矢量图型（`circuit`/`plot`/`cross_section`/`sequence_diagram`/`appearance_view`）不过 Graphviz，由 `vector-figure-build` 直接产出毫米坐标的 SVG 片段：电路图按网格放置符号并正交走线、T 形结点画实心连接点；曲线图画坐标轴与刻度并在图上禁用比例说明；剖视图画 45° 剖面线（相邻件方向相反或间距不等）与剖切位置符号；时序图画生命线与消息箭线；外观设计视图按第一角（或第三角）排布六面视图、统一比例并在每个视图正下方标注视图名称。`panels` 渲染多面板组合（`fig1A`/`fig1B`，…）并共用同一标号系列；per-call `figure_family` 对附图索引中同一家族记录的组件跨代续接标号——未声明家族即逐图独立编号，索引中无 `figureFamily` 的条目永不参与。`semantic` 彩色填充仅当色彩承载技术内容时使用（依据《专利审查指南》第一部分第一章 4.3，2023 修订；默认 `grayscale` 黑白）；`raw_dot`/`template` 模式无结构化组件/连接还原（索引条目残缺）。
- **附图提交规格与落版** — `figure/office-profile` 固化了已核实的目标法域数值：中国 A4 与 25/25/15/15 毫米页边距、图号「图N」（两幅以上才编号，依据指南第一部分第一章 4.3）、附图片页码；PCT 的可用绘图区与 0.32 厘米最短字高（Rule 11.6(c)、11.13(h)）、图号「Fig. N」、不得着色（11.13(a)）、页码「1/3」；USPTO 的页边距与最短字高（37 CFR 1.84(g)、1.84(p)(3)）、图号「FIG. N」。给定 `target_office` 时 `figure/submission-page` 把图形落版为固定幅面的附图页（图号画在图形正下方、页码画在版心底部），`figure/compliance` 再核对彩色策略（PCT 直接拒绝彩色；美国实用申请彩色需呈请）、多幅图未编号与落版字高，并返回落版缩放比与尺寸。落版仅支持 SVG：Graphviz 的 `page`/`size`/`margin` 属性只影响图形自身画布（本机实测 Graphviz 15.1.1：`page` 对 svg/png/pdf 不产生幅面，`size` 只在超限时按比例缩小，`margin` 只加空白），png/pdf 因此返回「未落版」警告而非静默输出不合幅面的图。EPO 未列入档案：EPC Rule 46/47 与 EPO 审查指南的一手文本在本次核实时无法取得（epo.org 返回 403）。「缩小到三分之二仍可辨」只报出缩小后的实测字高、不设阈值告警，因为三个法域都没有给出该情形下的数值下限。
- **两步分析降级** — `figureAnalysisMode: 'two-step'` 下，结构抽取趟不可解析时按空组件返回尽力结果并附警告，跳过说明生成趟；图片门禁与结果形状与 `single` 一致。
- **结构线稿范围** — `generate_structure_figure` 需要宿主安装 FreeCAD 1.1+（`freecadcmd`），且在 `structureFigureEnabled: true` 前保持关闭；门禁未开启或可执行文件缺失时以 `setup_required` 显式报错并给出安装引导，绝不静默降级为示意图。每个请求视图建单个 `TechDraw::DrawViewPart`（不用 `DrawProjGroup.addProjection`，后者在 FreeCAD 1.1 报 TypeError），经 `TechDraw.viewPartAsSvg` 取几何片段——片段不含模板边框、标题栏或图号，符合《专利审查指南》第一部分第一章 4.3 对线条的要求；两幅以上附图的「图N」由 `target_office` 落版阶段写在图形正下方（该条要求编号标注在相应附图的正下方）。再包成独立黑描边 SVG。件号在 Python 脚本内经 `DrawViewPart.projectPoint` 锚定，与片段共享同一坐标帧，并沿外向偏移绘制引线。子进程的 HOME/临时/缓存目录重定向到输出目录内（尽力而为；macOS 下 FreeCAD 缓存路径不随 HOME 迁移）；脚本把文档 `TransientDir` 锚定到输出目录下的子目录，因为 TechDraw 以该属性为基准拷贝页面模板——拒绝写 FreeCAD 缓存目录的沙箱会让它保持为空、把该拷贝解析到 `/`，从而让整次渲染失败；成功判定只看退出码加 manifest 存在，因为 `freecadcmd` 对偏好/缓存写失败仅告警、非致命。输出 SVG 经与 Graphviz 路径同一的 `assertSafeSvg` 门禁，结果以 `figureType: 'structure'` 写入附图索引；给定 `target_office` 时每个视图 SVG 落版到该法域的 A4 幅面并返回落版尺寸，未给 `caption` 时不落图号——一个模型的多个视图最终如何编号由调用方按整案附图顺序决定。目录 `model_path` 对每个受支持模型出一图（排序、图号递增），但与 `callouts` 同用会被 `invalid_tool_input` 拒绝，因为件号 3D 锚点是模型专属的；`scale` 必须是正有限数、`figure_number` 必须是正整数，二者在渲染前校验。
- **知识笔记 / PDF 下载接线** — `knowledge_note_save` 将笔记写入 Config.noteDir 下的文件（knowledge.db 原生写 API 延后）；`patent_pdf_download` 在每次调用时对延迟绑定的 `ctx.get('patentData')` lookup 解析批量运行器（`createDownloadChannelRunner`）：服务在场走统一 ego 栈（经 `ctx.patentData.createEgoSession()`），服务缺席或浏览器不可用则退回抓取每页 CDN 链接的无浏览器通道，由工具自身的 fetch 兜底按带界重试/退避（超时、重试、Retry-After）下载。lookup 之所以按调用，是因为 `patent-data` 声明 `inject: ['subprocess']`，其激活晚于本包的 apply；见 [服务解析决策记录](../../../.agents/notes/implemented/bug-fix/2026-09-21-patent-pdf-download-resolves-service-per-call.zh.md)。browseros-neo、playwright 与 browser-use 参与探测但从不参与下载。
- **移除语义召回** — `patent_case_search` 仅保留 FTS/LIKE；基于 embedding 的语义召回未移植（dsh 暂无向量基建）。
- **证据规则资产** — `evaluate_evidence` 经 `@deepseek-ai/dsh-patent-rule` 的资产定位解析 `evidence-rules.yaml`；缺失时引擎降级为默认权重。
- **TRIZ 分析属发明人侧且有意的窄** — `triz_contradiction_analysis` 一次只读一篇交底书：不构建问题依赖图、不度量幻觉率、不做跨文档合并。它给出的矛盾是工程参数之间的设计层取舍，因此绝不进入审查意见答复或无效论证——三步法第二步的技术问题表述仍归 `checkAtomic` 与创造性子图。证据无法在交底书原文定位的矛盾被丢弃并计数，而不是照报；矩阵中没有推荐原理的格报成空缺，而不是从相邻格补一个。

### 开发备注

无。

本包不发布 invariant 伴生组件：专利工具除常规 tools/result 日志外不写入包属持久会话事件；workflow-run 与 plantask 事件归 dsh-patent-workflow 所有。
