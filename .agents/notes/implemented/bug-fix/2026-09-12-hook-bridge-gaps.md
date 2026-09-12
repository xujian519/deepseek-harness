# Agent Note: Close hook-bridge behavior gaps for Claude Code and Codex

Status: implemented

English | [中文](2026-09-12-hook-bridge-gaps.zh.md)

## Problem

The `dsh-hooks-claude-code` and `dsh-hooks-codex` bridges implemented the five (Claude Code: seven) supported hook events as harness interception points, but three observable behaviors from the reference tools were missing:

1. **Session-start context could miss the first request.** `SessionStart` hooks ran detached on `agent/session-start`, injecting context into the session without waiting for the first step. A slow or slightly delayed hook could return after the agent had already assembled its first model request, so the added context was invisible until the second step.

2. **A blocking `Stop` hook could force continuations forever.** Both bridges steered `continue` when a `Stop` hook blocked, but they did not count how many times a `Stop` hook had already forced a continuation. An unconditionally blocking stop hook therefore looped indefinitely, emitting one extra model turn per stop event.

3. **`{"continue": false}` was recorded but not enforced at run level.** A `UserPromptSubmit` or `PostToolUse` hook that returned `{"continue": false}` was logged and warned about, yet the run kept going. The reference tools treat this as a run-stopping signal, so a hook author expecting that behavior saw their directive ignored.

These gaps were tracked as Issue #81.

## Decision

Both bridges now share the same three mechanisms, implemented symmetrically in `packages/hooks/hooks-claude-code/src/index.ts` and `packages/hooks/hooks-codex/src/index.ts`:

### Session-start delivery gate

`agent/session-start` no longer injects context directly. Instead, the bridge starts the detached `SessionStart` run and stores the resulting `MergedHookOutcome` promise in a per-agent `sessionStartGates` map. The first `agent/pre-step` listener awaits that gate and, if the outcome contains admitted context, prepends the context messages to the admitted messages of the step.

This preserves the detached execution model — `SessionStart` does not block session boot — while guaranteeing that the first model request sees the hook-provided context. The gate stays stored until a step consumes it, because the hook usually resolves before the first prompt arrives; a gate that is never consumed before disposal is dropped with its agent. After the first step consumes the gate, later steps see no stored outcome and the context is not re-delivered.

### Stop-loop guard

A new `maxStopContinuations` config field defaults to `10` and is validated with `assertPositiveInteger`. Each bridge keeps a `stopLoops` counter per agent. On `agent/turn-stopping`, a blocking `Stop` hook that forces a continuation increments the counter and sets `stop_hook_active` to `true` when the counter is already greater than zero. When the counter reaches `maxStopContinuations`, the bridge cancels the run with `agent.cancel({ kind: 'hook', reason: '...' })` instead of steering another continuation.

The counter resets naturally: it is only read and incremented inside the `agent/turn-stopping` path, and the agent ends the run on the next non-stop turn, so a fresh stop sequence starts from zero.

### Run-level stop

After every hook invocation that produces a merged outcome, the bridge checks `merged.stop`. When `stop` is true, it calls `agent.cancel({ kind: 'hook', reason })` and maps the hook decision to the appropriate rejection for the current extension point: a blocked prompt ends the turn as `blocked`, a blocked pre-tool becomes `deny`, and a blocked post-tool becomes `deny` with the hook reason as feedback.

Both bridges listen to `agent/disposed` to remove the per-agent entries from `sessionStartGates` and `stopLoops`.

## Alternatives considered

**Block the first step on `SessionStart` synchronously.** Rejected: the bridge intentionally runs `SessionStart` detached so a slow hook does not hang session boot. A synchronous wait would contradict that design and could leave sessions unresponsive when a hook misbehaves.

**Cancel on the first forced continuation.** Rejected: reference tools allow multiple consecutive stop-hook continuations, and legitimate hooks use a small number of them to nudge the model past a premature stop. A hard limit of one would break useful configs.

**Make `maxStopContinuations` unbounded by default.** Rejected: an unbounded default would not close the infinite-loop gap. `10` matches the order of magnitude used in similar harness safety bounds and is high enough that legitimate nudging configs should rarely hit it.

**Implement `{"continue": false}` as event-specific behavior rather than a run-level cancel.** Rejected: the reference semantics for `UserPromptSubmit` and `PostToolUse` `{"continue": false}` is to stop the run, not to skip one step or block one tool while continuing. A run-level `agent.cancel` is the closest harness equivalent and avoids inventing per-event stop dialects.

## Consequences

`SessionStart` context is now reliably visible on the first step. `Stop` hooks can still force continuations, but a runaway hook is capped and then cancelled. `{"continue": false}` from `UserPromptSubmit` or `PostToolUse` now stops the run instead of being logged and ignored.

The new `maxStopContinuations` field appears in both bridge configs and their generated configuration catalogs. The per-agent maps add a small amount of state to each bridge; disposal listeners keep that state from leaking across agent lifetimes.

## Testing

`npx vitest run packages/hooks/hooks-claude-code/tests/bridge.spec.ts packages/hooks/hooks-codex/tests/bridge.spec.ts` covers the three behaviors on both bridges:

- A `UserPromptSubmit` hook returning `{"continue": false}` cancels the run.
- A blocking `Stop` hook that never self-limits is cancelled after `maxStopContinuations` forced continuations.
- A slow `SessionStart` hook still delivers its context to the first request.
- A `SessionStart` hook that resolved before the first prompt still delivers its context, proving the gate survives until a step consumes it.

The existing test harness helper accepts an optional `pluginConfig` partial so the stop-loop test can lower `maxStopContinuations` without changing the shipped default.

## Related

- [Claude Code hook bridge](../../../../packages/hooks/hooks-claude-code/README.md) — user-facing contract for the affected bridge.
- [Codex hook bridge](../../../../packages/hooks/hooks-codex/README.md) — user-facing contract for the affected bridge.
- [Interception extension points](../feature/2026-06-30-interception-extension-points.md) — the typed Decision surface the bridges map onto.
