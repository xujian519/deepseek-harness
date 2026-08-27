# Agent Note: Figure and chemistry index write-read wiring

Status: implemented

English | [中文](2026-08-27-figure-chemistry-index-write-read-wiring.zh.md)

## Problem

The Sati ports `analyze_patent_figure`, `search_patent_figure`, and
`recognize_chemical_structure` registered their tools but never wired a
persistence layer behind them. `search_patent_figure` explicitly declared
"no index writer is wired" and failed loud with `setup_required`, and
`analyze_patent_figure` results were never persisted anywhere. The core use
case — confirming which drawing reference numeral and drawing corresponds to a
technical feature during claim drafting, OA response, and invalidity
comparison — was therefore unusable in an assembled host.

## Decision

`packages/patent/patent-tools` now ships a shared single-file index store and
wires write + read for both figure and chemistry analysis.

A generic factory `createIndexStore` in `src/internal/index-store.ts` owns the
common persistence semantics: `load` returns empty entries on a missing file,
returns empty plus a warning on a version mismatch, a structurally anomalous
file, dropped invalid entries, or corrupt JSON, and rethrows only a genuine
non-ENOENT read failure; `save` writes atomically through
`atomicWriteJson`; `upsert` serializes per-file-path writes in-process so a
read-modify-write race cannot lose entries, backs up a corrupt index before
rewriting it, deduplicates by an entry key, and sorts by a comparator. The
figure store (`src/figure/index-store.ts`) and chemistry store
(`src/chemistry/index-store.ts`) differ only in entry shape, key, comparator,
and version, so both build on the factory.

`patent-tools` `apply()` resolves `Config.figureIndexFile` and
`Config.chemistryIndexFile` (defaults `<cwd>/.sati/figures-index.json` and
`<cwd>/.sati/chemistry-index.json`) and wires the tools: `analyze_patent_figure`
upserts its result into the figure index, `search_patent_figure` loads that
index for keyword retrieval, and `recognize_chemical_structure` accepts an
injected `upsertIndex` that persists usable results. The index upsert is a
best-effort enhancement — a failing write is swallowed so the analysis result
still returns. `search_patent_figure` no longer reports `setup_required`: an
absent or empty index returns zero hits with a guidance hint.

The chemistry engine is still unavailable because RDKit is not bundled, so the
recognize write closure is unreachable in this build and carries a v8 ignore
with a reason; it becomes live when the engine produces a usable result.

## Alternatives considered

- **Port the Sati vector/hybrid retrieval path.** Sati retrieves figures with
  embedding-based search. dsh ships no vector infrastructure and
  `patent_case_search` already dropped semantic recall for the same reason, so
  figure retrieval stays keyword-only over the index.
- **Give figure and chemistry each their own bespoke index implementation.**
  The two stores differ only in entry shape, key, comparator, and version label.
  A shared factory removes the duplication while keeping each store's contract
  explicit.
- **Write the analyze result synchronously to disk in the tool.**
  A naive write loses updates under concurrent analyze calls and silently
  overwrites a damaged index. The factory's per-path serialization, atomic
  write, and corrupt-file backup protect both.

## Consequences

- `search_patent_figure` works out of the box in an assembled host: an empty
  or absent index returns a hint, not a hard failure.
- Analyzed figures persist across sessions in the workspace index file, and
  re-analysis of the same image overwrites its entry instead of duplicating it.
- The figure index is bounded in size (one entry per image path) and written
  atomically, so an interrupted write cannot corrupt the committed file.
- The chemistry index store and write wiring land ahead of the RDKit engine;
  the write closure is v8-ignored as unreachable until then.
- Coverage additions pin the load failure, sort, validation, and Config
  resolution branches the wiring introduced.

## Testing

`packages/patent/patent-tools` tests cover the factory's load/upsert contract
(ENOENT, version mismatch, structural anomaly, invalid-entry dropping, corrupt
JSON, non-ENOENT rethrow, concurrent upsert serialization, corrupt-backup),
both stores' keying and sorting, and the assembled plugin wiring: analyze
persists into `Config.figureIndexFile`, search serves from an absent default
index without error, and `Config.chemistryIndexFile` resolves for the recognize
wiring. All 348 patent-tools tests pass and the package's source files are at
100% statement coverage.
