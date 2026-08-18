# Self-Evolve

[English](self-evolve.md) | 中文

自进化子系统让 harness 能够自我改进：它观察以验证器为锚的失败模式，并对技能、提示词段落、工作流或 harness 包提出窄范围修改。能力接缝位于 `packages/self-evolve` 之下，以 `@deepseek-ai/dsh-self-evolve*` 包形式存在：[`@deepseek-ai/dsh-self-evolve`](../../packages/self-evolve/self-evolve/README.md) 定义 `ctx.selfEvolve` Service Definition 与 `self-evolve-loop/start|end` 事件；[`@deepseek-ai/dsh-self-evolve-basic`](../../packages/self-evolve/self-evolve-basic/README.md) 是 Service Provider（空闲压力触发、速率限制、L1/L2 提案、可逆效果提交）；[`@deepseek-ai/dsh-tool-self-evolve`](../../packages/self-evolve/tool-self-evolve/README.md) 是面向模型的 Consumer（基于该接缝的工具与提示词段落）。

Source: [`packages/self-evolve/self-evolve/src/index.ts`](../../packages/self-evolve/self-evolve/src/index.ts)

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
 * Read the latest projected failure-pattern state for a session, or the
 * empty state if the projection has not folded yet. Implementations may
 * return a stale view; callers do not rely on synchronous freshness.
 *
 * @param sessionId - opaque session identity.
 * @returns ranked failure patterns for the session.
 */
abstract readPatterns(sessionId: string): Promise<FailurePattern[]>
```

Source: [`packages/self-evolve/self-evolve/src/index.ts:61`](../../packages/self-evolve/self-evolve/src/index.ts)

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

Source: [`packages/self-evolve/self-evolve/src/index.ts:47`](../../packages/self-evolve/self-evolve/src/index.ts)

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

Source: [`packages/self-evolve/self-evolve/src/index.ts:40`](../../packages/self-evolve/self-evolve/src/index.ts)
<!-- END GENERATED cordis-surface -->
