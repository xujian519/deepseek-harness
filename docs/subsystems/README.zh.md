# 子系统

[English](README.md) | 中文

每个子系统一页，覆盖 DeepSeek Harness 的全部子系统：它是什么、它操作哪些数据结构，以及——当它由某个 `ctx` 服务或事件作用域支撑时——一段生成的 **Cordis API** 小节，承载其服务与事件参考。本目录与 [architecture.md](../architecture.zh.md) 互补：后者描述跨子系统的*行为*（服务映射、会话/轮次/步骤生命周期、事件分类体系）；这里的每一页是单个子系统词汇与接线的参考。

| 页面 | 负责内容 |
|---|---|
| [core.md](core.zh.md) | how `packages/core` controls the agent loop: the package-by-package loop description, agent creation and ownership (`AgentHandle`), the `Agent` handle's delivery/cancellation/interception contracts, and the repo-wide type patterns (`…Map → derived-union`, branded ids) |
| [llm-streaming.md](llm-streaming.zh.md) | the `packages/llm` conversation types — `Message`/`ContentBlock`, the assembled model request, the `StreamChunk` wire protocol and adapter contract, `BlockAssembler`, and the `LlmAdapter` provider contract |
| [token-meter.md](token-meter.zh.md) | immutable scalar and positional replay measurements with consumed-log revisions |
| [scope.md](scope.zh.md) | scoped registration identity, dispatch carriers, and the owned `Scope` context |
| [typert.md](typert.zh.md) | Remote invocation descriptors, lookup/Context declarations, Typert registries, and the Host Gateway/Client API boundaries |
| [goal.md](goal.zh.md) | persisted goal identity, lifecycle snapshots, activation, change records, and round attribution |
| [schedule.md](schedule.zh.md) | Session-local reminder records, durable transitions, active views, and ordinary-conversation delivery |
| [commands.md](commands.zh.md) | the human-command registry service: definitions, adapter discovery, direct invocation, results, and parsing views |
| [session.md](session.zh.md) | the full `SessionEventMap` variant catalog, `TurnTrigger`/`TurnEndReason`, `deriveMessages()`, execution enclosure, and standalone events |
| [persistence.md](persistence.zh.md) | the durability seam: `SessionPersistence`, JSONL + SQLite backends, `session/flush`, crash recovery, `SessionHeader` |
| [settings.md](settings.zh.md) | the user-settings seam: `SettingsNamespace` registration, layered resolution (defaults → composition `base` → user document), owner scopes, hot commits |
| [credentials.md](credentials.zh.md) | the credential seam: `CredentialRef` references (never values) in configuration, per-operation resolution, UI-safe `CredentialInfo`, provider source layers |
| [session-query.md](session-query.zh.md) | logical records, bounded exact-event reads, relationship traces, semantic filters/documents, and full-text result pages |
| [feedback.md](feedback.zh.md) | lifecycle-bound per-message feedback records, optimistic versions, sidecar persistence, and the Host Remote contract |
| [session-title.md](session-title.zh.md) | durable title snapshots, cited source-message seqs, and the asynchronous provider contract |
| [session-reference.md](session-reference.zh.md) | structured cross-session references: `SessionReferenceInput`/`Candidate`, prepared message contexts, the stable error taxonomy |
| [system-prompt.md](system-prompt.zh.md) | per-assembly context, tool-provider results, prompt sections, and cooperative assembly |
| [tools.md](tools.zh.md) | `ToolDefinition` full fields, the schema DSL, `ToolExecution`/`ToolResult`, tool-presentation UI types, and the guarded execution pipeline |
| [user-questions.md](user-questions.zh.md) | the UI-backed human question/answer seam: `AskUserQuestionRequest`, answer/options vocabulary, provider API, error taxonomy |
| [approval.md](approval.zh.md) | the one-shot user-approval seam: `ApprovalRequest`, `ApprovalOutcome`, per-session policy, audit events, and answerer contracts |
| [attachment.md](attachment.zh.md) | durable image identity and metadata, validation inputs, verified reads, and the `AttachmentStore` seam |
| [shell.md](shell.zh.md) | the bash executor seam: `ShellExecRequest`/`Spec`, `ShellRunResult`, background `ShellProcess` handles |
| [subprocess.md](subprocess.zh.md) | the subprocess seam: fully-explicit `SubprocessSpawnSpec`, offset-based output readers, unclassified `SubprocessOutcome`, and the managed `DSH_*` environment vocabulary |
| [terminal.md](terminal.zh.md) | persistent terminal ids, backend/session contracts, send readiness, bounded reads, and owner-visible snapshots |
| [sandbox.md](sandbox.zh.md) | per-session policy resolution and the process-confinement seam: file-effect modes, execution/provider policies, `ConfinedArgv`, enforcement and fail-closed errors |
| [code-runtime.md](code-runtime.zh.md) | the code-execution seam: `CodeRunRequest`/`Result`, binding namespaces, captured logs, the `CodeRunFailure` taxonomy |
| [extensions.md](extensions.zh.md) | versioned dynamic Cordis Plugins and Packages, Host/Client activation, approval, runtime inspection, and lifecycle teardown |
| [self-evolve.md](self-evolve.zh.md) | the self-improvement seam: verifier-grounded failure patterns, the L1/L2 proposal lifecycle, reversible effect commits, model-facing tools |
| [filesystem.md](filesystem.zh.md) | the filesystem seam: `FsTarget`, read/write/edit outcomes, observed-file state, `FsErrorCode` |
| [lsp.md](lsp.zh.md) | the LSP navigation seam: `LspQueryRequest`/`Result`, `LspProvider`/`Service`, four operations, `LspError` |
| [skills.md](skills.zh.md) | the skill service: discovery priority, `SkillSummary`/`SkillDefinition`, session-prefix catalog, model-facing `skill` loading |
| [compaction.md](compaction.zh.md) | the compaction seam: the `compaction/*` session events, `CompactionResult`, the `CompactionEngine` interface |
| [subagent.md](subagent.zh.md) | the subagent seam: the named-provider registry, `SubagentStartRequest`/`Result`/`Run`, the start-time-vs-runtime capability split |
| [agent-team.md](agent-team.zh.md) | Agent Teams: implicit Lead identity, named continuable teammates, durable peer mailbox, and shared task DAG |
| [web.md](web.zh.md) | the web access seam: `WebSearchRequest`/`Result`, `WebFetchRequest`/`Result`, `WebFetchBody`, provider availability, `WebError` |
| [spill.md](spill.zh.md) | the spill storage seam: `SaveTextSpill`, `SpillOwner`/`SpillSource`, `SpillRef`, the branded `SpillLocator` |
| [workflow.md](workflow.zh.md) | the workflow seam: `WorkflowStartRequest`, `WorkflowMeta`, `WorkflowRun`/`Result`, the `workflow/*` event payloads, `WorkflowError` fatality |
| [jobs.md](jobs.zh.md) | the background-job runtime: branded `JobId`s, the producer contract, consumer views, and `ctx.jobs` service behavior |
| [permission-presets.md](permission-presets.zh.md) | the permission-preset layer: `PresetSpec`/`PresetOption`, the derived `custom` state, the log-only `permission/preset` event |
| [plan.md](plan.zh.md) | plan mode: the log-only `plan/mode` state, pending-selection flush, `PlanModeConfig`, the `exit_plan_mode` review arc |
| [invariants.md](invariants.zh.md) | the runtime-invariant registry: selection `Config`, `InvariantInstaller`/`InvariantFailure`, the empty-companion contract |
| [web-server.md](web-server.zh.md) | the HTTP carrier: `WebRouteKind`/`WebRoute`, match order, the claimable fallback seat, index taps |
| [storage.md](storage.zh.md) | the storage subsystem: the backend contract (`StorageBackend`), `StorageForms`, `DomainSpec`/`Domain`, `domain/changed` |
| [workspace.md](workspace.zh.md) | the workspace registry: `Workspace`/`WorkspaceId`, registration and resolution, the session `cwd` relationship |
| [desktop.md](desktop.zh.md) | desktop OS-integration seam: native dialogs, notifications, menus, shortcuts, tray, and the Electron main bridge |
| [patent.md](patent.zh.md) | the patent-domain port: the `ctx.patentData`/`ctx.patentKnowledge`/`ctx.patentWorkflow` service seams, the ModelPort contract, the model-facing tool set, rule gates, and document rendering |
| [client-modules.md](client-modules.zh.md) | the web plugin table: `dsh.client` declarations, `WebBootGraph` wire composition, the bundle route and index tap |
| [session-projection.md](session-projection.zh.md) | the projection seam: `SessionProjectionMap`, the pure `ProjectionDefinition` unit, `ProjectionSnapshot`'s consistent cut, the change feed |
| [session-telemetry.md](session-telemetry.zh.md) | the outbound session-reporting capability seam: `SessionTelemetryRecord`/`SessionTelemetrySeverity`, the `SessionTelemetrySink` contract, and the `session-telemetry/record` redact waterfall |

> 这些页面上的类型声明及其 JSDoc 与源码等价，并由 `pnpm run verify-type-equiv` 检查漂移（见 [development.md](../development.zh.md#documenting-types-verbatim-ts-type-equiv)）。普通块保留完整声明；`public-api` 块保留去除实现体的公开 class 声明。Cordis 服务与事件使用每页生成的 **Cordis API** 小节。
