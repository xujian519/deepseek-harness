# Agent Note: Patent figure rendering defaults and analysis modes

Status: implemented

English | [中文](2026-08-31-patent-figure-rendering-pipeline.zh.md)

## Problem

The patent figure tools had one rendering path (`dot` CLI subprocess), one figure per call, numerals embedded in component labels (`Processor (20)`), a numeral series reset to 100 on every call, and a single-model-pass analyzer. SVG generation failed loud on machines without Graphviz; submission-grade layout (page size, dpi, margin) had no representation; cross-figure numeral continuity required the caller to restate every numeral by hand; and the analyzer's structure grounding and description prose could not be improved independently of each other.

## Decision

- **Renderer selection is owned by `figure/render-selector.ts`.** `Config.figureRenderer` defaults to `wasm`: SVG renders through the bundled `@viz-js/viz` engine with no system dependency; png/pdf — formats the bundled build cannot produce (measured in pre-research) — route to the `dot` CLI, which stays a system dependency for those formats and for `figureRenderer: 'cli'`.
- **Submission layout is a DOT `page` bundle.** `figurePageSize`/`figureOrientation`/`figureDpi`/`figureMargin` (plus per-call `page_size`/`orient`/`dpi`/`margin`) emit `page`/`size`/`margin`/`dpi` graph attributes; absent fields emit nothing.
- **Leader-line numerals are an SVG post-pass** (`figure/leader-line.ts`): node labels drop the embedded numeral, and a collision-free outer anchor gets a `<line>` plus standalone numeral text. Default on for block-diagram/component-hierarchy SVG, off otherwise; non-SVG formats keep embedded numerals and return a warning.
- **Multi-panel and family continuation share one numeral series.** `panels` renders `figN`+suffix files from a single `assignNumerals` call split per panel; a per-call `figure_family` scopes prior index entries by the recorded `figureFamily`, seeds components present in the figure as explicit assignments, and passes the rest as reserved numerals that automatic assignment must skip. Matching is by normalized component name because index entries store `name` + `refNumber`, not component ids; entries without `figureFamily` never participate.
- **`figure/analysis-engine.ts` is the analysis mode seam.** The tool type-imports it (no runtime cycle; the two-step engine value-imports the tool module's shared normalizers). `Config.figureAnalysisMode: 'two-step'` selects a structure-extraction pass then a description pass over the same vision route; an unparseable first pass returns empty components plus a warning and skips the second pass. The image gate, attachment admission, and index writes stay in the tool layer, identical in both modes.

## Alternatives considered

**Keep the CLI as the only renderer.** SVG generation would keep requiring a Graphviz install on every machine; the bundled engine removes that for the default format while png/pdf keep the CLI supported.

**Render png/pdf through the WASM engine.** The bundled build ships text-format plugins only; pretending otherwise would turn a clean `setup_required` into a mid-render failure.

**Draw leader lines in DOT.** Graphviz has no outer-anchor or leader-line primitive; annotation has to happen on the rendered SVG, where node group geometry is inspectable.

**Continue numerals by component id.** Index entries store component name and numeral only; ids would break the on-disk index format, so family matching uses normalized names with first occurrence winning.

**Make `figureFamily` required and reject old index entries.** Silent history loss; the tolerant guard keeps old indexes loadable and simply excludes those entries from continuation.

**Put the two-step flow behind an if/else in the tool.** Mode selection, prompts, and degradation are engine policy; the seam keeps the tool's gating and indexing logic mode-independent.

## Verification

Unit coverage across the figure/registration/analyze specs (212 tests) and a package-level `tsc --noEmit`. No recorded-session snapshot applies: the top-level `snapshots/` tree contains no patent content and the patent profile is not snapshot-registered ([the vision-path note](2026-08-30-patent-figure-vision-path.md) reached the same conclusion for `analyze_patent_figure`); the tool description and input-schema changes here are model-visible, so registered-tool prefix reuse shifts once per deployment.

## Consequences

- SVG generation needs no system dependency; png/pdf and `figureRenderer: 'cli'` still fail loud with install guidance when `dot` is missing.
- `figureAnalysisMode: 'two-step'` doubles per-analysis model cost; `single` keeps byte-identical prompts to the pre-seam path.
- Family continuation matches by name: a component renamed across generations draws a fresh numeral, and first occurrence in the index wins.
- Electrical netlists and SMILES parsing remain deferred (owned by the package README's Known Limitations).
