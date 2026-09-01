---
description: "Function plugin porting the Sati patent-domain tool set into the DeepSeek Harness. It registers 24 model-facing tools across search, metadata, knowledge queries, claim-chart, drafting, analysis reports, evidence judgment, rule checking, and the workflow/plan state machines. Each tool returns a losslessly JSON-serializable canonical value and exposes a pure `output.render` function that produces the model-facing prose (Sati has no render split; this is the new dsh contract)."
kind: "package-reference"
---

# @deepseek-ai/dsh-patent-tools

English | [中文](README.zh.md)

## Summary

Function plugin porting the Sati patent-domain tool set into the DeepSeek Harness. It registers 24 model-facing tools across search, metadata, knowledge queries, claim-chart, drafting, analysis reports, evidence judgment, rule checking, and the workflow/plan state machines. Each tool returns a losslessly JSON-serializable canonical value and exposes a pure `output.render` function that produces the model-facing prose (Sati has no render split; this is the new dsh contract).

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
| `claim_chart_build` | drafting | `@deepseek-ai/dsh-patent-core` claim-chart atom + ModelPort |
| `draft_claims` | drafting | deterministic |
| `draft_specification` | drafting | deterministic |
| `validate_specification` | quality | deterministic |
| `evaluate_evidence` | evidence | `@deepseek-ai/dsh-patent-core` evidence engine |
| `rule_check` | quality | `@deepseek-ai/dsh-patent-rule` rule engine |
| `analyze_patent_figure` | analysis | Vision ModelPort through a `FigureAnalysisEngine` (Config.figureAnalysisMode: `single` = one call, default; `two-step` = structure extraction, then description generation); image-input gated on the figure model |
| `search_patent_figure` | search | keyword retrieval over the figure index written by `analyze_patent_figure` (Config.figureIndexFile) |
| `generate_patent_figure` | drafting | Figure DOT builder + Graphviz rendering: bundled `@viz-js/viz` WASM for SVG (default), `dot` CLI for png/pdf and `figureRenderer: 'cli'` (Config.graphvizExecutable / figureOutputDir / dotFont); submission page/dpi/margin/orientation; leader-line numerals default on for block-diagram/component-hierarchy SVG; multi-panel `panels` output and cross-figure numeral continuation via `figure_family`; persists to the figure index (Config.figureIndexFile) |
| `add_patent_figure_references` | drafting | SVG annotation post-processing: inline mode matches `<text>`/`<tspan>` content and appends `(numeral)`; `leader_lines: true` draws leader lines with standalone numerals |
| `patent_pdf_download` | document | browser-backend cold decision: ego-browser download intercept (unified ego stack) |
| `recognize_chemical_structure` | analysis | optional (rdkit not bundled); index upsert wired (Config.chemistryIndexFile) |
| `flexible_plan` | workflow | `@deepseek-ai/dsh-patent-workflow` flexible-plan |
| `patent_workflow` | workflow | `@deepseek-ai/dsh-patent-workflow` recap |
| `patent_workflow_run` | workflow | `@deepseek-ai/dsh-patent-workflow` + ModelPort |
| `patent_plan_task` | workflow | `@deepseek-ai/dsh-patent-workflow` plantask state machine |
| `patent_worker_validate` | quality | `@deepseek-ai/dsh-patent-workflow` worker contract |
| `knowledge_note_save` | knowledge | file writer under Config.noteDir (default `<cwd>/99-知识库`) |

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
| `figureOutputDir` | string | `<cwd>/patent/figures` | Output directory for `generate_patent_figure` (absolute or relative to cwd). |
| `dotFont` | string | platform-dependent | DOT font name override; default Helvetica, platform CJK candidates (PingFang SC / Microsoft YaHei / Noto Sans CJK SC) when labels contain CJK. |
| `figureRenderer` | `'wasm' \| 'cli'` | `wasm` | Graphviz renderer for `generate_patent_figure`: `wasm` is the bundled `@viz-js/viz` engine (SVG, no system dependency); `cli` runs the `dot` subprocess. png/pdf always route to the CLI. |
| `figureAnalysisMode` | `'single' \| 'two-step'` | `single` | `analyze_patent_figure` mode: `single` is one vision call; `two-step` runs structure extraction, then description generation, over the same route (doubles model cost). |
| `figurePageSize` | `'a4' \| 'letter'` | — | Submission page size; emits DOT `page`/`size` attributes when set (per-call `page_size` overrides). |
| `figureOrientation` | `'portrait' \| 'landscape'` | portrait | Submission page orientation (per-call `orient` overrides). |
| `figureDpi` | number | — | Submission render DPI (raster output; per-call `dpi` overrides). |
| `figureMargin` | number (cm) | — | Page margin on all four sides; with `figurePageSize` it shrinks the drawing `size` (per-call `margin` overrides). |

When `provider`/ `model` are unset the LLM-consuming tools register but fail loud (`setup_required`) when called. The knowledge tools require a knowledge.db prepared via `patent-knowledge:install`; they fail loud with install guidance when it is absent.

## Model Experience

### Tool schemas

#### What the model sees

25 registered tool definitions (see the table above), each with a description, parameter schema, and an `output.render` that renders the canonical result as Markdown prose. Exact descriptions and parameters are in the generated [`patent-tools` schema](../../../docs/tool-catalog.md#deepseek-aidsh-patent-tools).

#### Token effect

Fixed definition cost per registered tool on every request; result text is data-dependent and resent only until compaction. No system-prompt section is registered, so there is no additional fixed prompt cost.

#### KV Cache effect

Prefix-stable while the registered tool set and their descriptions are unchanged; changing configuration or the registered set shifts the tool definitions and invalidates reuse from that point.

## Known Limitations and Deferred Work

- **`render_patent_document` ownership** — the tool is registered by `@deepseek-ai/dsh-patent-document`, not here; this package only re-exports its factory.
- **`flexible_plan` name** — Sati's `patentFlexiblePlanTool.ts` declares the name `flexible_plan` (not `patent_flexible_plan`); the dsh tool trusts the Sati name field.
- **Image-modal gate scope** — `analyze_patent_figure` sends the drawing to the resolved figure-model route and is gated on that route's declared image input (denied with error code `model_cannot_accept_image` when absent); the bytes are admitted through the harness attachment store and travel as a durable ref, and an absent store or route fails loud with `setup_required`. `search_patent_figure` reads the index and is intentionally not gated (matches Sati, which gates analyze only). The index is written by `analyze_patent_figure` into Config.figureIndexFile; an absent or empty index returns zero hits with a guidance hint, not an error.
- **Chemistry engine not ported** — `recognize_chemical_structure` and the chemical-characterization check in `validate_specification` degrade to unavailable because `@rdkit/rdkit` is an optional native dependency not bundled.
- **Figure/chemistry engines not ported** — the Sati `src/patent/figure` and `src/patent/chemistry` engines are not in any dsh package; the figure tools implement a minimal ModelPort path and keyword retrieval, and the figure/chemistry index stores (`figure/index-store`, `chemistry/index-store`) are wired for write+read. Netlist visualization and SMILES parsing (RDKit) remain deferred.
- **Figure generation scope** — `generate_patent_figure` renders SVG through the bundled `@viz-js/viz` WASM engine (Config.figureRenderer); png/pdf and `figureRenderer: 'cli'` go through the `dot` subprocess, which stays a system dependency — those paths fail loud with install guidance when it is missing. Leader-line numerals are on by default for block-diagram/component-hierarchy SVG (off for flowchart and `raw_dot`/`template`; per-call `leader_lines` overrides): numerals sit outside the component with a `<line>` connector instead of the embedded label suffix; non-SVG formats keep embedded numerals and return a warning. `panels` renders multi-figure sets (`fig1A`/`fig1B`, …) with one shared numeral series; a per-call `figure_family` continues numerals across generations for components recorded under the same family in the figure index — no family declared means independent per-figure numbering, and index entries without `figureFamily` never participate. `semantic` color fills are allowed only when color carries technical content per CNIPA Guidelines Part I Chapter 1 §4.3 (2023 rev., `grayscale` is the default); `raw_dot`/`template` outputs carry no structured components or connections (search-index entries remain partial).
- **Two-step analysis degradation** — with `figureAnalysisMode: 'two-step'`, an unparseable structure-extraction pass returns a best-effort result with empty components plus a warning and skips the description pass; the image gate and result shape are identical to `single`.
- **Knowledge note / PDF download wiring** — `knowledge_note_save` writes files under Config.noteDir (a native knowledge.db write API is deferred), and `patent_pdf_download` resolves its batch runner through a browser-backend cold decision (`@deepseek-ai/dsh-browser-backend`): the unified ego stack routes the download to ego-browser only (via `ctx.patentData.createEgoSession()` when the patent-data service is mounted); browseros-neo, playwright, and browser-use participate in probing but never in downloads. Without patent-data the ego channel fails loud with setup guidance. The ego-browser download intercept is best-effort — anything the browser cannot save falls back to a fetch of the extracted CDN URL with bounded retry/backoff (timeout, retry, and Retry-After-aware wait).
- **Semantic recall removed** — `patent_case_search` keeps FTS/LIKE only; the embedding-based semantic recall path is not ported (dsh ships no vector infrastructure yet).
- **Evidence rule assets** — `evaluate_evidence` resolves `evidence-rules.yaml` through `@deepseek-ai/dsh-patent-rule`'s asset location; without it the engine falls back to default weights.

### Dev Note

None.
