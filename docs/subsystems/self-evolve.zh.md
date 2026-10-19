# Self-Evolve

[English](self-evolve.md) | 中文

自进化子系统让 harness 能够自我改进：它观察以验证器为锚的失败模式，并对技能、提示词段落、工作流或 harness 包提出窄范围修改。能力接缝位于 `packages/self-evolve` 之下，以 `@deepseek-ai/dsh-self-evolve*` 包形式存在：[`@deepseek-ai/dsh-self-evolve`](../../packages/self-evolve/self-evolve/README.zh.md) 定义 `ctx.selfEvolve` Service Definition 与 `self-evolve-loop/start|end` 事件；[`@deepseek-ai/dsh-self-evolve-basic`](../../packages/self-evolve/self-evolve-basic/README.zh.md) 是 Service Provider（空闲压力触发、速率限制、L1/L2 提案、可逆效果提交）；[`@deepseek-ai/dsh-tool-self-evolve`](../../packages/self-evolve/tool-self-evolve/README.zh.md) 是面向模型的 Consumer（基于该接缝的工具与提示词段落）。

Source: [`packages/self-evolve/self-evolve/src/index.ts`](../../packages/self-evolve/self-evolve/src/index.ts)

## 触发器

`EvolveTrigger` 表示一次 loop 被请求运行的原因。每个触发器是一个队列优先级，而不是独立入口：该 seam 只对外暴露一个 `requestEvolve` 队列，加上 provider 自有监听器或无挂载嵌入式场景可用的两个直接调用（`evolveIfNeeded`、`evolveNow`）。

| 触发器 | 生产者 | 门禁 |
|---|---|---|
| `user-command` | `self_evolve_now` 经 `requestEvolve` | 永不受速率限制、永不被淘汰；部署无法验证时仍在验证阶段被拒绝 |
| `validation-retry` | provider 在 proposal 被拒之后 | 仅 `low-confidence`，仅当配置了 `proposerTarget`，每个 pattern 最多 `maxValidationRetriesPerPattern` 次 |
| `pressure` | 自动压缩（`compaction/start` 的 `turn` 非空） | `triggers.pressure` 策略；手动 `/compact` 的 `turn` 为空，不产生该触发器 |
| `idle-maintenance` | 非 subagent 会话的 `agent/status` 进入 `idle` | `triggers.idle-maintenance` 策略、`minIntervalMs` 与 `maxDailyLoopsPerSession` |

被拒的 proposal 记录 `ProposalValidationOutcome.reason`。只有 `low-confidence` 表示 verifier 已判断该 proposal 且认为其偏弱；`verifier-unavailable` 表示它们无法判断，重试会得到同一结论，因此永不入队。

## 请求队列

`requestEvolve(agent, levels?)` 返回 `EvolveRequestReceipt`——`requestId`、`status: 'queued' | 'coalesced'` 与 `queuePosition`——而不是 loop 结果，因为工具在 turn 内运行，而存在活动工作的 agent 会拒绝 `runMaintenance`。队列是 per-session 的内存态，按优先级 FIFO（`user-command` > `validation-retry` > `pressure` > `idle-maintenance`）；每次 drain 只启动一个请求，drain 发生在 agent 进入 idle 时与每次 loop 结束后。level 集合相同则合并。`maxPendingEvolveRequests`（默认 8）通过淘汰最旧的自主请求限制队列长度；显式请求永不被淘汰。进程退出时仍排队的请求会丢失，因为耐久化需要新增 session 事件并升格式版本。

## 随包默认值

base provider 随包发布的是 no-op 组合。held-in workspace verifier、held-out 探针与 LLM judge 各自需要部署配置（`workspaceVerifier.buildCommand`、`heldOutSessionIds`、`validatorTarget`）；缺少任一维度会把聚合置信度上限压到 0.3，低于 `minAcceptConfidence`，因此每个 proposal 都以 `verifier-unavailable` 被拒。`allowUnverifiedAutonomousRuns`（默认 `false`）把这种必然性变成对自主触发器的跳过，而不是周期性地跑一个必然被拒的 loop；显式 `user-command` 请求仍会执行，并仍报告诊断。

## Benchmark 状态目录

`BenchmarkEvolveConfig.agentStateDir` 是必填项。它必须是绝对路径，且不能指向 `baseDir`、`cwd`、home 目录或文件系统根；非空目录还必须带有 `.self-evolve-benchmark` 标记。benchmark 在该目录写入 snapshot、scoreboard 与 vault 文件，因此回退到 `process.cwd()` 会把这些状态放进进程启动时所在的任意目录。

## 测试

`pnpm exec vitest run packages/self-evolve` 覆盖触发器、队列、L1/L2 提交路径与 benchmark 状态。一组已提交的 headless 录制无需 API key 即可回放整条显式链路：任务调用 `self_evolve_now` 并取得 `queued` 回执，idle drain 执行一次并追加 `self-evolve/start`、`self-evolve/mined` 与 `self-evolve/end`，运行摘要以 `self-evolve` follow-up 消息到达。回放用 `pnpm run test:snapshot -t self-evolve`；模型转录变化时用 `pnpm run test:snapshot:record -t 'records self-evolve'` 重录。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxselfevolve--selfevolveengine-abstract-seam"></a>

### `ctx.selfEvolve` — `SelfEvolveEngine` (abstract seam)

Abstract self-evolve service. Implementations own trigger policy, rate limiting, verifier grounding, the proposal model route, and held-in/held-out regression execution. A successful run commits its proposals through the target seam for each level (skill register, systemPrompt.section, workflow engine, dynamicCordisRunner).

Load exactly one implementation per context; later providers shadow earlier ones so the base provider can be swapped for L4 harness-safe variants.

```ts cordis-catalog
/**
 * Consider running an evolution loop for an explicit trigger. Idle and
 * pressure triggers are rate-limited by the implementation; `user-command`
 * always initiates a loop (subject to approval defaults). Return `null` when
 * the policy decides no run is needed. `runMaintenance` on the agent owns
 * idle-gating; callers do not double-check it.
 *
 * @param agent Owner session and maintenance runner; also supplies the
 *              routed provider/model target so proposals use the same route.
 * @param trigger Why this call is asking for a run.
 * @param signal Cancels the loop as early as possible; cancellation records
 *               a `self-evolve/end` error rather than leaving the log open.
 * @param levels Restrict the edit surfaces this loop may propose against.
 *               Defaults to `['L1-skill', 'L2-context']` for safety.
 * @returns the loop result, or `null` when policy decides no run is needed.
 */
abstract evolveIfNeeded( agent: SelfEvolveAgentContext, trigger: EvolveTrigger, signal: AbortSignal, levels?: EvolveLevel[], ): Promise<SelfEvolveResult | null>

/**
 * Explicitly run an evolution loop now, regardless of pressure policy.
 * Enforces the same approval and validation gates as an idle loop.
 *
 * @param agent Owner session and maintenance runner.
 * @param signal Cancels the loop as early as possible.
 * @param levels Restrict the edit surfaces this loop may propose against.
 * @returns the loop result.
 */
abstract evolveNow( agent: SelfEvolveAgentContext, signal: AbortSignal, levels?: EvolveLevel[], ): Promise<SelfEvolveResult>

/**
 * Queue an explicit evolution request for the session's next idle boundary.
 * Tools and other in-turn callers cannot start maintenance work themselves —
 * the agent is still running the turn that invoked them — so the request is
 * recorded and drained once the agent settles. Requests with the same level
 * set coalesce into one queued entry.
 *
 * @param agent Owner session and maintenance runner.
 * @param levels Restrict the edit surfaces the queued loop may propose against.
 * @returns the request receipt: identity, coalescing status, and queue position.
 */
abstract requestEvolve(agent: SelfEvolveAgentContext, levels?: EvolveLevel[]): EvolveRequestReceipt

/**
 * Read the latest projected failure-pattern state for a session, or the
 * empty state if the projection has not folded yet. Implementations may
 * return a stale view; callers do not rely on synchronous freshness.
 *
 * @param sessionId - opaque session identity.
 * @returns ranked failure patterns for the session.
 */
abstract readPatterns(sessionId: SessionId): Promise<FailurePattern[]>
```

Types: [SessionId](core.zh.md)

Source: [`packages/self-evolve/self-evolve/src/index.ts`](../../packages/self-evolve/self-evolve/src/index.ts)

<a id="ctxselfevolvebenchmark--benchmarkevolveengine"></a>

### `ctx.selfEvolveBenchmark` — `BenchmarkEvolveEngine`

Benchmark-driven self-evolve provider. Registers as `ctx.selfEvolveBenchmark` on instantiation and routes all work through a `BenchmarkEngineCore` whose seams default to the `fork` subagent provider.

```ts cordis-catalog
/**
 * Run the full benchmark against the current agent state and persist the entry.
 *
 * @param benchmarkId Benchmark id.
 * @param options Evaluation options.
 * @returns The aggregated scoreboard entry.
 */
runBenchmark(benchmarkId: BenchmarkId, options: RunBenchmarkOptions): Promise<ScoreboardEntry>

/**
 * Establish a single-run baseline score for a benchmark.
 *
 * @param benchmarkId Benchmark id.
 * @param options Evaluation options.
 * @returns The baseline scoreboard entry.
 */
establishBaseline(benchmarkId: BenchmarkId, options: RunBenchmarkOptions): Promise<ScoreboardEntry>

/**
 * Optimize a benchmark under strict improve-or-rollback.
 *
 * @param benchmarkId Benchmark id.
 * @param options Optimization options.
 * @returns The loop outcome.
 */
optimizeLoop(benchmarkId: BenchmarkId, options: OptimizeLoopOptions): Promise<OptimizeResult>

/**
 * Read all persisted scoreboard entries for a benchmark.
 *
 * @param benchmarkId Benchmark id.
 * @returns Persisted entries, oldest first.
 */
readScoreboard(benchmarkId: BenchmarkId): Promise<ScoreboardEntry[]>
```

Source: [`packages/self-evolve/self-evolve-benchmark/src/index.ts`](../../packages/self-evolve/self-evolve-benchmark/src/index.ts)

<a id="self-evolve-loop-events"></a>

### `self-evolve-loop/*` events

<a id="self-evolve-loopend--emit"></a>

#### `self-evolve-loop/end` — emit

An evolution loop settled. Every `start` event emits exactly one end event, including cancelled runs and rejected proposals.

```ts cordis-catalog
/**
 * An evolution loop settled. Every `start` event emits exactly one end
 * event, including cancelled runs and rejected proposals.
 * @param info - run identity and the loop error, when the loop failed.
 * @mode emit
 */
'self-evolve-loop/end'(info: { runId: SelfEvolveRunId; error?: string }): void
```

Source: [`packages/self-evolve/self-evolve/src/index.ts`](../../packages/self-evolve/self-evolve/src/index.ts)

<a id="self-evolve-loopstart--emit"></a>

#### `self-evolve-loop/start` — emit

An evolution loop started. Paired with `self-evolve-loop/end`.

```ts cordis-catalog
/**
 * An evolution loop started. Paired with `self-evolve-loop/end`.
 * @param info - run identity and the trigger that initiated the loop.
 * @mode emit
 */
'self-evolve-loop/start'(info: { runId: SelfEvolveRunId; trigger: EvolveTrigger }): void
```

Source: [`packages/self-evolve/self-evolve/src/index.ts`](../../packages/self-evolve/self-evolve/src/index.ts)
<!-- END GENERATED cordis-surface -->
