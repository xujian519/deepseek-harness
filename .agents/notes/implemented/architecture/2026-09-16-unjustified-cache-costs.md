# Agent Note: Request-path and forwarding costs measured too small to cache

Status: implemented

English | [中文](2026-09-16-unjustified-cache-costs.zh.md)

## Problem

An audit of this repository flagged six per-step or per-request costs as P1/P2 from reading code, each with a proposed cache or incremental buffer:

- `system-prompt` clones every tool's `parameters` on each assembly, and `headerEquals` serializes every tool schema twice per call (two calls per step).
- `token-meter`'s `measure()` deep-clones and freezes the whole price surface on every call, once per step and up to four times in an overflow-compaction step.
- The DeepSeek `messages` protocol re-parses every historical tool call's arguments on every request.
- `OutputCollector.snapshot()` concatenates the whole retained tail on every SSH helper flush round trip, which resends that whole tail.
- `ptc-runtime-node` rebuilds its stderr accumulator with `(stderr + text).slice(-maxOutputBytes)` on every stderr chunk.
- Session listing reads every session header from disk on each `SessionPersistence.list()`.

None of the six had been measured. Each was measured with the real code and real recorded shapes before deciding, and none survived.

## Decision

Keep all six as they are. Each is recorded below with its measurement so a later audit does not re-raise it without new evidence, and with the condition that would reopen it.

Three items from the same audit were changed because they did measure: [the session-log watermark](../simplification/2026-09-16-session-log-watermark-from-log-length.md), [the grep preview scope](../simplification/2026-09-16-grep-preview-scope.md), and [directory-listing child batches](2026-09-16-listing-child-batches.md).

## Alternatives considered

Each rejected alternative is the change the audit proposed, measured against what it would actually remove.

- **Identity-keyed `WeakMap` caches for tool-schema cloning and canonical JSON** (C1). The clone costs 0.071 ms per assembly with the repository's largest recorded tool set (33 tools, `snapshots/web/cordis-tool-round`, 33 KiB of schema JSON) and 0.205 ms at 99 tools; the two `headerEquals` calls cost 0.093 ms each at 33 tools. Rejected: a step takes seconds, so this is under 0.05% of one, and the caches would assume a provider never mutates a tool's `parameters` object in place — an assumption the clone currently does not need.
- **A revision-keyed cache for `token-meter.measure()`** (C2). Cloning and freezing the price surface costs 0.14 ms at 200 nodes, 0.37 ms at 1,000, and 1.8 ms at 5,000. Rejected: surfaces are bounded by the context window (hundreds of nodes), and a stale hit here would change token pressure and therefore compaction decisions — the risk is not proportional to sub-millisecond savings.
- **A bounded `Map` of parsed historical tool arguments** (C3). Parsing costs 0.2 µs per tool call, i.e. 0.10 ms for a request carrying 500 historical calls. Rejected: the cache would need its own bound to avoid retaining the arguments of a long session.
- **An incrementally maintained tail buffer in `OutputCollector`** (D1). At the 20 MiB tail cap the concatenation costs 0.21 ms of a 1.27 ms flush; base64 of the same tail costs 1.06 ms, and the wire carries that tail on every round trip. Replaying the helper's flush loop over 20 MiB of output at a 5 ms round trip attributes 104 ms to concatenation and 304 ms to base64. Rejected: it removes about 25% of a cost whose dominant terms — the full-tail base64 on both sides and the transferred bytes — stay, and it would replace the collector's chunk list with a ring buffer, reworking the spill path that byte-exact tests guard. The fix that would pay is a delta frame (the sender streams bytes after the last acknowledged offset), which the approved plan deferred as a protocol change.
- **Chunk accumulation with a head cursor for the PTC stderr tail** (D3). Feeding 4 MiB past a 4 MiB cap cost 303 ms, i.e. one full-cap copy per over-cap chunk, while every chunk below the cap is free (the concatenation stays a rope and the full-range slice does not flatten it). Rejected: the accumulator's cap and the output ledger's cap are the same 64 MiB, so the over-cap regime begins only when the run is already being killed for exceeding that budget.
- **A `(path, size, mtimeNs)`-keyed session-header cache** (D5). `list()` over 2,000 real sessions costs 284 ms: 45 ms of per-session directory reads, 25 ms of per-session `stat`, 81 ms of opening and reading each 300-byte log file, 18 ms of zstd inflate, and 0.6 ms of `JSON.parse`. Rejected: decompression and parsing — what a header cache removes — are 6.5% of the cost, and building the cache key still needs the `stat`. What would pay at this scale is an index that avoids reading every header at all, not a cache in front of those reads.

## Consequences

The measurements above are the record; no runtime behavior changed for these six. The related decisions they are calibrated against: a step is a multi-second unit in this harness, and the request-path items (C1–C3) each cost under 0.3 ms per step, so none is observable in a session's wall time.

## Testing

Measurements used the shipped source, not replicas:

- C1: the recorded tool-schema sets under `snapshots/` (24–33 tools; the largest is 33 KiB of schema JSON).
- C2: the `priceSurface` node shape, one node per surfaced event, over 200 / 1,000 / 5,000 nodes.
- C3: real tool-argument strings (`bash`, `read`, `grep`) at 50 / 200 / 500 historical calls.
- D1: the `OutputCollector` tail caps the call sites use (64 KiB for `bash`, 20 MiB for `grep`), replayed through the SSH forwarder's flush loop at 1 / 5 / 30 ms round trips.
- D3: the `stderr` accumulator expression and the default 64 MiB cap from `ptc-runtime-node`'s `Config`.
- D5: 2,000 sessions written through the shipped JSONL persistence, then `list()`, one `stat()` per session, and a per-phase decomposition over the same files.

## Related

- [Session-log watermark](../simplification/2026-09-16-session-log-watermark-from-log-length.md) — one audited request-path cost that was real: a whole-log array copy per request.
- [grep preview scope](../simplification/2026-09-16-grep-preview-scope.md) — the largest measured win of the audit: 131 ms to 1.7 ms of retention work per broad search.
- [Directory-listing child batches](2026-09-16-listing-child-batches.md) — the other measured win: 83.6 ms to 20.9 ms on a 3,200-entry directory.
