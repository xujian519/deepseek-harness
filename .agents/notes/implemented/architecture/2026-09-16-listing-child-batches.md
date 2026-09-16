# Agent Note: Resolve directory-listing children in bounded batches

Status: implemented

English | [中文](2026-09-16-listing-child-batches.zh.md)

## Problem

`listDirectory` resolved each child with two threadpool round trips — `realpath` through `resolveListedChildTarget`, then `stat` through `probe` — strictly one child at a time. The two operations per child are independent of every sibling's, so the listing used one libuv pool thread at a time and its cost tracked syscall latency multiplied by the number of entries. Measured on a warm local filesystem with a 3,200-entry directory: 83.6 ms, 26.1 µs per entry. On a filesystem whose per-operation latency dominates (cold cache, network mount, virtualized disk) the same serial shape costs latency × 2 × entries.

## Decision

- Children are resolved in batches of `LIST_BATCH_SIZE` (32) through one `Promise.all` per batch, so a batch overlaps its threadpool round trips. The batch bound keeps the libuv pool busy without queueing a whole large directory's operations at once.
- Entries still land in `localeCompare` name order: the batch is a slice of the sorted array and each batch's results are appended in order.
- Per-child error mapping is unchanged: a child that fails to resolve or probe still throws `listingIoError` naming that child's display path.
- Cancellation is checked before each batch and once after the last, so the abort granularity is one batch of children instead of one child.

## Alternatives considered

- **Take the child type from the `Dirent` `readdir` already returned, and stat only files.** Rejected: it changes `FsDirEntry` semantics — a symlink to a directory would report `other` instead of `directory`, and a symlinked file would lose its `size`.
- **Resolve every child concurrently in one `Promise.all`.** Rejected: a 100,000-entry directory would queue 200,000 threadpool operations at once, trading a latency problem for a memory and queue-depth one.
- **Add a `maxEntries` parameter and page the listing.** Rejected: it is a new public API on the filesystem seam, which excludes pagination by design.

## Consequences

Measured on the same 3,200-entry directory (3,000 files, 200 directories), warm local filesystem:

| Shape | Cost |
|---|---|
| serial per child (before) | 83.6 ms (26.1 µs per entry) |
| batched, 4 wide | 45.5 ms |
| batched, 8 wide | 32.1 ms |
| batched, 16 wide | 24.3 ms |
| batched, 32 wide (implemented) | 18.5 ms |
| batched, 64 wide | 17.2 ms |

The real `listDirectory` measures 20.9 ms against 83.6 ms serially. Batch width stops paying off between 32 and 64, and the wider the batch the longer an abort waits, so 32 is where the two meet.

## Testing

- `packages/fs/fs-local/tests/fsio.spec.ts` gains a listing of 40 children created in reverse order, which pins name ordering across more than one batch, then adds a symlink loop that sorts into the second batch and asserts the listing still rejects with `FS_IO_ERROR`.
- The existing matrix — stable order, broken links, symlink loops, permission codes, non-directory and aborted requests — passes unchanged, which is the contract this change must preserve.
- `pnpm exec vitest run packages/fs/fs-local/tests` — 154 passed, 3 skipped.

## Related

- [fs-local](../../../../packages/fs/fs-local/README.md) — the provider that owns local listing, reading, and atomic writes.
