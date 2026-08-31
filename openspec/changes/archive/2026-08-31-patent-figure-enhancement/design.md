## Context

The patent-figure subsystem in `@deepseek-ai/dsh-patent-tools` already produces SVG/PNG/PDF through a `dot` CLI subprocess (`graphviz-renderer.renderWithGraphviz`) and analyzes figures through a single LLM pass. See `proposal.md - Why` for the five gaps being closed. The design constraint set that shapes every decision: repository rules demand deployment-varying values be schemastery `Config` fields (never hardcoded), failures be loud `setup_required`/`tool_execution_failed` rather than silent, registrations be effects, and behavior changes be covered by tests that describe observable behavior.

## Goals / Non-Goals

**Goals:**

- Keep the `GraphvizRenderSpec`/`GraphvizRenderOutcome` contract stable so `generate-patent-figure.ts` and its tests change minimally across renderer swaps.
- Keep tool behavior, error semantics, and unconfigured defaults unchanged, so the existing 138 figure tests and real-render smoke stay green. Rendered artifacts are not guaranteed byte-identical under the renderer swap (same output contract, possibly different Graphviz build); that difference is documented rather than hidden.
- Add submission-layout control through configuration with per-call override.
- Produce standard "numeral + leader line" output for block/hierarchy figures while preserving flowchart conventions.
- Make multi-panel and cross-figure numeral continuation deterministic and safe on legacy index data.
- Keep two-step analysis opt-in so single-step behavior (and its costs) is the default.

**Non-Goals:**

- Vector/semantic retrieval for `search_patent_figure` (explicitly deferred; needs dsh vector infra not present).
- A dedicated small-model detector for figure analysis (PatentVision-style) — out of scope; two-step here means two model passes over the same vision route.
- Changing the figure index on-disk schema in a way that breaks old files (legacy entries must be readable).

## Decisions

### D1. Bundled WASM renderer with CLI fallback for PDF

Use `@viz-js/viz` (MIT, Graphviz WASM) as the default renderer; keep `renderWithGraphviz` as the `cli` path and as the PDF fallback. A new `figure/render-selector.ts` returns the render function from `config.figureRenderer: 'wasm'|'cli'` (default `wasm`). Reusing `GraphvizRenderSpec` means the tool body, output assembly, and index upsert are untouched.

- Alternatives considered: `@hpcc-js/wasm` (Apache-2.0, larger API surface) — rejected as it exposes a lower-level interface with more assimilation cost; keep WASM only (drop native entirely) — rejected because Phase 0 confirmed the WASM build ships text-format plugins only (SVG renders; PNG and PDF throw `Format not recognized`), so a CLI fallback keeps PNG/PDF working. `research/phase-0-pre-research.md` records the measured matrix.
- The WASM engine is loaded through a dynamic `import()` inside the renderer, so the ~2 MB standalone module stays off the initial load path and out of a single inlined bundle. A load failure returns renderer outcome `not_installed` with a message naming the bundled engine; the tool layer's existing `not_installed` → `setup_required` mapping is reused unchanged. A render error returns `render_failed` (mapped to `tool_execution_failed`) and cancellation returns `aborted` (mapped to `tool_aborted`), so error semantics do not change. The PDF fallback to the CLI renderer lives in `render-selector.ts` (which holds the subprocess and executable override), not inside `renderWithVizWasm`.

### D2. Submission layout via DOT graph attributes

Apply page/size/dpi/margin/orientation by emitting graph-level DOT attributes (`page`, `size`, `margin`, `dpi`, `orientation`) from `buildDotHeader`, so both the WASM and CLI renderers honor them identically. No `ratio` attribute: `size` alone already scales down with aspect preserved. `page` follows the page size (dimensions swapped when landscape); `size` (page minus twice the margin) is emitted only when page size and margin are both set; `margin` alone emits a standalone margin line; `orientation=landscape` is asserted at the DOT layer and only emitted for landscape (portrait is implicit). Per-call inputs (`page_size`, `dpi`, `margin`, `orient`) override `Config` (`figurePageSize/figureDpi/figureMargin/figureOrientation`; the per-call set mirrors the Config set); absent both → emit nothing (before/after behavior identical).

- Alternatives considered: renderer-specific options only (would diverge between the two backends) — rejected; a single DOT-level source of truth keeps behavior uniform and testable at the DOT layer.

### D3. Leader-lines as a separate SVG post-processor

New pure module `figure/leader-line.ts` parses Graphviz SVG node groups (`<g id="nodeN">`, shape bbox, `<text>` anchor) and renders a numeral outside the node with a leader line. The existing `svg-annotate.ts` text-injection path is preserved for `add_patent_figure_references` and exports its input-safety checks for reuse. The builders currently embed the numeral in the node label (`label (NN)` for block/hierarchy, `NNN. ` prefix for flowcharts), so the three builders gain `embedNumerals?: boolean` (default `true`); when leader lines will apply, the tool builds DOT with `embedNumerals: false` and passes the numeral map to the SVG post-processor, so each numeral is drawn exactly once. Default enablement branches on the resolved figure type: block-diagram and hierarchy → leader lines; flowchart → embedded `NNN.` prefix. Non-SVG with leader lines requested returns a warning and still produces the artifact.

- Alternatives considered: extending `annotateSvg` in place (single function, two modes) — rejected; keeping text-injection and leader-line as distinct, independently tested pure functions is simpler to verify and preserves the existing security checks in one place.

### D4. Multi-panel and cross-figure continuation via shared numeral assignment

Multi-panel: the panel component ids are concatenated into a single `assignNumerals` call and the result split per panel, so FIG. 1A/1B draw from one continuous series; each panel writes a distinct `figN<suffix>` file and the description is merged. Cross-figure continuation is opt-in: the generation tool gains a `figure_family` input (absent by default → no continuation, preserving per-figure numbering) and a `loadIndex` dependency; when a family is declared, prior entries scoped by `figureFamily` seed the assignment — components present in this figure keep their numeral through `explicit`, and numerals held by absent family components are passed through a new `reserved` list on `AssignNumeralsOptions` (occupied but not assigned), which automatic assignment skips. `FigureIndexEntry.analysis` gains an optional `figureFamily`; legacy entries without it are treated as unscooped and never cause errors.

- Alternatives considered: a process-level in-memory numeral store keyed by session — rejected because tool calls are stateless and the durable figure index already records prior figures; reading it is the natural single source of truth.

### D5. Two-step analysis behind a `FigureAnalysisEngine` capability seam

Introduce a service definition (`FigureAnalysisEngine.analyze(...)`), a default single-step provider (wrapping existing logic), and a `TwoStepModelEngine` (structure extraction → description generation over the same vision route). `analyze-patent-figure.ts` consumers dispatch on an injected engine. `figureAnalysisMode: 'single'|'two-step'` (default `single`) selects the provider; when the first step is unparseable, return a best-effort result plus a warning instead of throwing, so the image gate, attachment admission, and result shape stay identical.

- Alternatives considered: a hardcoded two-step always-on — rejected; making it configurable keeps cost and accuracy choices in the deployment's hands and guarantees zero regression on the default path.

## Risks / Trade-offs

- [WASM covers SVG only] → Phase 0 measured the matrix: `@viz-js/viz` 3.29.0 renders SVG (plus other text formats) but throws for PNG and PDF. The selector therefore routes PNG and PDF through the CLI fallback; with no `dot` binary those formats fail `setup_required` while SVG stays dependency-free. The ~1.2 MB ESM module stays off the initial load path via dynamic `import()`.
- [Leader-line geometry may collide with nodes/labels] → Enable only for block/hierarchy (small node counts); try outer candidate points and pick the first collision-free one; on failure, fall back to an embedded numeral and add a warning rather than drawing a bad line.
- [Cross-figure continuation depends on a new `loadIndex` dependency] → Legacy index without `figureFamily` is treated as unscooped; only generation-time read is added, and write/read both tolerate missing fields.
- [Two-step analysis doubles model cost per figure] → Default is single-step; two-step is opt-in and can be revisited if quality gain is marginal.
- [Changing `figureRenderer` default to WASM is a behavior swap] → Same output contract; keep `cli` reachable for hosts that must pin the native binary; treat any format WASM cannot produce as a documented fallback rather than a silent failure. Rendered artifacts may differ between the WASM and CLI Graphviz builds; record that in the README and the Agent Note.

## Migration Plan

1. Land Phase 0 pre-research findings to confirm WASM format support and SVG node structure for leader lines.
2. Add WASM renderer + selector with `figureRenderer` config (default `wasm`), keeping `cli` as fallback — no config migration needed; existing deployments keep working via the fallback path.
3. Add submission-layout config + DOT attributes; defaults emit nothing.
4. Add leader-line post-processing; default-on for block/hierarchy, off for flowchart.
5. Add multi-panel + opt-in `figure_family` continuation with `reserved` numerals and `loadIndex`; old index files remain valid.
6. Add two-step analysis seam; default single.

Rollback: each phase is independently reverted because config fields are additive and default to prior behavior; reverting `figureRenderer` to `cli` restores the exact legacy rendering path.

## Open Questions

Both open questions were resolved in Phase 0; findings and measurement evidence live in
`research/phase-0-pre-research.md`.

- **O1 (resolved)** — `@viz-js/viz` 3.29.0 renders SVG on Node but not PNG/PDF (no raster plugins in the WASM build); ESM entry is ~1.2 MB with the WASM inlined. The design's CLI fallback covers PNG and PDF.
- **O2 (resolved)** — `dot` CLI and the WASM engine emit identical SVG node-group structure (`<g id="nodeN">` + `<title>{dot id}</title>` + `<polygon points>`/`<ellipse>` + `<text text-anchor="middle">`); one parser serves both, and the leader-line test fixtures cover at least the WASM output.
