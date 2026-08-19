# 专利（Patent）

[English](patent.md) | 中文

专利子系统是 Sati 专利域的原生移植（[计划](../../docs/sati-as-dsh-plugins-plan.md)）：专利数据访问、knowledge.db 查询、执行管线、纯域引擎、模型可见工具集、合规规则门禁与文书渲染。该能力族位于 [packages/patent](../../packages/patent/README.md)，以 `@deepseek-ai/dsh-patent-*` 包运行，无 Sati 进程、无 MCP 桥。

本页记录三个服务接缝（`ctx.patentData`、`ctx.patentKnowledge`、`ctx.patentWorkflow`）与纯库 ModelPort 契约（`@deepseek-ai/dsh-patent-core`）。模型可见工具、规则门禁与文书渲染位于消费包（`dsh-patent-tools`、`dsh-patent-rule`、`dsh-patent-document`、`dsh-tool-literature`、`dsh-methodology`）。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxpatentdata--patentdata"></a>

### `ctx.patentData` — `PatentData`

PatentData service: the patent data seam (ctx.patentData). It exposes the nuo search provider factory and the ego-browser session runner over the injected subprocess service.

```ts cordis-catalog
/**
 * Build a nuo-backed search provider (default: LRU-cached nuo searchPatents).
 * @param options - optional search-function injection.
 * @returns the StageProvider for the workflow atoms' search stage.
 */
createSearchProvider(options?: CreateNuoSearchProviderOptions): StageProvider

/**
 * Build an ego-browser session runner backed by the injected subprocess service.
 * @param options - session options; runner overrides the subprocess-backed default.
 * @returns the ego-browser session.
 */
createEgoSession(options?: EgoSessionOptions): EgoBrowserSession
```

Source: [`packages/patent/patent-data/src/index.ts:58`](../../packages/patent/patent-data/src/index.ts)

<a id="ctxpatentknowledge--patentknowledge"></a>

### `ctx.patentKnowledge` — `PatentKnowledge`

PatentKnowledge service: the knowledge.db query seam (ctx.patentKnowledge). It lazily opens the resolved knowledge.db read-only and delegates to the ported engines; the engines close when the owning fiber unloads.

```ts cordis-catalog
/**
 * Case-law full-text search over documents/chunks/docs_fts (FTS5 BM25 first,
 * LIKE fallback for short queries or a missing FTS index).
 * @param query - the search text.
 * @param options - result cap and doc_type/court/excludeSource filters.
 * @returns the de-duplicated hits in rank order.
 */
caseLawSearch(query: string, options?: CaseLawSearchOptions): CaseLawHit[]

/**
 * Legal full-text search over the law_article documents of knowledge.db.
 * @param query - the search text.
 * @param options - result cap and level filter.
 * @returns the de-duplicated hits in rank order.
 */
legalSearch(query: string, options?: KnowledgeLawSearchOptions): LawSearchResult[]

/**
 * Keyword lookup over the wiki-card directory (title/concept/domain).
 * @param query - the keyword.
 * @param limit - result cap.
 * @returns matching card metadata.
 */
wikiCards(query: string, limit: number = 10): WikiCardMeta[]

/**
 * IPC classification of a patent-domain text.
 * @param text - the patent-domain text to classify.
 * @returns classification results in confidence order.
 */
ipcClassify(text: string): IpcClassification[]

/**
 * Knowledge-graph keyword search with relation expansion.
 * @param query - the keyword.
 * @param options - keyword/expand limits and phrase-or-OR match mode.
 * @returns keyword hits plus expanded neighbors.
 */
kgSearch(query: string, options?: PatentKgSearchOptions): RelevantHit[]

/**
 * Knowledge-graph node lookup by id.
 * @param id - the node id.
 * @returns the node, or undefined when absent.
 */
kgGetNode(id: string): KgNode | undefined

/**
 * Knowledge-graph nodes by type.
 * @param nodeType - the node type to list.
 * @param limit - result cap.
 * @returns the matching nodes.
 */
kgListByType(nodeType: string, limit: number = 50): KgNode[]

/**
 * IPC examination-standard cards for one section.
 * @param section - the IPC section (A-H).
 * @returns the matching cards.
 */
ipcStandards(section: string): IpcStandardCard[]

/**
 * IPC examination-standard cards for one law article.
 * @param article - the law article id (e.g. patent-law-a22.3).
 * @returns the matching cards.
 */
ipcStandardsByArticle(article: string): IpcStandardCard[]

/**
 * Keyword search over the shipped IPC examination-standard cards.
 * @param keyword - the search keyword.
 * @param limit - result cap.
 * @returns the matching cards.
 */
ipcStandardsSearch(keyword: string, limit: number = 10): IpcStandardCard[]
```

Source: [`packages/patent/patent-knowledge/src/index.ts:111`](../../packages/patent/patent-knowledge/src/index.ts)

<a id="ctxpatentworkflow--patentworkflow"></a>

### `ctx.patentWorkflow` — `PatentWorkflow`

PatentWorkflow service: the patent execution pipeline (ctx.patentWorkflow). Approval is an optional seam read via ctx.get('approval'); storage-backed file products are caller-provided stores (see the package README).

```ts cordis-catalog
/**
 * Run a workflow manifest via the ported executor. When an agent is given,
 * the run result is appended to its session as a patent/workflow-run event.
 * @param manifest - the workflow to run.
 * @param wctx - the workflow context (caseId/input + stage state).
 * @param executor - fallback stage executor for stages without an atom.
 * @param options - handlers/atoms/provider/persist/approvalGrants/runId.
 * @param agent - optional agent whose session records the run.
 * @returns the run result (also persisted via options.persist when given).
 */
async runWorkflow( manifest: WorkflowManifest, wctx: WorkflowContext, executor?: StageExecutor, options?: WorkflowRunOptions, agent?: PatentAgent, ): Promise<WorkflowRunResult>

/**
 * Drive a plantask plan through planning → awaiting_approval → executing.
 * The awaiting_approval gate resolves through ctx.get('approval'); without an
 * approval service the plan fails closed (replanning with a feedback) rather
 * than auto-approving. Set options.autoApprove to false to leave the plan
 * pending for an out-of-band approve/reject.
 * @param agent - the agent whose session records the patent/plantask events.
 * @param caseId - case identity keying the tracked pending plantask.
 * @param planSteps - the ordered plan steps to sync into tasks.
 * @param options - autoApprove and approvalReason.
 * @returns the final plantask state plus tasks and the approval outcome.
 */
async runPlantask( agent: PatentAgent, caseId: string, planSteps: string[], options?: PlantaskRunOptions, ): Promise<PlantaskRunResult>

/**
 * Decision entry: approve a pending plantask (resume to executing).
 * Single-session single-case semantics: one pending plantask per caseId;
 * concurrent runs of the same caseId are rejected by runPlantask.
 * @param caseId - the case keying the parked plantask.
 * @returns the final plantask state, tasks, and approval outcome.
 */
approve(caseId: string): PlantaskRunResult

/**
 * Decision entry: reject a pending plantask and roll back to replanning.
 * @param caseId - the case keying the parked plantask.
 * @param feedback - optional rejection feedback driving the replanning transition.
 * @returns the final plantask state, tasks, and approval outcome.
 */
reject(caseId: string, feedback?: string): PlantaskRunResult
```

Source: [`packages/patent/patent-workflow/src/index.ts:71`](../../packages/patent/patent-workflow/src/index.ts)
<!-- END GENERATED cordis-surface -->

## ModelPort 契约

`@deepseek-ai/dsh-patent-core` 是纯 TypeScript 库（无 `ctx` 依赖），承载自 Sati 移植的专利域引擎：atoms `StageProvider`/`StageHandler` 词汇、claim-chart 引擎、宪法规则引擎协议类型与文本工具、以及 IPC 分类器/审查标准查表。其定稿的 ModelPort 契约是 canonical LLM 调用词汇：

```ts type-equiv
/**
 * The patent-domain LLM port: an async iterable of canonical events for one request.
 * Implementations adapt the harness LlmRuntime.stream vocabulary (P2.1).
 */
interface PatentModelPort {
  stream(request: PatentModelRequest, signal?: AbortSignal): AsyncIterable<PatentModelEvent>
}
```

P2.1 适配器 `createLlmModelPort(stream, { provider, model })` 将 dsh `LlmRuntime.stream(options: GenerateOptions): AsyncIterable<StreamChunk>` 词汇映射为 `PatentModelRequest`/`PatentModelEvent` canonical 形态，`collectPortText` 再把端口桥接回依赖 LLM 的 atoms 所用的字符串；provider 选择保留在 harness `ctx.llm` 适配器与 `agent/request` 瀑布（Sati router 不移植）。
