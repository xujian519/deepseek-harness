# Tasks

Reference specs for behavior and design for approach. Open questions O1/O2 are resolved in Phase 0 and do not change what is built (design accommodates either answer).

## 0. Phase 0 — Pre-research (read-only)

- [x] 0.1 Confirm `@viz-js/viz` format matrix on Node (`renderString` for svg/png/pdf): record which formats produce a buffer vs throw, and the bundle size; record the conclusion in a note (verify: node script prints the outcome for each format) — resolved: SVG OK; PNG/PDF throw (text-format plugins only); ESM entry ~1.2 MB; see `research/phase-0-pre-research.md`
- [x] 0.2 Inspect real block-diagram SVG output from both the `dot` CLI and the WASM renderer (the default path) and record the node-group structure (group `id`, shape bbox, `<text>` anchors) that leader-line parsing will rely on, noting structural differences between the two engines (verify: both SVGs produced and inspected; findings captured in a short note) — resolved: structures identical (`<g id="nodeN">`/`<title>`/`<polygon>`/`<text>`), coordinate deltas only; see `research/phase-0-pre-research.md`

## 1. Wasm rendering (spec: patent-figure/wasm-rendering)

- [x] 1.1 Add `@viz-js/viz@^3.29.0` to `dependencies` in `packages/patent/patent-tools/package.json` and run `pnpm install` (verify: `pnpm install` succeeds and lockfile updated)
- [x] 1.2 Implement `src/figure/viz-wasm-renderer.ts` `renderWithVizWasm(spec)` returning `GraphvizRenderOutcome`, writing the returned buffer to `outputDir/<filename>.<format>`; load the engine via dynamic `import()` and map load-failure→outcome `not_installed` (message naming the bundled engine; tool layer already maps it to `setup_required`)/render-failure→`render_failed`/abort→`aborted`; no PDF fallback inside the renderer (verify: new `tests/figure-viz-wasm-renderer.spec.ts` covers success write, load-failure, abort, and unsupported-format paths)
- [x] 1.3 Implement `src/figure/render-selector.ts` `pickRenderer(config)` returning the render function for `figureRenderer: 'wasm'|'cli'` (default wasm), with the CLI path delegating to `renderWithGraphviz` using `config.graphvizExecutable` and the selector owning the wasm→cli fallback for formats the WASM engine cannot produce (png, pdf — measured in 0.1) (verify: `tests/figure-render-selector.spec.ts` asserts wasm default, cli path, and the png/pdf fallback routing)
- [x] 1.4 Add `figureRenderer?: 'wasm'|'cli'` to schemastery `Config` and its JSDoc in `src/index.ts`, and wire `renderDot` through `pickRenderer` in `apply()` (verify: `tests/index.spec.ts` wiring test passes; existing figure-generate tests still pass)
- [x] 1.5 Add WASM real-render branch next to `figure-graphviz-real-render.spec.ts` (`describe.skipIf(!vizAvailable)`) rendering SVG via WASM without a `dot` binary (verify: that spec passes)
- [x] 1.6 Run the figure/registration test subset plus `tsc --noEmit` for the package (verify: commands below green)

## 2. Submission spec (spec: patent-figure/submission-spec)

- [x] 2.1 Extend `buildDotHeader` in `src/figure/dot-builder.ts` with an optional `page` bundle emitting `page/size/margin/dpi/orientation` graph attributes; emit nothing when absent (verify: `tests/figure-dot-builder.spec.ts` covers with/without page)
- [x] 2.2 Add `figurePageSize/figureDpi/figureMargin/figureOrientation` to schemastery `Config` + JSDoc, and thread a computed page bundle into the DOT build and renderer spec in `generate-patent-figure.ts` (verify: `tests/figure-generate-tool.spec.ts` asserts DOT/page attributes and per-call override precedence)
- [x] 2.3 Add per-call `page_size/dpi/margin/orient` inputs (defaulting to Config) to `generate_patent_figure` and pass them through (verify: generate-tool spec asserts each override wins over the Config default)
- [x] 2.4 Run the DOT/generate/real-render subset plus `tsc --noEmit` (verify: commands green)

## 3. Leader-line numerals (spec: patent-figure/leader-line-numerals)

- [x] 3.1 Add `embedNumerals?: boolean` (default `true`) to the three DOT builders so node labels can omit the embedded numeral, keeping current output when absent (verify: `tests/figure-dot-builder.spec.ts` cases assert the default keeps ` (NN)`/`NNN. ` and `embedNumerals: false` omits them)
- [x] 3.2 Implement `src/figure/leader-line.ts` pure module `annotateSvgWithLeaderLines(svgText, references, options)` parsing Graphviz SVG node groups, picking a collision-free outer anchor, drawing a `<line>` + numeral `<text>`, and returning warnings for unmatched/must-skip nodes; reuse the safety checks exported from `svg-annotate.ts`, with fixtures covering at least the WASM renderer output (the default path) plus a `dot` CLI SVG (verify: `tests/figure-svg-annotate.spec.ts` new cases on real Graphviz SVG assert `<line` and numeral text, plus unmatched warnings)
- [x] 3.3 Extend `generate-patent-figure.ts` with `leader_lines?: boolean`, defaulting on for block-diagram/component-hierarchy and off for flowchart via the resolved figure type; when on and format is SVG, build the DOT with `embedNumerals: false`, read the rendered SVG, annotate, and write back; when format is not SVG, add a warning and still return the artifact (verify: generate-tool spec asserts block-diagram+svg contains `<line` and no ` (NN)` suffix, flowchart keeps prefix, block-diagram+png returns warning)
- [x] 3.4 Extend `add_patent_figure_references` input with `leader_lines?: boolean` passing through to the leader-line annotator (verify: add-references spec covers the new mode and the default inline mode)
- [x] 3.5 Run the svg-annotate/generate/real-render subset plus `tsc --noEmit` (verify: commands green)

## 4. Multi-panel + cross-figure continuation (spec: patent-figure/multi-panel-continuation)

- [x] 4.1 Make `figure_type` optional and infer it from the single present structural input (`steps`→flowchart, `blocks`→block_diagram, `tree`→component_hierarchy, `dot`→raw_dot, `template`→template); error on multiple/none (verify: generate-tool spec covers each inference and the ambiguous/empty error cases)
- [x] 4.2 Add `panels?: [{suffix, figure_type, steps/blocks/tree/dot/template, numerals}]`; concatenate all panel component ids into one `assignNumerals` call and split the result per panel, write `figN<suffix>.<format>` per panel, reject `panels` combined with top-level structural inputs or an empty `panels` list, and merge the figure description (verify: generate-tool spec asserts two-panel files with `fig1A`/`fig1B` names, continuous non-duplicate numerals, and the invalid-input rejection cases)
- [x] 4.3 Add optional `figureFamily` to `FigureIndexEntry.analysis`, tolerate legacy entries lacking it, and record it in `indexAnalysis` (verify: `tests/index-store.spec.ts` and figure-index load handle old/new entries)
- [x] 4.4 Extend `AssignNumeralsOptions` with `reserved?: readonly string[]` — numerals occupied by family components absent from this figure — so automatic assignment skips them (verify: `tests/figure-dot-builder.spec.ts` covers reserved-skipping and its collision with `explicit`)
- [x] 4.5 Add an optional per-call `figure_family` input (default absent → no continuation) and a `loadIndex` dependency to `createGeneratePatentFigureTool`; when a family is declared, scope prior entries by `figureFamily`, seed `explicit` for components present in this figure and `reserved` for the rest (verify: generate-tool spec performs two generations of a declared family asserting same-component same-numeral and collision-free continuation, plus a family-omitted generation asserting fresh per-figure numbering)
- [x] 4.6 Wire `loadIndex: () => figureIndexStore.load(figureIndexFile)` in `apply()` in `src/index.ts` (verify: `tests/index.spec.ts` wiring test passes)
- [x] 4.7 Run the generate/index-store/registration subset plus `tsc --noEmit` (verify: commands green)

## 5. Two-step analysis engine (spec: patent-figure/two-step-analysis)

- [x] 5.1 Introduce the `FigureAnalysisEngine` service definition (analyze over an image ref + context) in `src/figure/` (verify: typecheck + a smoke assertion that the seam is exported)
- [x] 5.2 Wrap the existing single-step logic as the default single-step provider (verify: `tests/analyze-patent-figure.spec.ts` single-step assertions still pass unchanged)
- [x] 5.3 Implement `TwoStepModelEngine` (structure extraction pass → description generation pass over the same vision route), degrading to a best-effort result + warning when the first step is unparseable (verify: two-step spec case asserts two model passes and the degraded fallback case)
- [x] 5.4 Add `figureAnalysisMode?: 'single'|'two-step'` (default `single`) to schemastery `Config` + JSDoc, select the injected engine in `apply()`, and assert the image gate and result shape are preserved in both modes (verify: `tests/analyze-patent-figure.spec.ts` two-step + gated-model + result-shape cases pass; `tests/index.spec.ts` wiring passes)
- [x] 5.5 Run the analyze/registration subset plus `tsc --noEmit` (verify: commands green)

## 6. Docs, catalog, and final verification

- [x] 6.1 Update `packages/patent/patent-tools/README.md` Config table and Known Limitations to reflect WASM-renderer default, submission-layout config, leader-line default (block/hierarchy), multi-panel/continuation, and two-step mode (verify: README reviewed; wording direct, no narration)
- [x] 6.2 Regenerate `docs/tool-catalog.md` and run `pnpm run doc-sync` (verify: doc-sync passes)
- [x] 6.3 Add an Agent Note under `.agents/notes/` for the non-trivial behavior changes, in the same PR (verify: note file present, archive-rule compliant)
- [x] 6.4 Determine whether any keyless recorded-session snapshot exercises the patent figure tools, record the conclusion, and update the affected snapshot in this change if covered (tool description/input schema changes are model-visible) (verify: conclusion recorded in the change or note; `pnpm run test:snapshot` green after any update) — resolved: not covered; the top-level `snapshots/` tree has no patent content, `packages/patent` has no vitest snapshot usage, and the patent profile is not snapshot-registered (the 2026-08-30 vision-path note recorded the same conclusion); conclusion recorded in the 2026-08-31 rendering-pipeline note, so no snapshot update or `test:snapshot` run is required
- [x] 6.5 Run the targeted check set from `dsh-pre-push-checks` for the patent-figure diff plus the full figure/registration/analyze subset and `pnpm exec tsc --noEmit -p packages/patent/patent-tools/tsconfig.json` (verify: all green)

## Verification commands

```sh
pnpm vitest run packages/patent/patent-tools/tests/figure-viz-wasm-renderer.spec.ts packages/patent/patent-tools/tests/figure-render-selector.spec.ts packages/patent/patent-tools/tests/figure-dot-builder.spec.ts packages/patent/patent-tools/tests/figure-svg-annotate.spec.ts packages/patent/patent-tools/tests/figure-generate-tool.spec.ts packages/patent/patent-tools/tests/figure-graphviz-real-render.spec.ts packages/patent/patent-tools/tests/analyze-patent-figure.spec.ts packages/patent/patent-tools/tests/index-store.spec.ts packages/patent/patent-tools/tests/index.spec.ts
pnpm exec tsc --noEmit -p packages/patent/patent-tools/tsconfig.json
pnpm run doc-sync
pnpm run test:snapshot   # per task 6.4 conclusion
```
