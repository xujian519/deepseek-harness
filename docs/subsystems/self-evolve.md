# Self-Evolve

English | [中文](self-evolve.zh.md)

The self-evolve subsystem lets the harness improve itself: it observes verifier-grounded failure patterns and proposes narrow edits to skills, prompt sections, workflows, or harness packages. The capability seam lives under `packages/self-evolve` as `@deepseek-ai/dsh-self-evolve*` packages: [`@deepseek-ai/dsh-self-evolve`](../../packages/self-evolve/self-evolve/README.md) defines the `ctx.selfEvolve` Service Definition and the `self-evolve-loop/start|end` events; [`@deepseek-ai/dsh-self-evolve-basic`](../../packages/self-evolve/self-evolve-basic/README.md) is the Service Provider (idle-pressure trigger, rate limits, L1/L2 proposals, reversible effect commits); [`@deepseek-ai/dsh-tool-self-evolve`](../../packages/self-evolve/tool-self-evolve/README.md) is the model-facing Consumer (tools and prompt section over the seam).

Source: [`packages/self-evolve/self-evolve/src/index.ts`](../../packages/self-evolve/self-evolve/src/index.ts)

## Triggers

`EvolveTrigger` names why a loop was asked to run. Every trigger is a queue priority, not a separate entry point: the seam exposes one `requestEvolve` queue plus the two direct calls (`evolveIfNeeded`, `evolveNow`) that a provider-owned listener or an unmounted embedding may use.

| Trigger | Producer | Gate |
|---|---|---|
| `user-command` | `self_evolve_now` through `requestEvolve` | Never rate-limited and never evicted; still rejected at validation when the deployment cannot verify |
| `validation-retry` | The provider after a rejected proposal | Only `low-confidence`, only with `proposerTarget` configured, at most `maxValidationRetriesPerPattern` per pattern |
| `pressure` | An automatic compaction (`compaction/start` with a non-null `turn`) | `triggers.pressure` policy; a manual `/compact` has a null `turn` and produces none |
| `idle-maintenance` | `agent/status` entering `idle` for a session that is not a subagent | `triggers.idle-maintenance` policy, `minIntervalMs`, and `maxDailyLoopsPerSession` |

A rejected proposal records `ProposalValidationOutcome.reason`. Only `low-confidence` means the verifiers judged the proposal and found it weak; `verifier-unavailable` means they could not judge it, so a retry repeats the same verdict and never queues.

## Request queue

`requestEvolve(agent, levels?)` returns an `EvolveRequestReceipt` — `requestId`, `status: 'queued' | 'coalesced'`, and `queuePosition` — instead of a loop result, because a tool runs inside a turn and an agent with active work rejects `runMaintenance`. The queue is per session, in memory, FIFO by priority (`user-command` > `validation-retry` > `pressure` > `idle-maintenance`); one request starts per drain, and a drain runs when the agent reaches idle and after each finished loop. Identical level sets coalesce. `maxPendingEvolveRequests` (default 8) bounds the queue by evicting the oldest autonomous request; explicit requests are never evicted. A request still queued at process exit is lost, because durability would need a new session event and a format version.

## Shipped defaults

The base provider ships a no-op composition. The held-in workspace verifier, the held-out probe, and the LLM judge each need deployment configuration (`workspaceVerifier.buildCommand`, `heldOutSessionIds`, `validatorTarget`); a missing dimension caps the aggregate confidence at 0.3, below `minAcceptConfidence`, so every proposal is rejected as `verifier-unavailable`. `allowUnverifiedAutonomousRuns` (default `false`) turns that certainty into a skip for autonomous triggers instead of a periodic rejected loop; an explicit `user-command` request still runs and still reports the diagnostic.

## Benchmark state directory

`BenchmarkEvolveConfig.agentStateDir` is required. It must be an absolute path to a directory that is not `baseDir`, `cwd`, the home directory, or a filesystem root, and a non-empty directory must carry the `.self-evolve-benchmark` marker. A benchmark writes snapshots, scoreboards, and vault files there, so a fallback to `process.cwd()` would put that state in whatever directory the process started in.

## Testing

`pnpm exec vitest run packages/self-evolve` covers the triggers, the queue, the L1/L2 commit path, and benchmark state. One committed headless recording replays the whole explicit chain without an API key: the task calls `self_evolve_now` and receives a `queued` receipt, the idle drain runs once and appends `self-evolve/start`, `self-evolve/mined`, and `self-evolve/end`, and the run summary arrives as a `self-evolve` follow-up message. Replay with `pnpm run test:snapshot -t self-evolve`; re-record with `pnpm run test:snapshot:record -t 'records self-evolve'` when the transcript changes.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [SessionId](core.md)

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
