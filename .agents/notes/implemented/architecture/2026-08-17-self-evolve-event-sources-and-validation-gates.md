# Agent Note: self-evolve failure-event sources and validation gates

Status: implemented

English | [中文](2026-08-17-self-evolve-event-sources-and-validation-gates.zh.md)

## Problem

The self-evolve capability had structural gaps between its plan (spec.md/tasks.md/check_list.md, aligned with the 自进化优化.md review) and its runtime behavior:

- **Failure events had no producers.** The `failure-patterns` projection classified `tool/error` and `agent/request-error` *session events*, but nothing in the harness ever appended them. Tool failures are durable as `tool/result` (with a rendered `[exit code: N]` / `[killed by signal: …]` marker for shell tools, or `isError` + `{name, code}` for genuine tool errors); `agent/request-error` is a Cordis context waterfall, not a session event. The two verifier tiers the plan cares about most (`subprocess-exit`, `llm-provider`) could never fire in production.
- **Model-visible claims outran behavior.** The tool prompt section claimed proposals commit "only after held-in and held-out regression acceptance" and that L4 requests trigger human approval; `validateProposal` always accepted with confidence 0 and no approval path existed.
- **Dead configuration.** `maxDailyLoopsPerSession` was documented and resolved but never enforced; `lastStartByTrigger` was read but never written, so per-trigger `minIntervalMs` gating was inert; `_verifyHeldInCase` (the dual-verifier decision) had no caller; `maxDirtyLinesAddedPerCommit` existed only for it.
- **No negative-results persistence, no proposer failure context, no tests** for the provider, the tool consumer, or the invariant, and the idle-maintenance listener swallowed errors silently.

## Decision

Wire every verifier-grounded signal to a real durable source and make the loop's behavior honest, in one scoped change across the three self-evolve packages:

- **Classify `tool/result`, not `tool/error`.** The projection now folds `tool/call` identities (callId → name, bounded map in state, `stateVersion` 2 → 3) and classifies `tool/result` failure surfaces: shell exit/signal markers parse into `subprocess-exit` tier with signature `exit=N:stderr-prefix` / `signal=S:stderr-prefix`; `isError` results fall back to `tool-runtime` tier keyed on `error.name`. The `tool/error` session-event declaration is removed (it had no producer; bash non-zero exits are rendered markers, not error events).
- **Produce `agent/request-error` session events** from the `self-evolve-basic` provider: a waterfall listener appends `{provider, statusCode, error: {code, name, message}}` (from `LlmFailure`) and always delegates via `next()`. The declaration stays in `dsh-self-evolve`; the catalog regenerates to include it and the `self-evolve/*` events.
- **Dual-verifier decision wiring.** `requireDualVerification` (default `true`) gates `validateProposal`: when both `collectReplaySignal` and `collectWorkspaceSignal` return signals, `_verifyHeldInCase` decides (mixed or double failure → rejected with `regressions: []`); base collectors return `null` (P1.2 replay / P1.3 workspace infrastructure not built yet), so the gate degrades to the bracket-smoke validator with an explicit note instead of faking acceptance.
- **Negative results (P1.7b).** Rejections append one JSON line per rejection to `$DSH_HOME/self-evolve/negative-results.jsonl` (`persistNegativeResult`), `readNegativeResults(patternId, limit)` reads them back, and the template proposer summarizes the last three per-pattern rejections into its generated section text.
- **Rate-limit fixes.** `maxDailyLoopsPerSession` now gates autonomous triggers (`idle-maintenance`/`pressure`/`validation-retry`) on a rolling 24h window; `lastStartByTrigger` is written when a loop starts, making `minIntervalMs` live.
- **Honest claims.** The tool prompt section, tool descriptions, READMEs (en/zh), and the seam JSDoc state the base provider targets L1/L2 only, validation is a P0 bracket smoke until P1.2/P1.3, and no L4 approval path exists yet. The idle listener now logs instead of swallowing.
- **Tests.** 47 tests across four files: projection (tool/result classification, signature stability, tool-name pairing), invariant brackets (9 cases), provider (dual verification, daily cap, minInterval, negative results, request-error producer, `eligiblePatterns` threshold lift), and tool consumer registration/execution.
- **Catalog + patent fix.** `gen-persistence-catalog` now passes: the self-evolve session events drop their `@mode` tags (log events have no dispatch mode) and the catalog regenerates; the pre-existing `@mode` violation in `patent/plantask`/`patent/workflow-run` declarations is fixed the same way.

## Alternatives considered

**Produce `tool/error` and `agent/request-error` from `core/agent-loop`.** Rejected: the event declarations live in `dsh-self-evolve`, so agent-loop's type graph would not see them without moving the vocabulary into core; and bash exit≠0 is not an `isError` tool result, so a `tool/error` producer would still miss the `subprocess-exit` tier. Classifying the already-durable `tool/result` keeps the change inside the capability package.

**Reject every proposal while verifiers are unavailable (`requireDualVerification` + no signals → reject).** Rejected: with no P1.2/P1.3 infrastructure the loop would never commit anything, killing the P0 bracket-smoke purpose; the honest middle ground is explicit `null` collectors with a documented smoke fallback.

**Keep the over-promising prompt and wait for P1.** Rejected: model-visible claims that outrun behavior violate the harness convention that model-visible input matches durable reality; the claims were fixed in the same change.

## Consequences

- `pnpm exec tsc -b packages/self-evolve/*` and `pnpm exec vitest run packages/self-evolve/` pass (47 tests); staged oxlint on the subtree is clean; tsdown bundles build; `verify-persistence-catalog` is green with `agent/request-error` and all six `self-evolve/*` events in `KNOWN_SESSION_EVENT_TYPES`.
- The projection's durable state gains `toolCalls` and bumps `stateVersion` to 3; v2 states do not deserialize (unreleased, no compatibility promise).
- Model-facing text now under-promises: L3/L4 produce no proposals in the base provider, and validation is honestly labeled a bracket smoke until P1.2/P1.3.
- Still deferred (roadmap gates): P1.2 replay verifier, P1.3 workspace verifier, P1.4 LLM judge, P1.9 60-question SWE-bench evaluation with the CI-crossing auto-off switch, P2/P3/P4 phases, the `p0-bracket` keyless snapshot, and `verify-translation-pairing` corpus-wide remains red on pre-existing patent pairs.
- `gen-persistence-catalog` also unblocks the pending shared-file commit; the patent `@mode` fix is a two-line declaration cleanup with no behavior change.
