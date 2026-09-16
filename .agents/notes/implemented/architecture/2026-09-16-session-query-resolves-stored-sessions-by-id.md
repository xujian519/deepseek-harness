# Agent Note: Resolve a stored Session by id instead of listing the corpus

Status: implemented

English | [中文](2026-09-16-session-query-resolves-stored-sessions-by-id.zh.md)

## Problem

Resolving the target of a stored-Session read began with a listing of the whole corpus: `SessionCorpus.borrow` called `persistence.list()` and searched the returned headers for the requested id. A JSONL listing walks every project directory under the storage root, stats each Session's artifacts, and decodes the header of every generation, so each read paid a scan proportional to the number of stored Sessions before it read anything. The read never used the other Sessions: existence plus one header observation were the entire requirement.

Measured on the JSONL backend (macOS arm64, Node 22.22, source-resolved diagnostic, medians of nine listings per root):

| Stored Sessions | `list()` | `stat(id)` |
|---:|---:|---:|
| 1 | 0.65 ms | 0.37 ms |
| 8 | 2.14 ms | 0.31 ms |
| 64 | 11.48 ms | 0.26 ms |
| 256 | 43.60 ms | 0.26 ms |
| 512 | 79.52 ms | 0.25 ms |

The listing costs about 0.16 ms per stored Session and the single-session observation is flat, so the preflight was the whole cost of a read of a small Session: on the 185-Session store recorded in the [resume-selector note](../../archived/bug-fix/2026-07-31-resume-selector-batch-projection.md), every point read spent roughly 29 ms listing before touching its own log.

## Decision

**A cold `borrow` resolves its target with `persistence.stat(id, options)`.**

- `statPersisted` maps the observation to the query taxonomy: absence (`undefined`) becomes `SESSION_QUERY_SESSION_NOT_FOUND`, and a backend failure becomes `SESSION_QUERY_PERSISTENCE_FAILED` with its cause preserved.
- The header check between the observation taken before the log read and the header inside the log stays, as `assertSessionHeadersCompatible(loaded.header, observed.header)`. Two observations of the requested id carry the same guarantee the listing comparison carried, because the check compares one logical source's header with itself across the observation and the read.
- `listSessions`, `filterSessions`, `traceSession`, and `readTitleSnapshots` keep listing. They answer corpus-wide questions, and `projectMany` resolves its own batch from one listing rather than one per id.
- A live target still short-circuits before persistence is consulted.

The measured endpoints on the 90,000-event synthetic log of [`benchmarks/session-history-read`](../../../../benchmarks/session-history-read/session-history-read.bench.ts) are unaffected by this decision, because that corpus holds one Session; the gate's evidence for the removed per-event copy is [its own decision](2026-09-16-session-query-borrowed-source-reads.md).

## Alternatives considered

- **Cache the corpus listing in the corpus.** Rejected: the cache needs an invalidation owner for every writer and process, and the read still pays a scan whenever the cache is cold. A single-session observation is cheaper than a listing by construction at every corpus size.
- **Filter the listing to one id.** Not available: the backend decodes every listed header before returning it, so a filtered listing would walk the same directories.
- **Keep the listing and compare against its header.** Rejected: this is the cost being removed, and the observation already in hand for existence serves the comparison.
- **Drop the header check.** Rejected: a stored log whose header changed between the observation and the log read must fail loudly rather than hand a caller a log whose header misrepresents it.

## Consequences

A stored-Session read now costs its own work plus one flat observation, so read latency no longer grows with how many Sessions a user has accumulated. Tools and context plugins that read history one Session at a time — `session_event_read`, the deliverables opener, and the session-reference context source — lose a per-call cost that scaled with the user's entire history.

Failure classification is unchanged: a missing Session, an unreadable backend, a corrupt log, and conflicting headers keep their existing error codes. The divergence the `SESSION_QUERY_SOURCE_CONFLICT` check detects is now observed between a `stat` and the log read rather than between a listing and the log read.

## Testing

- `pnpm exec vitest run packages/session-query/session-query/tests` — 100 passed.
- `pnpm exec vitest run packages/session-query/tool-session-query/tests packages/context/session-reference/tests packages/session-query/session-query-sqlite/tests` — 221 passed across the model-facing tool, the session-reference context plugin, and the SQLite backend.
- New case `observes one stored session per cold read instead of listing the corpus` asserts a cold point read performs zero listings and one `stat`, that the signal reaches the observation, and that an absent id is still reported as `SESSION_QUERY_SESSION_NOT_FOUND`.
- Negative control: restoring the listing preflight in `borrow` fails that case (and ten other cases in the suite) with `expected [AbortSignal] to deeply equal []`.
- `cancellableExactReads` now names each read's preflight (`list` or `stat`) instead of a boolean, so the cancellation cases assert the signal on the persistence call the read actually makes; the corpus-wide listings keep their own signal assertions.
- `benchmarks/session-open` and `benchmarks/session-history-read` both pass in the required lane.

## Related

- [Borrow session-query sources instead of cloning the log](2026-09-16-session-query-borrowed-source-reads.md) — the companion decision that removed the per-read copy of the log.
- [Resume selector batch projection](../../archived/bug-fix/2026-07-31-resume-selector-batch-projection.md) — recorded the pre-listing in `load()` as a cleanup candidate with error-semantics implications.
- [Unified session-query service](../../archived/architecture/2026-07-23-unified-session-query-service.md) — owns the corpus design this change keeps.
