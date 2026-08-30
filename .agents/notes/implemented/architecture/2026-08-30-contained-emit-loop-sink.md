# Agent Note: H7 sink — the contained-dispatch loop (`dsh-contained-emit`)

Status: implemented

English | [中文](2026-08-30-contained-emit-loop-sink.zh.md)

## Problem

Ten notification sites across nine packages hand-wrote the same loop: resolve the listener snapshot outside Cordis' dispatch, call each callback, catch its synchronous throw, and observe its returned promise — three drifted log styles (`listener rejected/threw`, tools' `observer failed`, session's `dispatch threw`) and two error renderers (`String`, `errorMessage`). The pattern's whole point is that a listener failure must never starve later listeners or reach the process as an unhandled rejection, so every divergent copy is an independent chance to get that wrong; jobs-local's `onJobsChanged` had already dropped the async arm. Two more sites (the agent- and session-created announcements) use a different, deliberate contract: a synchronous throw propagates to veto publication, and only the returned promise is contained.

## Decision

- New zero-dependency package `@deepseek-ai/dsh-contained-emit` with `invokeContained(ctx, label, callbacks, args, render)` (the loop) and `emitContained(ctx, label, args, render)` (cordis `events.dispatch('emit', args)` plus the loop, accepting the same argument shape as `ctx.emit` — dispatch's shift of the carrier and name does the payload extraction).
- The renderer is an injected parameter, not a fixed format: most callers pass `errorMessage`; agent-loop injects `errorChain` to keep cause chains in config-start-failure warnings; subagent injects its class-name `renderThrown`. The log label is likewise caller-owned, so existing prefixes such as `agent "${id}": agent/disposed` survive verbatim.
- Folded ten loops: core agent (event dispatch, `agent/disposed`), core session (the shared observe/dispose snapshot invoker), agent-loop (config-start-failed), tools (`tools/result`), skill (`skills/change`), workflow (`emitWorkflowEvent`), interaction commands (`commands/change`), subagent lifecycle, and jobs-local (`onJobsChanged`, `onJobDone` — the latter gains contained async rejections it previously leaked). jobs-local passes its own registry's listener iterators through an `Iterable<ContainedListener>` assertion; the loop never requires the event bus.
- Kept local on contract: the two created announcements (veto semantics), schedule's durable-change notify (a single callback, not a list), and the client-side `console.error` loops (gateway remote-events, client connection, webworker vfs) that have no `ctx.logger`.
- Observable-text changes: `String(error)` → `errorMessage(error)` drops the `Error: ` prefix for Error values (nine pinned assertions updated); tools' single-style `observer failed` becomes the two-style `listener rejected`/`listener threw`; jobs' `onJobDone listener rejected for ${id}` becomes `onJobDone for ${id} listener rejected`.

## Consequences

H7 is closed and the containment requirement lives in one reviewed loop. The ledger's shared-primitive list has three of five items landed (util values, the abort race, containment); recovery-vocabulary (H6) and ResolvedConfig (M2) remain.

## Alternatives considered

**Add `emitContained` to vendored cordis.** Rejected: the vendored tree is a pinned upstream copy, and a harness-specific containment API would widen the local-modification surface that every sync must re-apply, for a utility only harness packages consume.

**Bake `errorMessage` into the loop.** Rejected twice: the `util/` group's no-runtime-dependencies rule forbids depending on `dsh-value`, and the renderer is a real contract — config-start-failure warnings need `errorChain`'s cause chains and subagent's warnings carry class names, so a fixed renderer would either degrade those logs or force those two loops to stay local.

**Parameterize the loop with a veto flag and fold the created announcements.** Rejected: the veto path's essence is that a synchronous throw propagates, which is the exact behavior the containment loop exists to prevent. A flag would make the safety-critical difference between the two contracts invisible at the call site.
