# Agent Note: Borrow session-query sources instead of cloning the log

Status: implemented

English | [中文](2026-09-16-session-query-borrowed-source-reads.zh.md)

## Problem

`SessionCorpus.load` resolved one live-preferred source and returned a fully cloned copy of it: a deep-frozen live log was cloned event by event, and so was every event read from a stored log. Every exact read paid that cost before doing its own work, so the paid cost was set by the size of the log rather than by what the caller asked for. A single-event read (`readEvent` with no context window) cloned the whole log; `readSession` cloned it twice, because `load` cloned every event and the endpoint then detached every event again.

Measured on a live session of 50,000 `user/message` events with ~50 MB of text, resolving one source cost 106 ms and a transient 86 MB of heap. `readSession` cost about 493 ms (106 ms of resolution cloning, 250 ms of `Session.create` validation, 137 ms of output detachment).

## Decision

**`SessionCorpus.borrow` replaces `load`, and every endpoint clones only the values it returns.**

- `borrow(sessionId, signal)` returns a `BorrowedSession` — header, inherited event count, and the log — and copies no event. A live owner contributes its frozen snapshot (`session.snapshotEvents()`); a stored log contributes the cold read's own outer array, whose events the backend either froze (`shared-frozen`) or handed over as independently owned (`detached`). Both cases are the existing `ColdSessionLog` adoption contract used by `SessionObservationReader`.
- `load` and its `snapshotLive` helper are deleted; `borrowLive` is shared with the batch projector, which had already used the same borrow-and-project shape.
- Point reads detach exactly what they return: `readEvent` clones the header plus the requested window, `readSession` clones the header plus one snapshot per event, `readSurface` clones the header while `currentSurfaceEvents` continues to snapshot each surface event, and `traceEvent` clones the header. `listEvents` and `filterEvents` build fresh records and documents, so they clone nothing.
- `readSession` keeps its replay-validation pass through `Session.create` and now detaches each event once instead of twice.

Measured on the same 50,000-event live session:

| Endpoint | Before | After |
|---|---:|---:|
| `readEvent` (seq N-1, no window) | 106 ms, +86 MB transient | 0.2 ms, no transient copy |
| `listEvents` | ~114 ms, +86 MB transient | 7.9 ms, +22 MB |
| `readSurface` (every event a surface node) | ~250 ms, +175 MB | 142 ms, +89 MB |
| `readSession` | ~493 ms | 389 ms |

## Benchmark

`benchmarks/session-history-read` is the required gate for this change. It writes one synthetic Session through the production write path, copies the root per sample, and reads it back through the real `ctx.sessionQuery` service composed with the JSONL backend.

| Field | Decision |
|---|---|
| User operation | A point read of one event's context window, and a read of the current model surface, over a stored Session; each completes when the caller holds the returned snapshot |
| Workload | One `turn/start` plus 45,000 745-byte `user/message` events (`HISTORY_READ_TEXT_BYTES`, the size the gate asserts for every turn): 45,001 events and 33.5 MB of distinct user text. Each turn's text differs, so the stored log occupies real memory instead of sharing one string. The log stays inside one open turn: the released-format relationship validator accepts `turn/start` only while no turn is open, so a `turn/start` per turn without matching `turn/end` is a corrupt log |
| Entry path | `readEvent` and `readSurface` on a private root holding the fixture's durable log. The SQLite query engine is mounted as the production composition of `ctx.sessionQuery` but never queried, and no search result enters the measurement |
| Clock | Wall clock around the endpoint call only. The child mounts its Host and the parent copies the fixture into the sample root before timing starts; five samples per endpoint in fresh processes, with the median enforced |
| Memory | `heapUsed` immediately after the call, before collection, for transient growth; post-GC `heapUsed` and `resourceUsage().maxRSS` for retained and peak. A separate child runs the same read under a fixed 128 MB old-space limit |
| Verdict | Below. The two time budgets are standard two-CPU hosted CI medians rounded up and scaled by the variance headroom; the transient-heap budgets keep their reference-machine expectations with only the headroom |
| Behavior | Owner tests pin output, ordering, errors, and cancellation; this gate duplicates no semantic assertion and requires only that the read completes and reaches its endpoint |

| Measurement | Before (copy per event) | After |
|---|---:|---:|
| `readEvent` median | 313.3 ms | 174.9 ms |
| `readSurface` median | 458.5 ms | 308.7 ms |
| `readEvent` transient heap | +128.6 MB | +71.9 MB |
| `readSurface` transient heap | +190.8 MB | +127.6 MB |
| 128 MB old space | Both endpoints exhaust the heap | Both complete |

Negative control: restoring the removed copy in `borrow` restores the pre-change allocation, which the gate rejects on every non-timing case — both transient-heap budgets, and both constrained-heap completions (`SIGABRT`, `Reached heap limit ... JavaScript heap out of memory`). The two time budgets are CI signals calibrated against the standard two-CPU hosted runner that executes them, where the shared 2× time scale understates the machine: run 35981330076, job 107573671699 reports 432.7, 455.8, 440.1, 426.3, and 444.5 ms for `readEvent` and 764, 770.9, 752.7, 773.5, and 778.1 ms for `readSurface`, so the budgets scale the rounded 450 ms and 800 ms hosted expectations instead of the reference medians. The same run measures a 2.5× hosted ratio to the reference machine, which carries the recorded reference medians past both budgets (313.3 ms → 783 ms, 458.5 ms → 1,146 ms); the gate's calibration case asserts that in place of a reference-machine run. Excluded from this gate: Gateway transport, Client fold, browser paint, and model latency. The workload also holds a single stored Session, so the gate does not measure the corpus walk a read used to perform before reading; that removal is pinned by the package tests and by its own measured listing cost.

## Alternatives considered

- **Keep `load` and add a windowed variant beside it.** Rejected: two resolution paths for one source, and the clone-everything path stays reachable, which is the mistake being fixed.
- **Hand borrowed objects straight to callers.** Rejected: it breaks the package's detached-results commitment. A caller would receive the live owner's frozen objects (or the cold read's own array), and a write that currently lands on an isolated copy would start throwing or start mutating shared state.
- **Route point reads through `SessionObservationReader`.** Not adopted. A point read is one-shot, and the reader's bounded prepared-Session cache is retention such a read never reuses. Removing the corpus listing preflight needs only a single-session `stat` observation, which is [its own decision](2026-09-16-session-query-resolves-stored-sessions-by-id.md).
- **Cache the resolved log by revision inside the corpus.** Rejected: revision-keyed reuse already lives in `SessionObservationReader`; a second cache in the corpus would need its own invalidation owner for no added behaviour.

## Consequences

A read now costs what it returns instead of what it read: the removed work was proportional to the log, the remaining work is proportional to the returned window, records, or surface. Retained memory for a point read no longer carries a transient whole-log copy, which is what made large-session reads approach the process heap limit.

Borrowed events are read-only in the strong sense: a live owner's are deeply frozen and a backend may share its own. Any endpoint added later must clone whatever it returns, and must not mutate what it borrowed.

`readSession` remains dominated by its validation pass — `Session.create` contributes about 250 ms of its 389 ms — because that endpoint promises a replay-validated complete log. Adopting `Session.fromRestore` for a seed the backend already froze would remove that pass, and is left to a change that can justify the validation it drops.

## Testing

- `pnpm exec vitest run packages/session-query/session-query/tests` — 101 passed.
- `pnpm exec vitest run packages/session-query/tool-session-query/tests packages/context/session-reference/tests packages/session-query/session-query-sqlite/tests` — 221 passed across the model-facing tool, the session-reference context plugin that consumes `readSurface`, and the SQLite backend.
- New case `copies only the returned window instead of the whole log` asserts the clone count per endpoint with a spy on `structuredClone`: at most one detach per returned event plus the header, and fewer than 1.5 detach passes for `readSession`. It also asserts the returned window is still a detached copy that leaves the session untouched.
- Negative control: reintroducing the removed bulk clone into `borrowLive` fails that case with `expected 203 to be less than or equal to 3`.
- Coverage for `packages/session-query/session-query/src/corpus.ts` and `src/index.ts` is 100% under the package's own tests.

## Related

- [Unified session-query service](../../archived/architecture/2026-07-23-unified-session-query-service.md) — owns the corpus design this change keeps.
- [Observation cache](../../../../packages/session-query/session-query/README.md) — the revision-keyed point-observation path endpoints adopt when they need a reusable cut.
