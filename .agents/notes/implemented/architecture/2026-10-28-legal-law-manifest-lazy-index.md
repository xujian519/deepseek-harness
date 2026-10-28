# Agent Note: Load legal-law baselines per cited law from a shipped manifest

Status: implemented

English | [中文](2026-10-28-legal-law-manifest-lazy-index.zh.md)

## Problem

`legal_law_verify` parsed all 7,910 files of the shipped legal-law index before it read its arguments: a first call citing only 《民法典》 took 13.2 s and grew RSS by 199 MB. An empty input paid the same cost before returning its input error (`no_input`), and cancellation could not interrupt the load.

Making the load lazy exposed a second cost on the same path. The statute pattern listed every known law name and document title — 7,910 names plus 485 titles — as one 8,395-branch alternation. V8 compiles a regexp this wide to native code on its second execution, and that compilation took 7.8 s for the 125 KB pattern, so the first citation parse still blocked for seconds after the whole-corpus load was gone.

## Decision

The index ships `assets/legal-law/manifest.json`: one `[law, document, file]` row per law, sorted by law name, generated from the YAML files by `scripts/legal-knowledge-import/generate-law-manifest.ts`. `generate-law-yaml.ts` rewrites the manifest after it writes YAML files, and `assertLegalLawIndexReadable` rejects a directory without one at plugin load, so a `baselineDir` override cannot register and then fail on its first citation.

`createLegalLawIndex(baselineDir?)` replaces the whole-corpus loader in the plugin:

- `loadNames(signal)` reads the manifest once (a failed read leaves the next call free to retry) and registers every law name and document title with the reference parser.
- `load(laws, signal)` parses only the named laws, caches each baseline for the index's lifetime, shares one in-flight read per law, and rejects a file whose `law` or `document` disagrees with its manifest row.

The tool runs `citationInputProblem`, then `loadNames`, then extracts references, then loads the laws the references name, then verifies. The input error and `unparsable_reference` both fail before any law file is read. `citationVerifyExecute` forwards the tool executor's `AbortSignal` to the domain `run`. The manifest and each law read belong to the index rather than to one caller, so an abort ends that caller's wait and leaves a read shared with another caller running; `loadLegalLawBaselinesAsync` owns its reads and passes the signal to `readFile`, so its read is interrupted.

The parser keeps one regexp per 500 name alternatives. `extractLegalLawReferences` runs every chunk, then walks the matches by start position, skipping any match that begins inside a span already consumed, which reproduces the single left-to-right scan the full alternation performed. Chunks hold the longest names first, so the first match at a position is the longest name there.

## Alternatives considered

**Generate a name index instead of shipping a manifest.** Reading the first two lines of 7,910 files is the cost this change removes, and a generated name index would be a second artifact to keep in step with the files it describes.

**Keep the whole-corpus load and only reorder validation.** The empty-input case would improve, but a valid one-law citation would still parse 7,910 files and retain 199 MB.

**Cache parsed baselines in a module-level map.** `packages/AGENTS.md` requires shared state to have an owner; the index instance is that owner. A law parses in about 70 ms, so the per-instance cache removes the repetition a verification session actually pays.

**Keep one statute pattern and pre-warm it.** Pre-warming moves the 7.8 s compile into `loadNames`, which still runs on the first call.

**Match the article alone and look the law name up backwards.** This removes the alternation entirely and has the smallest runtime cost, but it re-implements the name-article boundary the grammar defines. Chunking kept the grammar and its tests; during development, both implementations returned identical references for every name form in the shipped manifest, and `reference.spec.ts` pins the nested-name case across a chunk boundary.

## Consequences

First `legal_law_verify` citing one law, built artifacts, 20 fresh tool instances: p50 93–95 ms, p95 100–102 ms, first call 91–93 ms, and `heapUsed` grows about 6 MB. The issue's RSS target of 20 MB is **not met**: a first call grows process RSS by 26–41 MB, because parsing the 502 KB law file alone grows a fresh process by 47 MB inside the `yaml` parser while retaining 1.5 MB. Meeting that number requires a different article format or a streaming parser, not a change to which laws are loaded; the full-corpus baseline was 13.2 s and +199 MB.

The empty input returns its input error in 0.3 ms without reading the manifest; [tool.spec.ts](../../../../packages/legal/legal-law/tests/tool.spec.ts) pins that no index method is called.

Costs:

- A `baselineDir` without `manifest.json` fails at plugin load.
- `LegalLawVerifyToolOptions.baselines` accepts a loaded `Map` or a `LegalLawIndex`; the function-loader form is gone.
- Each extraction scans a text once per chunk — 17 chunks for the shipped corpus.

## Testing

- `baseline.spec.ts` covers manifest parsing and its rejection cases, a manifest-backed index that learns names without parsing a law, per-law parsing, cache reuse, an unlisted law, a missing manifest, a file that disagrees with its row, concurrent loads sharing one read, aborts before and during a read, and one caller's abort leaving another caller's load intact.
- `tool.spec.ts` covers an unusable call and an unparsable reference making no index call, loading only the cited laws, and the caller's signal reaching the index.
- `plugin.spec.ts` and `verify.spec.ts` exercise the manifest-backed index through the real plugin composition.
