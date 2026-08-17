# Agent Note: dual-copy dsh-tools breaks the tool scheduler handshake

Status: implemented

English | [中文](2026-08-16-dual-copy-dsh-tools-scheduler-handshake.zh.md)

## Problem

Every tool call in a web/desktop session failed with `Cannot read properties of undefined (reading 'prepare')`, recorded as `turn/end` with `code: UNKNOWN`. The failure was deterministic per environment, absent in a source-launched dev boot, and reproduced with the packaged desktop backend, a standard preset, and the real model.

Root cause: the desktop profile's own `node_modules` (`$DSH_HOME/profiles/desktop/node_modules`) carries a second physical copy of `@deepseek-ai/dsh-tools`, hoisted by third-party plugins whose peer/direct dependency ranges require `>= 0.1.0-rc.6` while the app bundles `0.1.0-rc.5`. The Loader resolves the `tools` row from the profile's own `node_modules` (nearest-wins), so the `ToolRuntime` service instance comes from that copy; the bundled `dsh-agent-loop` imports `TOOL_RUNTIME_SCHEDULER` from the backend's copy. Two module instances mint distinct `Symbol('@deepseek-ai/dsh-tools.scheduler')` values, so `ctx.tools[symbol]` is `undefined` for the loop's copy and `undefined.prepare(...)` throws at `tool-calls.ts` (`startCall`), `code-mode.ts` (sub-dispatch), and every other scheduler access.

## Decision

Change `TOOL_RUNTIME_SCHEDULER` from a module-local `unique symbol` to a namespaced string constant (`'@deepseek-ai/dsh-tools:runtime-scheduler'`). A string literal is shared by value across module copies, so the agent loop reaches the scheduler on the `ToolRuntime` instance regardless of which copy created it. The key stays namespaced and `@internal`, so it remains outside the generated named service API.

When the key is still absent at dispatch time — a pre-string-key copy built the `ToolRuntime`, a version mismatch no key form can bridge — the loop fails loud with an actionable handshake diagnosis instead of the bare `Cannot read properties of undefined (reading 'prepare')`. The widened check lives at the top of `runGroup`'s scheduler try block, so the existing failure path still records the synthetic not-dispatched results that keep the transcript provider-valid.

## Alternatives considered

**Keep the symbol and align versions (rebuild the app to rc.6).** Version skew is a moving target while the plugin ecosystem publishes ahead of this checkout, and two identical-version copies at different paths still mint distinct symbols — alignment alone does not fix the mechanism. Rejected.

**Make the Loader resolve bundle-owned rows from the app's own closure instead of the profile's `node_modules`.** This is the structurally complete fix for profile-shadowing, but it changes vendored-Loader/app-boot resolution behavior and is a larger, separate change; the scheduler handshake remains fragile for any other dual-copy path. Deferred.

**Expose the scheduler as public methods on `ToolRuntime`.** The staged protocol (prepare/dispatch/finalize/finish) is deliberately not part of the named service API; a string-keyed property preserves that boundary. Rejected.

## Consequences

- `TOOL_RUNTIME_SCHEDULER` is a string literal; the `ToolRuntime` scheduler field, `tool-calls.ts`, and `code-mode.ts` need no other change.
- Regression test in `packages/core/tools/tests/tools.spec.ts` pins the string-ness of the key and reachability of the scheduler through it.
- Regression test in `packages/core/agent-loop/tests/tool-calls.spec.ts` removes the scheduler key and pins the handshake diagnosis plus the balanced not-dispatched synthetic results.
- Verified end to end against the reproducing environment: with both copies present and both carrying the fixed lib (the packaged backend's copy is a workspace link), the previously failing prompt completed 22 tool calls with zero scheduler errors.
- Immediate environment fix for the shipped app (no rebuild): remove the hoisted copy from the profile's `node_modules` so the `tools` row resolves the app's bundled copy; verified working with the unmodified bundled code.

## Remaining risks

- A dsh-tools copy built before this change still exposes only the symbol, and no key form can bridge that version mismatch; until the ecosystem ships fixed copies, a profile that hoists one re-breaks a fixed app. The failure is now diagnosed loudly at dispatch instead of surfacing as a bare TypeError. Keep the hoisted copy absent from the profile (or pinned to a fixed copy) until then.
- The Loader still resolves bundle rows from a profile's `node_modules` when it shadows the app's closure; any future core row hoisted by plugins can shadow the same way. The scheduler fix makes the current handshake robust; loader-resolution hardening remains a candidate follow-up.
