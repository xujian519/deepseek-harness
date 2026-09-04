---
description: "纯 TypeScript 库（无 `ctx` 依赖），承载自 Sati 移植的专利域引擎：atoms `StageProvider`/`StageHandler` 词汇及其 11 个内置 handler、`PatentModelPort` LLM 适配器、双轨 checker 规则引擎、原子化技术问题四检验、证据闭环账本与判定引擎、结构化推理原语、claim-chart 引擎、Pregel 风格图引擎及其四个专利域子图（新颖性/创造性/充分公开/citation-check）、宪法规则引擎协议类型与文本工具、IPC 分类器与审查标准查表、以及持久化/路径助手。"
kind: "package-reference"
---

# @deepseek-ai/dsh-patent-core

[English](README.md) | 中文

## 概述

纯 TypeScript 库（无 `ctx` 依赖），承载自 Sati 移植的专利域引擎：atoms `StageProvider`/`StageHandler` 词汇及其 11 个内置 handler、`PatentModelPort` LLM 适配器、双轨 checker 规则引擎、原子化技术问题四检验、证据闭环账本与判定引擎、结构化推理原语、claim-chart 引擎、Pregel 风格图引擎及其四个专利域子图（新颖性/创造性/充分公开/citation-check）、宪法规则引擎协议类型与文本工具、IPC 分类器与审查标准查表、以及持久化/路径助手。

## 目录

- [Atoms 引擎](#atoms-engines)
- [ModelPort](#modelport)
- [Checker（双轨确定性规则引擎）](#checker-dual-track-deterministic-rule-engine)
- [Problem（原子化技术问题四检验）](#problem-atomic-technical-problem-checks)
- [Evidence（证据闭环账本 + 判定引擎）](#evidence-closed-loop-ledger--judgment-engine)
- [Reasoning（事实黑板 + 三段论）](#reasoning-fact-blackboard--syllogism)
- [Claim-chart 运行时](#claim-chart-runtime)
- [Graph 引擎](#graph-engine)
- [规则协议 + IPC](#rule-protocol--ipc)
- [Model Experience](#model-experience)
- [已知局限与延期工作](#known-limitations-and-deferred-work)

<a id="atoms-engines"></a>
## Atoms 引擎

atoms 层定义工作流阶段词汇：`Atom`/`AtomRegistry`（声明式契约）与 `StageHandler`/`StageHandlerRegistry`（运行时），内置 handler 覆盖 search、keywords、extract、merge、compare、novelty、reasoning、groundedness、draft-claims、approval-gate 与 claim-chart。`registerBuiltinAtoms()` 注册全部 11 个；宿主注入一个 `StageProvider`（`callLLM` 字符串接缝或流式 `llm` 端口，以及 `search`），handler 消费它并在缺失时降级而非抛错。

<a id="modelport"></a>
## ModelPort

`PatentModelPort.stream(request, signal?)` 是 canonical 流式 LLM 词汇。`createLlmModelPort(stream, { provider, model })` 将 harness 的 `LlmRuntime.stream(options: GenerateOptions)` 适配为它，`collectPortText` 再把端口桥接回依赖 LLM 的 atoms 所用的字符串。provider 选择保留在 harness `ctx.llm` 适配器与 `agent/request` 瀑布（Sati router 不移植）。

<a id="checker-dual-track-deterministic-rule-engine"></a>
## Checker（双轨确定性规则引擎）

`RuleEngine` 对分析文本逐条评估域过滤的 `CheckRule`——新颖性单独对比、创造性三步法、侵权全面覆盖、充分公开、说明书 checklist 与 24 条推理模式规则——含同义词扩展与否定检测；`aggregate` 将失败映射为 `pass`/`needs_revision`/`blocked`，`defaultPatentRules()` 注册全部 71 条。

<a id="problem-atomic-technical-problem-checks"></a>
## Problem（原子化技术问题四检验）

`checkAtomic` 对实际解决的技术问题执行四项确定性检验（不绑方案、单一因果、可测效果、手段可反推），`technicalProblemCheck` 将其接入 checker 的 `customCheck` 规则。

<a id="evidence-closed-loop-ledger--judgment-engine"></a>
## Evidence（证据闭环账本 + 判定引擎）

证据层记录工具收据（`Ledger`/`receiptFromToolExecution`），提升为可定位的 `EvidenceSpan`，绑定结论、检测冲突，并运行三性 + 类型特定判定（`EvidenceEngine`）与举证责任/证明标准评估。

<a id="reasoning-fact-blackboard--syllogism"></a>
## Reasoning（事实黑板 + 三段论）

`FactBlackboard` 在推理步骤间共享事实、规则约束与法条判定（软丢弃回溯、锁定保护），`SyllogismBuilder`/`ruleAssertion` 强制每条结论引用黑板事实与法条。

<a id="claim-chart-runtime"></a>
## Claim-chart 运行时

`validateElements`/`validateRowMapping`/`detectGaps`/`validatePinCite` 校验要素网格，`saveClaimChart`/`loadClaimChart`/`renderChartMarkdown` 持久化并渲染（复用共享的 `JsonFileStore` 助手）。

<a id="graph-engine"></a>
## Graph 引擎

`GraphBuilder`/`CompiledGraph` 运行 Pregel 风格超步（BSP）引擎：节点读取深拷贝 state 快照并返回增量片段，按 `Reducer`（last-write-wins/append/union/merge-map/fail-on-conflict）确定性合并。`NodePolicy` 提供重试、超时与副作用处理；`GraphInterruptError` 暂停以等待审批门；`runGraphWithCheckpoints`/`grantApproval` 持久化每超步检查点并续跑。`buildNoveltyGraph`/`buildInventivenessGraph`/`buildEnablementGraph` 组装三性子图（新颖性/创造性/充分公开），含确定性节点、LLM 节点与 checker `rule_gate` 收口；`buildCitationCheckGraph` 为确定性纯函数图，校验结论文本中的每个引用（专利号或 D<id>/对比文件N 标识）均出现在 `prior_art` 状态中；`manifestToGraph` 将 `WorkflowManifest` 桥接为图。

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

### 开发备注

无。

本包不发布 invariant 伴生组件：库是对调用方输入做纯计算，不持有可独立观测并可能分歧的包内持久状态。
