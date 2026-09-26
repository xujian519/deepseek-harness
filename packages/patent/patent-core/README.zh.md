---
description: "纯 TypeScript 库（无 `ctx` 依赖），承载自 Sati 移植的专利域引擎：atoms `StageProvider`/`StageHandler` 词汇及其 14 个内置 handler、`PatentModelPort` LLM 适配器、双轨 checker 规则引擎、原子化技术问题四检验、TRIZ 矛盾分析（发明人侧的补强缺口与方案方向）、证据闭环账本与判定引擎、推理原语、claim-chart 引擎、权利要求撰写自检（单一性、覆盖矩阵）、数值范围新颖性确定性核验、程序文书解析（审查意见通知书、无效/复审/外观设计理由）、答复计划与复审准备段、侵权确定性内核（全面覆盖、等同一致性、加权风险分级）、Pregel 风格图引擎及其四个专利域子图（新颖性/创造性/充分公开/citation-check）、规则引擎协议类型与文本工具、IPC 分类器与审查标准查表、以及持久化/路径助手。"
kind: "package-reference"
---

# @deepseek-ai/dsh-patent-core

[English](README.md) | 中文

## 概述

纯 TypeScript 库（无 `ctx` 依赖），承载自 Sati 移植的专利域引擎：atoms `StageProvider`/`StageHandler` 词汇及其 14 个内置 handler、`PatentModelPort` LLM 适配器、双轨 checker 规则引擎、技术问题四检验、TRIZ 矛盾分析（发明人侧的补强缺口与方案方向）、证据账本与判定引擎、推理原语、claim-chart 引擎、权利要求撰写自检、数值范围新颖性核验、程序文书解析（审查意见通知书、无效/复审/外观设计理由）、答复计划与复审准备段、侵权确定性内核（全面覆盖、等同一致性、风险分级）、Pregel 风格图引擎及其四个专利域子图、规则协议类型与文本工具、IPC 分类器与审查标准查表、以及持久化/路径助手。

## 目录

- [Atoms 引擎](#atoms-engines)
- [ModelPort](#modelport)
- [Checker（双轨确定性规则引擎）](#checker-dual-track-deterministic-rule-engine)
- [Problem（原子化技术问题四检验）](#problem-atomic-technical-problem-checks)
- [TRIZ 矛盾分析（发明人侧）](#triz-contradiction-analysis-inventor-side)
- [Evidence（证据闭环账本 + 判定引擎）](#evidence-closed-loop-ledger--judgment-engine)
- [Reasoning（事实黑板 + 三段论）](#reasoning-fact-blackboard--syllogism)
- [Claim-chart 运行时](#claim-chart-runtime)
- [权项覆盖自检](#claim-coverage-checks)
- [数值范围新颖性核验](#numeric-range-novelty-check)
- [程序文书解析](#notice-parsing)
- [答复准备](#response-preparation)
- [侵权确定性内核](#infringement-kernel)
- [Graph 引擎](#graph-engine)
- [规则协议 + IPC](#rule-protocol--ipc)
- [Model Experience](#model-experience)
- [已知局限与延期工作](#known-limitations-and-deferred-work)

<a id="atoms-engines"></a>
## Atoms 引擎

atoms 层定义工作流阶段词汇：`Atom`/`AtomRegistry`（声明式契约）与 `StageHandler`/`StageHandlerRegistry`（运行时），内置 handler 覆盖 search、keywords、extract、merge、compare、novelty、reasoning、groundedness、draft-claims、approval-gate 与 claim-chart，另有为 OA 答复、无效、侵权三类作业新增的三个不调用模型的确定性原子：`oa-parse`（通知书解析）、`grounds`（程序理由识别）与 `coverage`（全面覆盖与等同核验）。`registerBuiltinAtoms()` 注册全部 14 个；宿主注入一个 `StageProvider`（`callLLM` 字符串接缝或流式 `llm` 端口，以及 `search`），handler 消费它并在缺失时降级而非抛错。

<a id="modelport"></a>
## ModelPort

`PatentModelPort.stream(request, signal?)` 是 canonical 流式 LLM 词汇。`createLlmModelPort(stream, { provider, model })` 将 harness 的 `LlmRuntime.stream(options: GenerateOptions)` 适配为它，`collectPortText` 再把端口桥接回依赖 LLM 的 atoms 所用的字符串。provider 选择保留在 harness `ctx.llm` 适配器与 `agent/request` 瀑布（Sati router 不移植）。端口另带 `route`（哪条 provider/model 作答）与 `bindSession(sessionId)`——后者重新绑定端口，使每次请求都带上会话身份；工具在函数体内调用模型时先绑定会话，调用才有归属、才可被记录。

<a id="checker-dual-track-deterministic-rule-engine"></a>
## Checker（双轨确定性规则引擎）

`RuleEngine` 对分析文本逐条评估域过滤的 `CheckRule`——新颖性单独对比、创造性三步法、侵权全面覆盖、充分公开、说明书 checklist 与 24 条推理模式规则——含同义词扩展与否定检测；`aggregate` 将失败映射为 `pass`/`needs_revision`/`blocked`，`defaultPatentRules()` 注册全部 71 条。

<a id="problem-atomic-technical-problem-checks"></a>
## Problem（原子化技术问题四检验）

`checkAtomic` 对实际解决的技术问题执行四项确定性检验（不绑方案、单一因果、可测效果、手段可反推），`technicalProblemCheck` 将其接入 checker 的 `customCheck` 规则。

<a id="triz-contradiction-analysis-inventor-side"></a>
## TRIZ 矛盾分析（发明人侧）

`extractTrizContradictions(port, text, { focus })` 用一次模型调用识别技术矛盾（改善某工程参数的同时牺牲另一工程参数）与交底书点名却未量化的工程参数（缺现状值／目标值／单位／测量口径）。`buildTrizAnalysis(extraction, sourceText)` 确定性组装结果：只接受 1-39 的整数参数编号，逐对落格到 `@deepseek-ai/dsh-methodology` 随包的 39x39 矛盾矩阵（对角格是物理矛盾，空格是转录缺口），参数与原理名称一律取随包资产而非模型输出，并**丢弃证据无法在交底书原文中逐字定位的矛盾**、计入丢弃数。

产物属发明人侧：候选方案方向与交底书补强缺口清单。矛盾对不是三步法第二步的技术问题表述——后者必须相对区别特征确定且不含解决手段（`checkAtomic`），把矛盾填进该字段会直接违反该检验。

<a id="evidence-closed-loop-ledger--judgment-engine"></a>
## Evidence（证据闭环账本 + 判定引擎）

证据层记录工具收据（`Ledger`/`receiptFromToolExecution`），提升为可定位的 `EvidenceSpan`，绑定结论、检测冲突，并运行三性 + 类型特定判定（`EvidenceEngine`）与举证责任/证明标准评估。

<a id="reasoning-fact-blackboard--syllogism"></a>
## Reasoning（事实黑板 + 三段论）

`FactBlackboard` 在推理步骤间共享事实、规则约束与法条判定（软丢弃回溯、锁定保护），`SyllogismBuilder`/`ruleAssertion` 强制每条结论引用黑板事实与法条。

<a id="claim-chart-runtime"></a>
## Claim-chart 运行时

`validateElements`/`validateRowMapping`/`detectGaps`/`validatePinCite` 校验要素网格，`saveClaimChart`/`loadClaimChart`/`renderChartMarkdown` 持久化并渲染（复用共享的 `JsonFileStore` 助手）。

<a id="claim-coverage-checks"></a>
## 权项覆盖自检

`checkClaimUnity` 判定一组权利要求的单一性（A31.1）：清洗独立权利要求中的结构样板词后逐对比较字符重叠、Jaccard 与 bigram 余弦，取最弱对。`score` 即最弱对相似度的百分数，`grade` 与判定阈值同线（不低于 0.8 为 `good`，不低于 0.6 为 `fair`，低于 0.6 为 `poor`），任一对低于 0.6 相似度阈值时 `hasUnity` 为 false。阈值与权重是自上游 `unity.yaml` 规范继承的启发式口径、不是法条数值；结论服务于撰写自检，法律判断仍由代理师作出。

`checkEmbodimentCoverage` 生成权项—实施例覆盖矩阵：每条条目给出权利要求标识、其技术特征与支持它的实施例引用，本模块按整串出现判定 full/partial/none。调用方给出的覆盖度判读不是输入——结论只来自这两列事实；一条特征都不给的条目按非法驳回（`features 为空`），不报 full 也不报 none，因为两种读法都是空真的。断档仅在全部条目编号合法时推断，因为非法条目本应占据的编号未知。特征数按去重后计算，重复特征不再虚增已覆盖数（上游实现按原始列表计数）。

<a id="numeric-range-novelty-check"></a>
## 数值范围新颖性核验

`analyzeNumericRanges` 从权利要求与对比文件文本提取数值，按区间相交做确定性判定（数值范围重叠或存在共同端点即破坏新颖性；数值点严格落在对比文件范围内且无共同端点则不破坏），给出 `overlapped`/`inside_without_endpoint`/`no_overlap`/`inconclusive`。区间允许单位写在连接符之前（`20℃至90℃`、`5mg-10mg`）并读作一个区间；连接符与单位词表与 `validate_specification` 共用（`src/novelty/numeric-vocabulary.ts`），两条路径因此不会对同一文本读出不同结果，而该校验额外要求尾随单位（它要用同单位单值比对端点）。只有后接已识别单位的发现算强发现并参与判定；汉字单位表是封闭的，否则"数值 + 两个汉字"的贪心匹配会把"任一""公开"当成单位、把权项编号抬成参数。`crossCheckNumericVerdict` 与 LLM 轨的结论对照并标记一致性；任一具体分歧都记为 `disagree` 并在摘要中要求复核（上游只标记其中一个方向）。新颖性子图的 `numeric_range` 节点把该轨与 LLM 轨并行运行，并把 `numeric_range_verdict`、`numeric_range_agreement`、`numeric_range_deterministic` 写入 state，使 LLM 不可用时确定性结论仍然保留。

<a id="notice-parsing"></a>
## 程序文书解析

`parseOfficeAction` 只用关键词表与正则把审查意见通知书正文转成结构化事实：所援引的驳回类型（去重，按首次出现位置排序）、引用文献（相关性类别取文献号之后紧邻位置的标注，权项取同句共现）、正文提到的权项编号（`权利要求1至3`、`第1-5项` 两类区间展开为逐个编号，故 `第2-3页` 一类页段区间不入表）与至多五条审查员论点句。正文指代本申请自身的文献号（`本申请公开号CN…`、`CN…（本申请）`）不是引用文献，不入文献清单。`identifyInvalidationGrounds`、`identifyReexaminationGrounds`、`identifyDesignGrounds` 分别读三类程序的理由表——无效五条、复审六条（含实用新型客体）、外观设计三条（专利法第 23 条各款）——每条带法条依据与中文标签；`detectPatentSubject` 报出正文写明的专利权类型，无法判定时返回 `undetermined` 而不默认按发明处理。与上游的差异：相关性只在有标注时给出（上游以 `A` 兜底，等于把"仅一般背景技术"当成已认定的事实）、引用文献的权项取同句共现而非恒空、论点按码位而非字节截取、补入"公开不充分"（上游表只收"公开充分/充分公开/能够实现"，最常见的写法漏检）、理由表无命中时返回空数组而不造一条新颖性默认理由、实用新型不剔除创造性理由（上游删除该理由且未给出依据）。本模块不产出法律结论。

<a id="response-preparation"></a>
## 答复准备

`buildResponsePlan(notice, { independentClaims })` 把通知书解析结果拼成答复骨架：每条驳回理由一段，带答复策略（争辩、修改或组合）与该段必须逐项回应的段落；修改类理由按（理由 × 通知书提到的权项）逐权项出一行修改对照，每行带修改动作（按独立/从属权利要求取值）与法条依据。`REJECTION_STRATEGY`、`REJECTION_AMENDMENT_ACTIONS`、`REJECTION_SECTIONS`、`REJECTION_BASIS` 是按驳回类型穷尽的闭集表，`summarizeStrategies` 渲染 `创造性→争辩、不清楚→修改` 摘要行。通知书无法确定的事报缺口而不假设：未识别到驳回条款、修改类理由未抽出任何权项编号、修改类驳回未点到任何独立权利要求。`buildReexaminationPreparation(findings, { oralHearing })` 给出复审各准备段：技术特征对比表与修改前后对比表的列、A33 不超范围的必填项与依据，以及仅在安排口审时才出现的按理由分组的合议组质疑预演与四阶段口审时间线。与上游的差异：修改对照表逐权项出行（上游只按受影响权项中最靠前的编号判动作，从属权利要求的动作从不生效）、修改对象不可知时报缺口而不兜底权利要求 1、A33 段不区分驳回决定是否提出该理由（复审阶段仍可能提交修改替换页）、对比表只给列不出占位行、口审两段挂在显式开关上且默认关闭——上游的 `oralHearing` 从未被置真，两段是不可达代码。

<a id="infringement-kernel"></a>
## 侵权确定性内核

`deriveAllElementsCoverage(rows, targetId, elements)` 对 claim-chart 的行级映射判定全面覆盖：字面覆盖的要素、字面覆盖依赖权利要求解释的要素、只有等同映射覆盖的要素，以及两者皆无的要素（缺任一要素即不落入）。`findEquivalenceContradictions(rows, triplets)` 核验图表与另给的等同认定记录：按等同落格却无认定记录、同一要素与目标有两条记录、认定记录否认等同、认定等同但手段/功能/效果三项均判不同、认定等同同时认定仍需创造性劳动、以及认定等同却未落到图表上。`scoreInfringement(input, weights?)` 给出评分：五个维度按固定次序加权求和，按 0.7 与 0.4 在权重量程上的比例定风险等级，阈值随结果一并返回。与上游的差异：字面与等同覆盖合成一个维度（上游分列加权，字面全覆盖只有 0.25 分而被评为低风险）、删除 `strategy_viability` 维度（它数的是助手自己给的建议的优先级）、赔偿上限改为调用方给出的比例而非硬编码的一千万元、求和次序固定而不随 Go map 迭代变化、权重非法或比例越界即抛错而不静默出分。

<a id="graph-engine"></a>
## Graph 引擎

`GraphBuilder`/`CompiledGraph` 运行 Pregel 风格超步（BSP）引擎：节点读取深拷贝 state 快照并返回增量片段，按 `Reducer`（last-write-wins/append/union/merge-map/fail-on-conflict）确定性合并。`NodePolicy` 提供重试、超时与副作用处理；`GraphInterruptError` 暂停以等待审批门；`runGraphWithCheckpoints`/`grantApproval` 持久化每超步检查点并续跑。`buildNoveltyGraph`/`buildInventivenessGraph`/`buildEnablementGraph` 组装三性子图（新颖性/创造性/充分公开），含确定性节点、LLM 节点与 checker `rule_gate` 收口；新颖性子图的 `numeric_range` 节点在 LLM 轨旁并行运行数值范围确定性轨；`buildCitationCheckGraph` 为确定性纯函数图，校验结论文本中的每个引用（专利号或 D<id>/对比文件N 标识）均出现在 `prior_art` 状态中；`manifestToGraph` 将 `WorkflowManifest` 桥接为图。

<a id="rule-protocol--ipc"></a>
## 规则协议 + IPC

宪法规则引擎协议类型（`RuleSeverity`/`RuleAction`/`RuleCheck`/`ConstitutionalRule`/...）与 `hasNegationContext`/`parseCnNumber` 文本工具在此落地，供 P3.1/P4.1 规则门禁使用。IPC 分类器（`classifyIpc`/`classifyIpcTop`）与 `ipc-standards.yaml` 审查标准加载器以纯查表形式随包分发。

<a id="model-experience"></a>
## Model Experience

None, as The library is pure computation for the workflow and tool layer; every model-facing schema and result is owned by its consumers.

#### KV Cache effect

Independent; the library contributes no model-visible content, so it never populates or invalidates a reusable KV-cache prefix.

<a id="known-limitations-and-deferred-work"></a>
## 已知局限与延期工作

- **纯库、无 `ctx`** — 该包不注册任何内容；由宿主或消费方将引擎组装进工作流（P3.1）与工具（P3.2）层。
- **ModelPort 适配器需要注入的 stream** — `createLlmModelPort` 适配调用方提供的 `LlmRuntime.stream`；patent-core 不持有 provider 选择或活 `ctx.llm`。
- **证据规则资产暂存桩** — `loadEvidenceRulesEngine(ruleDirs?)` 接受显式目录，未传时返回默认权重引擎；真实规则包由 `dsh-patent-rule`（P4.1）解析。
- **IPC 数据以资产打包** — `ipc-standards.yaml` 随包发布在 `assets/`，经 `import.meta.url` 从源码与构建后 lib 均可解析。
- **检查点仍为文件存储** — `JsonFileCheckpointStore` 经共享的 `JsonFileStore` 持久化每超步检查点；`ctx.storage` 接缝随工作流集成（P3.1）落地。
- **图引擎为纯计算** — 超步引擎与各域子图在进程内运行、无 `ctx`；LLM 与检索能力经注入的 `StageProvider` 提供。
- **单一性是相似度指标** — 评分与评级来自对清洗后权利要求文本的加权词法相似度；本模块不给出法律结论，`fair` 或 `poor` 表示该组权利要求需要代理师复核，而不是直接判定为不满足单一性。
- **程序文书解析是词法判定** — 理由表沿用上游的宽词（清楚、支持），命中只表示文书写到了该条款，不表示该理由已被实质论证；相关性与逐篇权项取自文献号周围的文本，不是审查员的权威对应。
- **答复准备只排计划、不作论证** — 计划说明哪些理由必须答复、哪些权项必须修改、通知书留下了哪些缺口；是否要求优先权、具体修改文本与理由成立与否由代理师决定。
- **侵权的等同结论由调用方给出** — 手段/功能/效果的认定是输入，本模块只核对其与图表是否自洽；它既不判断是否构成等同，也不以未公开的赔偿上限替换调用方给出的比例。
- **数值提取只识别封闭的单位表** — 拉丁/符号单位加一份列明的汉字单位表；用其他单位（或无单位）书写的数值只算弱发现、不能改变结论，因此该核验偏向返回 `inconclusive`。
- **LLM 对照依赖 `verdict` 字段** — 数值范围节点从 LLM JSON 读取 `verdict`；响应缺少该字段时对照结论保持 `n_a`，不做猜测。

### 开发备注

无。

本包不发布 invariant 伴生组件：库是对调用方输入做纯计算，不持有可独立观测并可能分歧的包内持久状态。
