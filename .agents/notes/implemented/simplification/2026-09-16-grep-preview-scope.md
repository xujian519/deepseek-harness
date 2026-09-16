# Agent Note: Preview only the grep matches the inline cap keeps

Status: implemented

English | [中文](2026-09-16-grep-preview-scope.zh.md)

## Problem

`retainGrepMatches` previewed every parsed match before capping the list to the first `maxMatches` (250 by default). The retainer discards everything past the cap, so on a broad search the discarded previews were the pass's dominant cost: measured on 80,000 parsed matches (27 MiB of `rg --json`), the three passes one `grep` call makes — the model-facing render, the search-card projection, and the post-execute spill decision — took 131 ms, of which the previews of the 79,750 dropped matches were all but the 1.7 ms the same three passes cost after this change.

`retainGlobPaths` had no caller in `src/`; `glob` computes its inline page through `globCardPage` and `sampleAcrossTopLevel` instead.

## Decision

- `retainGrepMatches` previews a match only while the retainer is still below `maxMatches`. Dropped matches are still pushed so the omission count stays exact, which is the only reason the retainer needs them.
- `retainGlobPaths` and its tests are deleted; the three `globSearchMeta` cases that used it build their inline page from a local `globPage` fixture, which is the shape `glob`'s card projection actually receives.

The spill artifact is unaffected: its own pass previews the complete list before writing the recovery file, so the model-facing text, the card metadata, and the recovered file keep their existing content and caps.

## Alternatives considered

- **Memoise the retention result on the match array's identity so the 2–3 passes share one outcome.** Rejected: after the preview fix each pass costs ~0.6 ms, so the memo would save ~1.2 ms while making one mutable result object reachable from three call sites.
- **Add a bulk `pushOmitted(count)` to `ItemRetainer`.** Rejected: it would change a shared retention utility's API to save a counter increment per dropped match.
- **Keep `retainGlobPaths` as the fixture `globSearchMeta`'s tests use.** Rejected: a test fixture belongs in the test, and an uncalled exported helper reads as a live contract.

## Consequences

Measured on 80,000 parsed matches (27 MiB of `rg --json`), the shape of a broad search in this repository:

| Stage | Cost |
|---|---|
| `parseGrepMatches` (split + per-line `JSON.parse`) | 84 ms |
| three retention passes, before | 131 ms |
| three retention passes, after | 1.7 ms |
| `formatGrepOutput` over the retained page | 0.1 ms |

The retained value is identical before and after, compared as serialized JSON over both the whole `RetainedItems` and its kept rows.

## Testing

- `packages/fs/tool-fs-search/tests/search-core.spec.ts` (new) pins the cap semantics against matches whose `line` reads are counted: the kept rows carry their previews, the omission count stays exact, and a 4,000-match list reads no more lines than a 4-match one.
- Negative control, run and reverted: restoring the preview-every-match loop fails the counting case (`expected 8000 to be 8`) while the other three cases still pass.
- `pnpm exec vitest run packages/fs/tool-fs-search/tests` — 158 passed; coverage of `search-core.ts` stays at 100% on statements, branches, functions, and lines.

## Related

- [tool-fs-search](../../../../packages/fs/tool-fs-search/README.md) — the package that owns both search tools, their inline caps, and the spill handoff.
