# Agent Note: Figures generation in the patent domain (Graphviz-backed)

Status: implemented

English | [中文](2026-08-28-patent-figure-generation.zh.md)

## Problem

The patent domain shipped figure *analysis* only (`analyze_patent_figure`, `recognize_chemical_structure`, `search_patent_figure` plus the figures-index persistence) — the drafting stage had no way to *produce* patent-style figures. Capturing a figure-description skill (Claude-Patent-Creator's `diagram_generator` / `add_diagram_references`, MIT) makes the loop concrete: claims/description → structured input → DOT → patent-style SVG/PNG/PDF with reference numerals → numeral map + 附图说明 sentence → figure index (searchable, cross-checkable by `analyze_patent_figure`).

## Decision

Port the generation side natively into `packages/patent/patent-tools` (no Python process, no WASM, no torch stack): Graphviz `dot` CLI through `ctx.subprocess.spawn` in the `pdfRenderer` candidate-path pattern. Three new modules plus two tools:

- `figure/dot-builder.ts` — pure DOT builders (flowchart / block_diagram / component_hierarchy / four built-in templates) with patent-style rules: zero fillcolors in the default `grayscale` mode (CNIPA Guidelines Part I Chapter 1 §4.3, 2023 rev.; `semantic` color fills permitted only when color carries technical content), decision diamond branches MUST carry edge labels, numerals embedded in node labels (`Processor (20)`, `101. receive`), one numeral series per figure (FIG.N = 100+100·(N−1), default step 2, explicit `numerals` for cross-figure reuse).
- `figure/svg-annotate.ts` — post-process existing SVGs with ` (numeral)` at matching `<text>`/`<tspan>`; rejects DOCTYPE/ENTITY/CDATA and oversized input, reports unmatched references as warnings.
- `figure/graphviz-renderer.ts` — `findDot` (override → `DSH_GRAPHVIZ_DOT` → platform candidates → PATH), `probeGraphviz` (`dot -V`), `renderWithGraphviz` (argv-only subprocess, stdin DOT, timeout/abort classification, install guidance on absence).
- `tool/generate-patent-figure.ts` (+ `add_patent_figure_references.ts`) — registered in `apply()` with `Config.graphvizExecutable` / `figureOutputDir` / `dotFont`; numeral assignment runs once and drives both the DOT and the returned numeral map; `persist_index` (default on) upserts a deterministic `FigureAnalysisResult` (confidence 1, `modelUsed='graphviz-generator'`) into the existing figures-index, closing the loop: generate → search → analyze re-check.

Rejected: the MCP bridge (duplicates the Sati-port decision — model-visible surfaces must be native to dsh), BigQuery/EPO/USPTO search, and the full plugin; the port is scoped to figures only.

## Verification

Unit coverage: dot-builder (assign numeral series, conflict detection, black/white style, decision edge labels, template numerals 101-105), svg-annotate (safety rejection, multi-hit, warnings), graphviz-renderer (discovery order, exit/abort/render-failure classification via injected subprocess), tool level (input validation, error-code mapping, index upsert + silence on failure, search end-to-end over the real index store). New files hold 100% statement/branch/function/line coverage.

## Notes

Graphviz is a system dependency: without `dot` the tool fails loud with `setup_required` and install guidance (brew/apt/winget). Known limitations (see README): no leader-line numerals (embedded in labels), single-figure only (no FIG. 1A/1B), no cross-figure automatic numeral memory, `raw_dot`/`template` outputs have no structured component reconstruction for the index.
