# Agent Note: auto-heal transcripts with orphaned tool calls at load

Status: implemented

English | [中文](2026-08-16-auto-heal-orphaned-tool-calls.zh.md)

## Problem

Sessions damaged by the earlier dual-copy scheduler bug stayed unusable forever: the orphaned assistant `tool_calls` message sits mid-transcript, every retry is rejected by the provider before the model runs, and the turn-error balance fix only prevents new damage — it cannot repair logs already written. Users were stuck branching or starting fresh.

## Decision

Extend load-time repair with `orphanedToolCallReplacements` in `dsh-session`: it scans the log and shadows each assistant `tool_calls` message whose calls were never answered with a plain-text user-role note (the harness carries producer-injected context in user role), using the surface-replacement mechanism — the same durable mid-log rewrite compaction uses. Wired into the persistence coordinator's `prepareCore`, so every cold load/resume auto-heals; `commitRepair` persists the replacements. Idempotent: a healed message carries no tool calls. Partial answers are shadowed together with the message, since their results would themselves dangle once the assistant message is gone.

## Alternatives considered

**Append synthetic results at the log tail.** Verified against the live provider: tool messages must immediately follow their `tool_calls` message, so an end-append cannot satisfy a mid-transcript orphan. Rejected.

**Drop orphaned messages in the projection.** The derived-message cache assumes a node's projection is stable once folded, and silent projection surgery violates the verbatim pass-through contract. Rejected.

**No auto-heal.** Leaves every damaged session stuck; the user's real sessions were already in that state. Rejected.

## Consequences

- Unit tests pin the replacement shape, the partial-answer range, and idempotency; 762 session/persistence tests pass.
- Applied to the user's three damaged sessions via `persistence.prepare`; their derived transcripts now carry zero orphaned tool calls and one heal note each, and the installed app resumes them cleanly.
- The raw log preserves the original message; only the model-visible surface shadows it.

## Remaining risks

- A session live in the app at repair time is not healed until it is reopened cold; the app must be closed (or the session released) for the coordinator's cold load to run the repair.
- The heal changes what the model sees (a note instead of the failed tool call); this is deliberate — the alternative is a permanently rejected transcript.
