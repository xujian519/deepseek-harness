# Agent Note: M1 third sink — thrown-value rendering (`toError`/`errorMessage`)

Status: implemented

English | [中文](2026-08-30-m1-thrown-value-rendering-sink.zh.md)

## Problem

M1's last mechanical rows were the thrown-value renderers. `toError` existed five times: four plain `instanceof Error ? error : new Error(String(value))` copies and skill's hardened variant whose `instanceof` probe and string coercion are wrapped against hostile thrown values. `errorMessage`/`renderThrown` existed across roughly a dozen packages with four drifted observable formats — `instanceof Error ? .message : String` (with and without a try/catch), pure `String(error)`, the `unknown error` label, and two placeholder spellings (`[unrenderable thrown value]`, `<unprintable thrown value>` / `<unrenderable thrown value>`). The scan that found them was initially truncated, which hid the goal-round-driver copy until the first full-suite run — a reminder to scan without limits.

## Decision

- `dsh-value` gains `errorMessage(value: unknown): string` — the total short-form renderer: `Error` instances render `.message`, non-Error objects carrying a string `message` property render it (absorbing core/tools' probe), everything else is stringified, and any trap yields the fixed `[unrenderable thrown value]` placeholder — and `toError(value: unknown): Error` — skill's hardened normalizer, reusing `errorMessage` for the fallback.
- Folded onto the canonical pair: skill (both functions), typert/loader, subagent-acp, subagent, subagent-dsh-sdk, interaction/commands, session-query (corpus, observation), session-query-sqlite, sdk/client, workspace-controller, patent-knowledge (its single-function `shared/errors.ts` deleted), core/tools, skill-filesystem, schedule, workflow, and goal-round-driver (found late).
- Kept local as different contracts, not copies: subagent lifecycle (name-inclusive `name: message` lines), workflow-worker-thread realm (stack-first failure reports, cross-realm), agent-team (`inspect`-based bounded single-line descriptions), llm adapter-failure (`Error`-typed SDK getter defense), gateway remote-events `toError(reason, message)` (attaches `cause`), and tool-ralph/tool-workflow's `?? 'unknown error'` (result-field default, not a renderer).
- Observable-text changes, each pinned test updated in the same change: non-Error rejections now render their actual value (session-query's `'offline'` instead of `unknown error`), warn lines drop the redundant `Error: ` class prefix (commands, skill), and the three placeholder spellings unify on `[unrenderable thrown value]`.

## Consequences

Every M1 row now records closure; the ledger's planned `util/` package is fully landed. The remaining M1 item is the abort-race family (five wrappers, three cancellation semantics), which needs its own chosen contract in `dsh-timeout`.

## Alternatives considered

**Unify on a name-inclusive format (`String(error)`).** Rejected: the majority embeds messages into structured records where the class is carried by other fields; a name prefix would duplicate it. Consumers wanting class names compose `${name}: ${message}` at their own site.

**Adopt `inspect` for non-Error objects in the shared renderer.** Rejected: `node:util` would make the zero-dependency package Node-only while client-group packages consume it in the browser; `inspect` stays with agent-team's local description renderer.

**Redirect patent-knowledge's `errors.spec.ts` to the new import.** Rejected: it duplicated the primitive's tests; the behavior now lives with and is exercised by `dsh-value`'s own spec.
