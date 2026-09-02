# Patent

English | [中文](patent.zh.md)

The patent subsystem is the native port of the Sati patent domain ([plan](../../docs/sati-as-dsh-plugins-plan.md)): patent data access, knowledge.db queries, the execution pipeline, the pure domain engines, the model-facing tool set, the compliance rule gates, and document rendering. The family lives in [packages/patent](../../packages/patent/README.md) as `@deepseek-ai/dsh-patent-*` packages and runs with no Sati process and no MCP bridge.

This page documents the three service seams (`ctx.patentData`, `ctx.patentKnowledge`, `ctx.patentWorkflow`) and the pure-library ModelPort contract (`@deepseek-ai/dsh-patent-core`). The model-facing tools, rule gates, and document renderer live in the consumer packages (`dsh-patent-tools`, `dsh-patent-rule`, `dsh-patent-document`, `dsh-tool-literature`, `dsh-methodology`).

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Source: [`packages/patent/patent-data/src/index.ts`](../../packages/patent/patent-data/src/index.ts)

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

Source: [`packages/patent/patent-knowledge/src/index.ts`](../../packages/patent/patent-knowledge/src/index.ts)

<a id="ctxpatentteams--patentteamsservice"></a>

### `ctx.patentTeams` — `PatentTeamsService`

The durable team capability service.

One captain leads one active team at a time; every mutation runs inside the per-team in-process lock and is persisted atomically before any notification fires. Members are continuable subagents whose durable session ids are recorded in the team file, so a team survives harness restarts.

```ts cordis-catalog
/**
 * Create a team: the calling agent becomes its captain. A captain leads one
 * team at a time.
 * @param agent - the calling agent (the new captain).
 * @param name - team name, sanitized into the stable team id.
 * @param description - team purpose / goal.
 * @returns the created team's id, name, and state directory.
 */
async create(agent: Agent, name: string, description?: string): Promise<{ team_id: string team_name: string state_dir: string }>

/**
 * Add a durable continuable member. By default it snapshots the captain's
 * current LLM route and effort; supply provider/model only for an explicitly
 * requested role-specific route. The route resolution and the child spawn
 * run outside the team lock so one add never stalls the team's other tools;
 * admission and persistence revalidate inside the lock, and a spawn that
 * loses a concurrent race is retired before its failure surfaces.
 * @param agent - the calling captain.
 * @param args - member name, role, optional route/effort.
 * @param signal - caller cancellation, forwarded to the spawn.
 * @returns the created member's identity.
 */
async addMember( agent: Agent, args: { name: string role?: string provider?: string model?: string reasoning_effort?: string }, signal: AbortSignal, ): Promise<{ member_name: string member_id: string provider: string model: string reasoning_effort?: string status: string }>

/**
 * Remove a member safely: revoke its current attempts, return all unfinished
 * owned tasks to the shared pending pool, interrupt its live turn, and mark
 * it removed.
 * @param agent - the calling captain.
 * @param name - member name to remove.
 * @param signal - caller cancellation, forwarded to quiescence waits.
 * @returns the removed member and requeued task ids.
 */
async removeMember(agent: Agent, name: string, signal: AbortSignal): Promise<{ member_name: string status: string requeued_tasks: string[] }>

/**
 * Create a task in the team's task list. Tasks can depend on other tasks;
 * a task is only claimable once every dependency is completed.
 * @param agent - the calling captain.
 * @param args - subject, description, dependencies, optional assignee.
 * @param signal - caller cancellation, forwarded to scheduling.
 * @returns the created task's identity.
 */
async createTask( agent: Agent, args: { subject: string description?: string dependencies?: string[] assignee?: string worker?: string }, signal?: AbortSignal, ): Promise<{ task_id: string; subject: string; status: string; assignee?: string; worker?: string }>

/**
 * Atomically retry, reassign, or let the captain take over any unfinished or
 * failed task. The old attempt is revoked before its member is interrupted,
 * so late updates cannot overwrite the new owner.
 * @param agent - the calling captain.
 * @param args - task id, target assignee ("captain" for takeover), reason.
 * @param signal - caller cancellation, forwarded to quiescence waits.
 * @returns the task's post-handoff state.
 */
async reassignTask( agent: Agent, args: { task_id: string; assignee: string; reason?: string }, signal: AbortSignal, ): Promise<{ task_id: string previous_assignee: string assignee: string status: string attempt: number attempt_id?: string }>

/**
 * Claim one ready task for a member (or yourself). A member cannot own a
 * second unfinished task. The returned attempt_id is required for that
 * member's updates and becomes stale after retry/reassignment.
 * @param agent - the calling captain or member.
 * @param args - task id, optional assignee (captain only).
 * @returns the claimed task's capability.
 */
async claimTask( agent: Agent, args: { task_id: string; assignee?: string }, ): Promise<{ task_id: string; status: string; assignee: string; attempt: number; attempt_id?: string }>

/**
 * Update a task status/output. Members must supply the current attempt_id
 * returned by claim_task; stale attempts are rejected after takeover or
 * reassignment. Terminal results are immutable.
 * @param agent - the calling captain or member.
 * @param args - task id, status, output, attempt_id.
 * @param signal - caller cancellation, forwarded to scheduling.
 * @returns the task's updated state.
 */
async updateTask( agent: Agent, args: { task_id: string; status?: string; output?: string; attempt_id?: string }, signal?: AbortSignal, ): Promise<{ task_id: string status: string output?: string attempt: number attempt_id?: string gated?: boolean gate_feedback?: string }>

/**
 * Send a message to the captain or to a teammate. Messages go straight into
 * the recipient's mailbox; when the recipient agent is online the service
 * also schedules live delivery.
 * @param agent - the calling captain or member.
 * @param args - recipient ("captain" or a member name), content, optional from.
 * @param signal - caller cancellation, forwarded to live delivery.
 * @returns the message identity and delivery path.
 */
async sendMessage( agent: Agent, args: { to: string; content: string; from?: string }, signal: AbortSignal, ): Promise<{ message_id: string from: string to: string delivered: 'live' | 'wake' | 'mailbox' }>

/**
 * Team snapshot: members with live activity and tasks with status, assignee,
 * dependencies, and output. Captains also see every team mailbox; members
 * see only their own inbox. Reading as captain acknowledges the captain
 * inbox and schedules idle members.
 * @param agent - the calling captain or member.
 * @param signal - caller cancellation, forwarded to scheduling and the team lock.
 * @returns the full team status payload.
 */
async status(agent: Agent, signal?: AbortSignal): Promise<PatentTeamsStatus>

/**
 * End the team: interrupt all members (best effort), archive the team's
 * state directory (team file, tasks, mailboxes) under `archive/`.
 * @param agent - the calling captain.
 * @param signal - caller cancellation, forwarded to quiescence waits.
 * @returns whether the team was archived.
 */
async delete(agent: Agent, signal: AbortSignal): Promise<{ deleted: boolean; team_name: string }>

/**
 * Read this workspace's archived teams: one team's full record in detail,
 * or a summary row per archived team. Archived records are immutable after
 * {@link PatentTeamsService.delete}; this method only reads them.
 * @param agent - any calling agent in the workspace (the archive is workspace-scoped).
 * @param teamId - optional archived team id to show in detail.
 * @returns the archive listing, or the one team's detail record.
 */
async archive(agent: Agent, teamId?: string): Promise<PatentTeamsArchive>
```

Types: [Agent](core.md)

Source: [`packages/patent/patent-teams/src/service.ts`](../../packages/patent/patent-teams/src/service.ts)

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

Source: [`packages/patent/patent-workflow/src/index.ts`](../../packages/patent/patent-workflow/src/index.ts)
<!-- END GENERATED cordis-surface -->

## The ModelPort contract

`@deepseek-ai/dsh-patent-core` is a pure TypeScript library (no `ctx` dependency) holding the patent-domain engines ported from Sati: the atoms `StageProvider`/`StageHandler` vocabulary, the claim-chart engine, the constitutional rule protocol types and text utilities, and the IPC classifier/standards lookup. Its settled ModelPort contract is the canonical LLM-call vocabulary:

```ts type-equiv
/**
 * The patent-domain LLM port: an async iterable of canonical events for one request.
 * Implementations adapt the harness LlmRuntime.stream vocabulary (P2.1).
 */
interface PatentModelPort {
  stream(request: PatentModelRequest, signal?: AbortSignal): AsyncIterable<PatentModelEvent>
}
```

The P2.1 adapter `createLlmModelPort(stream, { provider, model })` maps the dsh `LlmRuntime.stream(options: GenerateOptions): AsyncIterable<StreamChunk>` vocabulary into `PatentModelRequest`/`PatentModelEvent` canonical form, and `collectPortText` bridges the port back to the string the LLM-dependent atoms use; provider selection stays with the harness `ctx.llm` adapters and the `agent/request` waterfall (the Sati router is not ported).