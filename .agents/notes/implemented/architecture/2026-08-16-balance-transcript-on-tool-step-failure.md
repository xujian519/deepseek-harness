# Agent Note: balance the transcript when a tool step fails mid-call

Status: implemented

English | [中文](2026-08-16-balance-transcript-on-tool-step-failure.zh.md)

## Problem

A turn that errors after recording an assistant `tool_calls` message but before recording its `tool/result` events leaves the transcript dangling: the next request carries an assistant message with `tool_calls` and no matching tool messages, and the provider rejects it with `An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'` before the model can see the failure. Every retry then fails identically, and the session is stuck until the user branches or starts over.

This surfaced when the (already fixed) duplicate-copy scheduler bug threw inside the tool pipeline: the loop recorded `tool/call` and closed the turn with an error, and the orphaned assistant message poisoned every later request on that session.

## Decision

In `dsh-agent-loop/tool-calls.ts`, the scheduler-failure path now records a synthetic error result for every call the failing group did not commit before rethrowing: `TOOL_NOT_STARTED` for a call whose `tool/call` was never recorded, `TOOL_OUTCOME_UNKNOWN` for a started call (mirroring crash-recovery's repair vocabulary in `dsh-session`). The assistant `tool_calls` message stays balanced by construction, the next request is accepted, and the model sees the failure and can react on retry.

## Alternatives considered

**Drop orphaned assistant messages in the surface projection.** The derived-message cache assumes a node's projection is stable once folded; an orphan can be answered by a later append, so pairing-aware projection would need cache invalidation on every append and breaks request reconstruction. Also silent transcript surgery at the projection layer violates the verbatim-pass-through contract. Rejected.

**Heal already-damaged logs by appending results at the tail.** Verified against the DeepSeek API: tool messages must immediately follow the tool_calls message, so an end-append cannot satisfy a mid-transcript orphan, and the append-only log cannot insert. Rejected; damaged sessions recover by branching or starting fresh.

**Balance in the machine's turn-error path instead of the group.** Covers failures outside the group boundary too (e.g. an `executionMode` throw before any call is recorded), but widens the surface; the group-level fix enforces the documented scheduler-failure contract directly at the damage site. The broader guard stays a candidate follow-up.

## Consequences

- New regression test drives a scheduler failure mid-group and asserts every assistant `tool-call` block carries a synthetic error result.
- 999 tests pass across `dsh-agent-loop`, `dsh-tools`, and `dsh-session`; typecheck and lint clean.
- Verified against the live provider that the contiguous synthetic-result shape is accepted.

## Remaining risks

- Sessions damaged by the original bug (orphaned calls mid-transcript) are not healed in place: the append-only log cannot reorder, and the provider requires tool messages immediately after the tool_calls message. Recover them by branching the conversation before the damaged message or starting a new session.
- A failure raised outside the group boundary (before any call in the step is recorded) can still leave an assistant `tool_calls` message unanswered; a machine-level balance in the loop's turn-error path is the candidate follow-up.
