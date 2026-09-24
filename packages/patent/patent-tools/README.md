---
description: "Function plugin porting the Sati patent-domain tool set into the DeepSeek Harness. It registers 29 model-facing tools across search, metadata, knowledge queries, claim-chart, office-action parsing, drafting, analysis reports, evidence judgment, rule checking, figure generation, and the workflow/plan state machines. Each tool returns a losslessly JSON-serializable canonical value and exposes a pure `output.render` function that produces the model-facing prose (Sati has no render split; this is the new dsh contract)."
kind: "package-reference"
---

# @deepseek-ai/dsh-patent-tools

English | [中文](README.zh.md)

## Summary

Function plugin porting the Sati patent-domain tool set into the DeepSeek Harness. It registers 29 model-facing tools across search, metadata, knowledge queries, claim-chart, office-action parsing, drafting, analysis reports, evidence judgment, rule checking, figure generation, and the workflow/plan state machines. Each tool returns a losslessly JSON-serializable canonical value and exposes a pure `output.render` function that produces the model-facing prose (Sati has no render split; this is the new dsh contract).

## Table of Contents

- [Tools](#tools)
- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Tools

| Tool | Category | Data source / engine |
| --- | --- | --- |
| `patent_search` | search | `@deepseek-ai/dsh-patent-data` (nuo `searchPatents`, LRU-cached) |
| `patent_metadata` | search | `@deepseek-ai/dsh-patent-data` (nuo `scrapePatent`, LRU-cached) |
| `patent_legal_status` | search | `@deepseek-ai/dsh-patent-data` (nuo `LegalStatusChecker`) |
| `patent_case_search` | knowledge | `ctx.patentKnowledge.caseLawSearch` (knowledge.db FTS5) |
| `patent_wiki_search` | knowledge | `ctx.patentKnowledge` wiki cards |
| `patent_kg_query` | knowledge | `ctx.patentKnowledge` knowledge graph |
| `patent_eval` | quality | deterministic (inline slop engine) |
| `patent_analysis_report` | analysis | `@deepseek-ai/dsh-patent-core` analysis-report aggregator + optional ModelPort |
| `claim_chart_build` | drafting | `@deepseek-ai/dsh-patent-core` claim-chart atom + ModelPort; `mode: infringement` adds a deterministic conclusion (per accused product all-elements coverage, equivalence contradictions, and a risk level once `risk` supplies the defense and remedy facts) |
| `parse_office_action` | analysis | deterministic `@deepseek-ai/dsh-patent-core` office-action parser (rejection types, cited references with relevance, affected claims, examiner arguments) |
| `draft_claims` | drafting | deterministic |
| `draft_specification` | drafting | deterministic |
| `validate_specification` | quality | deterministic |
| `evaluate_evidence` | evidence | `@deepseek-ai/dsh-patent-core` evidence engine |
| `rule_check` | quality | `@deepseek-ai/dsh-patent-rule` rule engine |
| `analyze_patent_figure` | analysis | Vision ModelPort through a `FigureAnalysisEngine` (Config.figureAnalysisMode: `single` = one call, default; `two-step` = structure extraction, then description generation); image-input gated on the figure model |
| `search_patent_figure` | search | keyword retrieval over the figure index written by `analyze_patent_figure` (Config.figureIndexFile) |
| `generate_patent_figure` | drafting | Figure generation on two paths: Graphviz DOT (flowchart / state diagram / block diagram / component hierarchy / template / raw DOT) and direct SVG drawing (circuit, plot, cross-section, sequence diagram, appearance-design view sheet); bundled `@viz-js/viz` WASM for SVG (default), `dot` CLI for png/pdf and `figureRenderer: 'cli'` (Config.graphvizExecutable / figureOutputDir / dotFont); submission page/dpi/margin/orientation; leader-line numerals default on for block-diagram/component-hierarchy SVG; multi-panel `panels` output and cross-figure numeral continuation via `figure_family`; `target_office` lays the drawing out on a fixed-size drawing sheet and measures it; reports CNIPA drawing-wording warnings; persists to the figure index (Config.figureIndexFile) |
| `add_patent_figure_references` | drafting | SVG annotation post-processing: inline mode matches `<text>`/`<tspan>` content and appends `(numeral)`; `leader_lines: true` draws leader lines with standalone numerals outside the component outline |
| `generate_structure_figure` | drafting | FreeCAD TechDraw structure line-art: projects STEP/IGES/BREP models into black-and-white multi-view SVG (`iso`/`front`/`rear`/`top`/`bottom`/`left`/`right`) through the host `freecadcmd` subprocess (Config.freecadExecutable); callout numerals anchored to real projected 3D vertices; off by default (Config.structureFigureEnabled) and CAD-isolated; accepts a model file or a directory for batch rendering (a directory render is mutually exclusive with `callouts`, whose 3D anchor is model-specific); `target_office` lays every view SVG out on that office's sheet; persists to the figure index (`figureType: 'structure'`) |
| `patent_pdf_download` | document | browser-backend cold decision: ego-browser download intercept (unified ego stack) |
| `recognize_chemical_structure` | analysis | optional (rdkit not bundled); index upsert wired (Config.chemistryIndexFile) |
| `flexible_plan` | workflow | `@deepseek-ai/dsh-patent-workflow` flexible-plan |
| `patent_workflow` | workflow | `@deepseek-ai/dsh-patent-workflow` recap |
| `patent_workflow_run` | workflow | `@deepseek-ai/dsh-patent-workflow` + ModelPort |
| `patent_plan_task` | workflow | `@deepseek-ai/dsh-patent-workflow` plantask state machine |
| `patent_worker_validate` | quality | `@deepseek-ai/dsh-patent-workflow` worker contract |
| `knowledge_note_save` | knowledge | file writer under Config.noteDir (default `<cwd>/99-知识库`) |
| `workbench_link_patent_case` | workflow | personal-workbench loopback HTTP API: idempotent case bridge (patent_* dictionary seeding, root + L1–L5 stage tasks with `source='patent'`, `_matter-log.md` status projection; never writes the case dir, never patches the root task status) |

`render_patent_document` is owned by `@deepseek-ai/dsh-patent-document` (its `apply()` registers it); this package re-exports `createRenderPatentDocumentTool` and `renderDocumentResult` for library consumers but does not register it, so composing both plugins does not produce a duplicate-name error.

`slop-gate` is a workflow atom, not a model-facing tool: `apply()` registers `slopGateAtom` and `SlopGateHandler` into the global registries because the gate depends on this package's inline slop engine. It runs the deterministic analysis over `state.claims_draft`, writes `slop_report` + `slop_score`, and — when the draft fails the pass line — an evidence-only `slop_revision_hint` (matched phrases with suggested replacements, line-level structure issues; never score numbers, the total, or the pass line). The `patent_disclosure_v1` manifest's `slop_clean` stage gates the draft and rewinds to `draft_claims` on the fail signal, so the rewrite is produced with the hint injected. Library consumers also get `slopGateAtom`, `SlopGateHandler`, `SLOP_GATE_PASS_THRESHOLD`, and the hint builder `buildSlopRevisionHint`.

## Configuration

Schemastery configuration, every field optional.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `provider` | string | — | LLM provider route for the LLM-consuming tools (`patent_analysis_report`, `claim_chart_build`, `patent_workflow_run`, `flexible_plan`, `analyze_patent_figure`). |
| `model` | string | — | LLM model id for the LLM-consuming tools. |
| `imageModel` | object | — | Dedicated figure/image model route (`{ provider, model }`) whose declared input modalities gate `analyze_patent_figure`; falls back to `provider`/`model` when unset. |
| `maxTokens` | number | — | Optional output token cap for the LLM-consuming tools; omitted leaves the provider default. |
| `noteDir` | string | `<cwd>/99-知识库` | Knowledge-note directory for `knowledge_note_save` (absolute or relative to cwd). |
| `figureIndexFile` | string | `<cwd>/.sati/figures-index.json` | Figure index file: `analyze_patent_figure` writes analysis entries, `search_patent_figure` reads them (absolute or relative to cwd). |
| `chemistryIndexFile` | string | `<cwd>/.sati/chemistry-index.json` | Chemistry index file for `recognize_chemical_structure` upserts (absolute or relative to cwd). |
| `graphvizExecutable` | string | auto-probe | `dot` executable path override; discovery order: override → `DSH_GRAPHVIZ_DOT` → platform candidate paths → `PATH`. |
| `graphvizRenderTimeoutMs` | number | `60000` | Timeout for one CLI `dot` render; the WASM engine renders synchronously and is not covered by it. |
| `figureOutputDir` | string | `<cwd>/patent/figures` | Output directory for `generate_patent_figure` (absolute or relative to cwd). |
| `workbenchBaseUrl` | string | in-process webServer port | Personal-workbench API base for `workbench_link_patent_case`; explicit override wins, otherwise `http://127.0.0.1:<webServer port>` inside a web composition. Absent (non-web profiles) → the tool fails at execute with `setup_required`. |
| `workbenchCaseRoot` | string | `<cwd>/patent-workspace` | Case root directory for `workbench_link_patent_case`: each case lives at `<root>/<案号>/` with its `_matter-log.md`. |
| `dotFont` | string | platform-dependent | DOT font name override; default Helvetica, platform CJK candidates (PingFang SC / Microsoft YaHei / Noto Sans CJK SC) when labels contain CJK. |
| `figureRenderer` | `'wasm' \| 'cli'` | `wasm` | Graphviz renderer for `generate_patent_figure`: `wasm` is the bundled `@viz-js/viz` engine (SVG, no system dependency); `cli` runs the `dot` subprocess. png/pdf always route to the CLI. |
| `figureAnalysisMode` | `'single' \| 'two-step'` | `single` | `analyze_patent_figure` mode: `single` is one vision call; `two-step` runs structure extraction, then description generation, over the same route (doubles model cost). |
| `figurePageSize` | `'a4' \| 'letter'` | — | Submission page size; emits DOT `page`/`size` attributes when set (per-call `page_size` overrides). |
| `figureOrientation` | `'portrait' \| 'landscape'` | portrait | Submission page orientation (per-call `orient` overrides). |
| `figureDpi` | number | — | Submission render DPI (raster output; per-call `dpi` overrides). |
| `figureMargin` | number (cm) | — | Page margin on all four sides; with `figurePageSize` it shrinks the drawing `size` (per-call `margin` overrides). |
| `freecadExecutable` | string | auto-probe | `freecadcmd` executable path override for `generate_structure_figure`; discovery order: override → `DSH_FREECAD_CMD` → platform candidate paths → `PATH`. |
| `freecadRenderTimeoutMs` | number | `120000` | Timeout for one `generate_structure_figure` projection; FreeCAD starts colder than `dot`, so the default is twice as long. |
| `structureFigureEnabled` | boolean | `false` | Gate for `generate_structure_figure`: CAD stays isolated and off by default; while the gate is closed the tool fails loud with `setup_required` at execute. |
| `structureFigureScale` | number | `1` | Default TechDraw projection scale for `generate_structure_figure` (per-call `scale` overrides). |
| `structureFigureViews` | string[] | `['iso','front','top','right']` | Default view set for `generate_structure_figure` (per-call `views` overrides); each entry must be a supported view name (`iso`/`front`/`rear`/`top`/`bottom`/`left`/`right`), and an unknown name is rejected at config load. |

Two subprocess budgets stay fixed rather than configurable: the SIGTERM→SIGKILL escalation grace (3 s) because `dsh-patent-data`'s subprocess runner shares it and changing one ends teardown symmetry, and the per-stream output cap (100 000 bytes) because it bounds renderer memory. The exported `probeGraphviz`/`probeFreeCad` helpers take their own timeout from the caller (`DEFAULT_GRAPHVIZ_PROBE_TIMEOUT_MS`/`DEFAULT_FREECAD_PROBE_TIMEOUT_MS`); the plugin itself never probes, so no probe budget is configurable.

When `provider`/ `model` are unset the LLM-consuming tools register but fail loud (`setup_required`) when called. The knowledge tools require a knowledge.db prepared via `patent-knowledge:install`; they fail loud with install guidance when it is absent.

## Model Experience

### Tool schemas

#### What the model sees

29 registered tool definitions (see the table above), each with a description, parameter schema, and an `output.render` that renders the canonical result as Markdown prose. Exact descriptions and parameters are in the generated [`patent-tools` schema](../../../docs/tool-catalog.md#deepseek-aidsh-patent-tools).

#### Token effect

Fixed definition cost per registered tool on every request; result text is data-dependent and resent only until compaction. No system-prompt section is registered, so there is no additional fixed prompt cost.

#### KV Cache effect

Prefix-stable while the registered tool set and their descriptions are unchanged; changing configuration or the registered set shifts the tool definitions and invalidates reuse from that point.

## Known Limitations and Deferred Work

- **`render_patent_document` ownership** — the tool is registered by `@deepseek-ai/dsh-patent-document`, not here; this package only re-exports its factory.
- **`flexible_plan` name** — Sati's `patentFlexiblePlanTool.ts` declares the name `flexible_plan` (not `patent_flexible_plan`); the dsh tool trusts the Sati name field.
- **Image-modal gate scope** — `analyze_patent_figure` sends the drawing to the resolved figure-model route and is gated on that route's declared image input (denied with error code `model_cannot_accept_image` when absent); the bytes are admitted through the harness attachment store and travel as a durable ref, and an absent store or route fails loud with `setup_required`. `search_patent_figure` reads the index and is intentionally not gated (matches Sati, which gates analyze only). The index is written by `analyze_patent_figure` into Config.figureIndexFile; an absent or empty index returns zero hits with a guidance hint, not an error.
- **Chemistry engine not ported** — `recognize_chemical_structure` and the chemical-characterization check in `validate_specification` degrade to unavailable because the recognition pipeline (VLM two-step analysis, name→SMILES, RDKit validation) is not ported: RDKit is one of its missing pieces, not the only one, so the tool reports the unavailable result whatever the host has installed.
- **Figure/chemistry engines not ported** — the Sati `src/patent/figure` and `src/patent/chemistry` engines are not in any dsh package; the figure tools implement a minimal ModelPort path and keyword retrieval, and the figure/chemistry index stores (`figure/index-store`, `chemistry/index-store`) are wired for write+read. Netlist visualization and SMILES parsing (RDKit) remain deferred.
- **Figure generation scope** — `generate_patent_figure` renders SVG through the bundled `@viz-js/viz` WASM engine (Config.figureRenderer); png/pdf and `figureRenderer: 'cli'` go through the `dot` subprocess, which stays a system dependency — those paths fail loud with install guidance when it is missing. That WASM render is synchronous and cannot be interrupted once started, so input size is bounded: raw DOT longer than 64 000 characters (hierarchical/tree engines `dot`/`circo`/`twopi`) or 20 000 (force-directed `neato`/`fdp`/`sfdp`) also switches to the `dot` subprocess, and structured figures are capped at 200 graph elements (nodes + edges, nested nodes included) — rejected with `invalid_tool_input` beyond that, split them into `panels`. `raw_dot` must be self-contained: `image`/`shapefile`/`fontpath` file-reference attributes are rejected, because the subprocess path resolves them against the host filesystem. Leader-line numerals are on by default for block-diagram/component-hierarchy SVG (off for flowchart and `raw_dot`/`template`; per-call `leader_lines` overrides): numerals sit outside the component with a `<line>` connector instead of the embedded label suffix; non-SVG formats keep embedded numerals and return a warning. Placement converts node coordinates through the enclosing group's translation, skips positions that would cross a drawn edge, arrowhead, or edge label, and expands the root `viewBox`/`width`/`height` when a numeral or leader would fall outside the declared canvas — SVG content outside the canvas is not rendered. A node inside a scaled, rotated, or flipped group cannot be positioned this way: its numeral is embedded in the component label with a warning. After every generation the tool reports drawing-wording warnings derived from the Implementing Regulations of the Patent Law Article 21 and the CNIPA Guidelines Part I Chapter 1 §4.3: unnecessary annotations (annotation prefixes, text references, dimension callouts, scale callouts, sentence-ending punctuation), non-Chinese words (acronyms and numeric/symbol tokens excepted), a figure number drawn inside the figure, a numeral bound to brackets or quotes, and non-Arabic-numeral references; the check only reports and never rewrites the input. The vector figure types (`circuit`/`plot`/`cross_section`/`sequence_diagram`/`appearance_view`) bypass Graphviz and go through `vector-figure-build`, which emits millimetre-coordinate SVG fragments: circuit symbols placed on a grid with orthogonal wiring and filled junction dots, plots with axes, ticks and no scale annotation, cross-sections with 45° hatching (opposite direction or different spacing for adjacent parts) and cutting-plane marks, sequence diagrams with lifelines and message arrows, and appearance-design sheets that arrange the six orthographic views in first- or third-angle order at one shared scale with each view name below its own view. `panels` renders multi-figure sets (`fig1A`/`fig1B`, …) with one shared numeral series; a per-call `figure_family` continues numerals across generations for components recorded under the same family in the figure index — no family declared means independent per-figure numbering, and index entries without `figureFamily` never participate. `semantic` color fills are allowed only when color carries technical content per CNIPA Guidelines Part I Chapter 1 §4.3 (2023 rev., `grayscale` is the default); `raw_dot`/`template` outputs carry no structured components or connections (search-index entries remain partial).
- **Drawing submission profiles and page layout** — `figure/office-profile` fixes the verified per-office values: China A4 with 25/25/15/15 mm margins, the `图N` figure number (only from two figures up, per Guidelines Part I Chapter 1 §4.3) and drawing-sheet page numbers; PCT's usable drawing area and 0.32 cm minimum character height (Rule 11.6(c), 11.13(h)), `Fig. N` numbering, no colour (11.13(a)) and `1/3` sheet numbers; the USPTO margins and minimum character height (37 CFR 1.84(g), 1.84(p)(3)) with `FIG. N` numbering. Given `target_office`, `figure/submission-page` lays the drawing out on a fixed-size sheet (figure number below the drawing, sheet number at the bottom of the type area) and `figure/compliance` then checks the colour policy (PCT rejects colour outright; a US utility application needs a petition), unnumbered multi-figure sets, and the laid-out character height, returning the layout scale and sizes. Layout is SVG-only: Graphviz's `page`/`size`/`margin` attributes only affect the drawing's own canvas (measured locally on Graphviz 15.1.1 — `page` produces no sheet for svg/png/pdf, `size` only scales down when exceeded, `margin` only adds whitespace), so png/pdf returns a "not laid out" warning instead of silently emitting a drawing without the required sheet geometry. EPO is not in the profile table: EPC Rule 46/47 and the EPO Guidelines were unreachable during research (epo.org returns 403). The two-thirds readability rule only reports the measured reduced character height without a threshold warning, because none of the three offices states a numeric floor for that case.
- **Two-step analysis degradation** — with `figureAnalysisMode: 'two-step'`, an unparseable structure-extraction pass returns a best-effort result with empty components plus a warning and skips the description pass; the image gate and result shape are identical to `single`.
- **Structure figure scope** — `generate_structure_figure` requires host FreeCAD 1.1+ (`freecadcmd`) and stays off until `structureFigureEnabled: true`; a closed gate or a missing executable fails loud with `setup_required` and install guidance, never a silent schematic fallback. Each requested view becomes one `TechDraw::DrawViewPart` (not `DrawProjGroup.addProjection`, which throws in FreeCAD 1.1) rendered through `TechDraw.viewPartAsSvg` — the geometry fragment carries no template border, title block, or figure number, meeting the line requirements of CNIPA Guidelines Part I Chapter 1 §4.3; for two or more figures the `图N` number is written below the drawing by the `target_office` layout step, as that section requires the number to sit directly below its drawing — wrapped into a standalone black-stroke SVG. Callout numerals are anchored in the Python script via `DrawViewPart.projectPoint`, sharing the fragment coordinate frame, and are offset outward with a leader line. The subprocess HOME/temp/cache directories are redirected into the output directory (best-effort; macOS FreeCAD resolves its cache from `~/Library/Caches/FreeCAD` regardless of HOME), and the script pins the document `TransientDir` to an output-directory subdirectory, because TechDraw copies the page template relative to that property — a sandbox that denies the FreeCAD cache directory leaves it empty and resolves the copy to `/`, failing the render. Success is judged solely by exit code plus manifest presence because `freecadcmd` treats preference/cache write failures as non-fatal warnings. Output SVGs pass the same `assertSafeSvg` gate as the Graphviz path, and results persist to the figure index with `figureType: 'structure'`. With `target_office` every view SVG is laid out on that office's A4 sheet and the laid-out sizes are returned; without an explicit `caption` no figure number is drawn, because how a model's several views end up numbered is the caller's decision over the whole application's figure order. A directory `model_path` renders one figure per supported model (sorted, incrementing figure numbers) but is rejected with `invalid_tool_input` when `callouts` are supplied, since a callout's 3D anchor is model-specific; `scale` must be a finite positive number and `figure_number` a positive integer, both validated before any render.
- **Knowledge note / PDF download wiring** — `knowledge_note_save` writes files under Config.noteDir (a native knowledge.db write API is deferred), and `patent_pdf_download` resolves its batch runner per call over a late-bound `ctx.get('patentData')` lookup (`createDownloadChannelRunner`): a present service drives the unified ego stack (via `ctx.patentData.createEgoSession()`), and an absent service or an unusable browser falls through to a browser-free scrape of each page's CDN link, which the tool's own fetch fallback downloads with bounded retry/backoff (timeout, retry, and Retry-After-aware wait). The lookup is per call because `patent-data` declares `inject: ['subprocess']` and therefore activates after this package's apply; see [the service-resolution Agent Note](../../../.agents/notes/implemented/bug-fix/2026-09-21-patent-pdf-download-resolves-service-per-call.md). browseros-neo, playwright, and browser-use participate in probing but never in downloads.
- **Semantic recall removed** — `patent_case_search` keeps FTS/LIKE only; the embedding-based semantic recall path is not ported (dsh ships no vector infrastructure yet).
- **Evidence rule assets** — `evaluate_evidence` resolves `evidence-rules.yaml` through `@deepseek-ai/dsh-patent-rule`'s asset location; without it the engine falls back to default weights.

### Dev Note

None.

No companion is published because the patent tools write no package-owned durable session events beyond the normal tools/result log; workflow-run and plantask events are owned by dsh-patent-workflow.
