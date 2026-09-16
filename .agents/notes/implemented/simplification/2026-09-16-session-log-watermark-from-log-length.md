# Agent Note: Derive the session-log upload watermark from the log length

Status: implemented

English | [中文](2026-09-16-session-log-watermark-from-log-length.zh.md)

## Problem

Preparing one `dsh_session_log` request contribution read the whole canonical log to learn one number. `prepare` called `session.snapshotEvents()` — a copy of every event, frozen — and used only `.at(-1)?.seq`, the watermark the field reports. `Session.append` clears that cached snapshot on every append, so the copy happened again on every prepared request rather than once per session: measured at 0.04 ms per request for a 90,000-event log, so roughly 0.7 MB of array garbage per request with no measurable share of request latency. The same call was also one of the deferred `typescript/no-deprecated` readers.

## Decision

- `throughSeq` is `session.seq - 1`, admitted through `SessionSeq`. The log-length contiguity contract makes the log length the next unread seq, so the last appended seq is that value minus one.
- An empty log returns `undefined` before the read, preserving the previous absent-field semantics (`snapshot.at(-1)?.seq === undefined`).
- The suffix read stays: `session.snapshotEvents(SessionLogOffset(afterSeq + 1))` copies only the unaccepted tail, which the field must carry.
- The removed call's `typescript/no-deprecated` waiver goes with it.

## Alternatives considered

- **Add a `Session.lastSeq` accessor.** Rejected: `session.seq` already publishes the log length, and four other packages derive the last seq from it.
- **Keep the snapshot call and read the session's cached snapshot.** Rejected: the cache exists, but `append` invalidates it on every event, so a per-request caller always misses it.
- **Cache the watermark alongside the acceptance fold.** Rejected: the fold's cached `scannedEvents` advances with appends, so a cached watermark would also be invalidated by the same appends — the derived value needs no cache at all.

## Consequences

The uploaded field body is unchanged: same `throughSeq`, same suffix, same acceptance record written by `accept()`. The plugin no longer reads the full event sequence, and the deprecated-read migration for this path is complete.

## Testing

- `packages/session/session-log-deepseek/tests/upload.spec.ts` gains a case that spies `Session.snapshotEvents` across one accepted request: after acceptance and one further append the only remaining call is the suffix read at the unaccepted offset.
- Negative control, run and reverted: restoring the snapshot read fails exactly that case (`expected [ [], [ 2 ] ] to deeply equal [ [ 2 ] ]`) while the other 28 in the file still pass.
- `pnpm exec vitest run packages/session/session-log-deepseek/tests` — 44 passed. `pnpm exec vitest run packages/llm/llm-deepseek/tests/loader-composition.spec.ts` — 7 passed, covering the adapter boot that mounts this plugin.
- The request field itself is not recorded, but the acceptance events this plugin appends carry the same `throughSeq`, and three recorded scenarios contain them. `pnpm run test:snapshot -t text-turn`, `-t subagent-dsh-sdk-diagnostic`, and `-t serial-created` each replay against unchanged expected output.

## Related

- [Deprecate synchronous Session event reads](../architecture/2026-09-09-deprecate-synchronous-session-event-reads.md) — the decision that prohibits new readers and requires removing a waiver with its call.
- [session-log-deepseek](../../../../packages/session/session-log-deepseek/README.md) — the plugin that owns this field and its acceptance watermark.
