# @deepseek-ai/dsh-patent-tools

English | [中文](README.zh.md)

Function plugin porting the Sati patent-domain tool set into the DeepSeek Harness. It registers 23 model-facing tools across search, metadata, knowledge queries, claim-chart, drafting, evidence judgment, rule checking, and the workflow/plan state machines. Each tool returns a losslessly JSON-serializable canonical value and exposes a pure `output.render` function that produces the model-facing prose (Sati has no render split; this is the new dsh contract).

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
| `claim_chart_build` | drafting | `@deepseek-ai/dsh-patent-core` claim-chart atom + ModelPort |
| `draft_claims` | drafting | deterministic |
| `draft_specification` | drafting | deterministic |
| `validate_specification` | quality | deterministic |
| `evaluate_evidence` | evidence | `@deepseek-ai/dsh-patent-core` evidence engine |
| `rule_check` | quality | `@deepseek-ai/dsh-patent-rule` rule engine |
| `analyze_patent_figure` | analysis | ModelPort (image-input gated on the figure model) |
| `search_patent_figure` | search | keyword retrieval over the figure index (not image-gated; current assembly fails loud — no index writer is wired) |
| `patent_pdf_download` | document | fail-loud stub in this assembly (ego-browser runner not wired) |
| `recognize_chemical_structure` | analysis | optional (rdkit not bundled) |
| `flexible_plan` | workflow | `@deepseek-ai/dsh-patent-workflow` flexible-plan |
| `patent_workflow` | workflow | `@deepseek-ai/dsh-patent-workflow` recap |
| `patent_workflow_run` | workflow | `@deepseek-ai/dsh-patent-workflow` + ModelPort |
| `patent_plan_task` | workflow | `@deepseek-ai/dsh-patent-workflow` plantask state machine |
| `patent_worker_validate` | quality | `@deepseek-ai/dsh-patent-workflow` worker contract |
| `knowledge_note_save` | knowledge | fail-loud stub in this assembly (storage writer not wired; knowledge.db has no write API) |

`render_patent_document` is owned by `@deepseek-ai/dsh-patent-document` (its `apply()` registers it); this package re-exports `createRenderPatentDocumentTool` and `renderDocumentResult` for library consumers but does not register it, so composing both plugins does not produce a duplicate-name error.

## Configuration

Schemastery configuration, every field optional.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `provider` | string | — | LLM provider route for the LLM-consuming tools (`claim_chart_build`, `patent_workflow_run`, `flexible_plan`, `analyze_patent_figure`). |
| `model` | string | — | LLM model id for the LLM-consuming tools. |
| `imageModel` | object | — | Dedicated figure/image model route (`{ provider, model }`) whose declared input modalities gate `analyze_patent_figure`; falls back to `provider`/`model` when unset. |
| `maxTokens` | number | — | Optional output token cap for the LLM-consuming tools; omitted leaves the provider default. |

When `provider`/ `model` are unset the LLM-consuming tools register but fail loud (`setup_required`) when called. The knowledge tools require a knowledge.db prepared via `patent-knowledge:install`; they fail loud with install guidance when it is absent.

## Model Experience

### Tool schemas

#### What the model sees

23 registered tool definitions (see the table above), each with a description, parameter schema, and an `output.render` that renders the canonical result as Markdown prose. Exact descriptions and parameters are in the generated [`patent-tools` schema](../../../docs/tool-catalog.md#deepseek-aidsh-patent-tools).

#### Token effect

Fixed definition cost per registered tool on every request; result text is data-dependent and resent only until compaction. No system-prompt section is registered, so there is no additional fixed prompt cost.

#### KV Cache effect

Prefix-stable while the registered tool set and their descriptions are unchanged; changing configuration or the registered set shifts the tool definitions and invalidates reuse from that point.

## Known Limitations and Deferred Work

- **`render_patent_document` ownership** — the tool is registered by `@deepseek-ai/dsh-patent-document`, not here; this package only re-exports its factory.
- **`flexible_plan` name** — Sati's `patentFlexiblePlanTool.ts` declares the name `flexible_plan` (not `patent_flexible_plan`); the dsh tool trusts the Sati name field.
- **Image-modal gate scope** — `analyze_patent_figure` is gated on the resolved figure-model route's declared image input (denied with error code `model_cannot_accept_image` when absent); `search_patent_figure` reads the injected index and is intentionally not gated (matches Sati, which gates analyze only). In this assembly no index writer is wired, so `search_patent_figure` fails loud (`setup_required`) until an integrator injects one.
- **Chemistry engine not ported** — `recognize_chemical_structure` and the chemical-characterization check in `validate_specification` degrade to unavailable because `@rdkit/rdkit` is an optional native dependency not bundled.
- **Figure/chemistry engines not ported** — the Sati `src/patent/figure` and `src/patent/chemistry` engines are not in any dsh package; the figure tools implement a minimal ModelPort path and keyword retrieval, with multi-figure consistency, netlist visualization, and SMILES parsing deferred.
- **Knowledge note / PDF download wiring** — `knowledge_note_save` and `patent_pdf_download` are fail-loud stubs in this assembly (storage writer and ego-browser runner not wired); a native knowledge.db write API is deferred.
- **Semantic recall removed** — `patent_case_search` keeps FTS/LIKE only; the embedding-based semantic recall path is not ported (dsh ships no vector infrastructure yet).
- **Evidence rule assets** — `evaluate_evidence` resolves `evidence-rules.yaml` through `@deepseek-ai/dsh-patent-rule`'s asset location; without it the engine falls back to default weights.
