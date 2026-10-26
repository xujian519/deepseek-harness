# Agent Note: Promoting the claim-chart schema to a governed contract

Status: rejected — the schema already sits on a public API surface with an upgrade-guide path, cross-domain reuse was declined by the legal-generalization study, and a session event would duplicate what the tool result already records

English | [中文](2026-10-26-claim-chart-schema-promotion.zh.md)

## Problem

`claim_chart_build` builds an element-level claim chart from `packages/patent/patent-core/src/claim-chart/`. Three layers define its data: the TypeScript protocol in `protocol/types.ts` (`ClaimChart`, `ChartRow`, `GapEntry`, …), the model-output subset in `CHART_SCHEMA` (`atoms/handlers/builtin/chart.ts`), and the runtime invariants in `runtime/` (element validator, mapping machine, claim refs, pin-cite validator). A run writes `data/cases/<caseId>/outputs/claim-chart-<chartId>.json` plus a Markdown deliverable; no session event carries the chart.

M3-T3 was moved out of the M3 milestone (#555) into #585 to decide after M4 whether this schema should be promoted — to a governed schema, to cross-package reuse, or to persistence. The transferred task defines no scope or acceptance criteria, so the evaluation has to fix the target before judging it.

## Proposal

Promote the claim-chart schema into a shared, versioned contract:

1. Cross-domain reuse: legal and other domains map their evidence against the same element → evidence grid.
2. Governed schema: generate a JSON Schema from the protocol, version it, and migrate stored chart files against that version.
3. Durable persistence: append a `patent/claim-chart` session event and write the chart through `ctx.storage` instead of the workspace file.

## Alternatives considered

### Why not cross-domain reuse?

The legal-generalization study ([R1, #576](../../proposed/architecture/2026-10-24-seven-step-legal-generalization.md)) found that legal triadic binding is element → fact → evidence, while the claim chart encodes claim feature → evidence → statute; its mapping matrix marks all five legal task families as requiring a rewritten schema, and #551 records the conclusion as "do not port the claim-chart schema". Sharing the grid would import patent premises into legal analysis.

### Why not a versioned governed schema?

The protocol is already a public API surface: `packages/patent/patent-core/src/index.ts` re-exports the whole `claim-chart` module, and externally perceptible changes already go through an upgrade guide (`docs/upgrade-guide/v0.2.1-rc.2/patent-chart-source-confinement/`). The model-visible input and output are governed by `defineTool` and the tool catalog; the enums in `CHART_SCHEMA` derive from `MAPPINGS` and `ELEMENT_KINDS`; the stored JSON deliberately carries fields the model never produces (`claims`, `gaps`, `invalidityConclusion`). The repository declined a runtime schema registry repo-wide ([typed-event-schemas](2026-06-16-typed-event-schemas.md)), and the two same-version compatibility paths in `loadClaimChart` (missing `claims`, `gaps[].mapping` → `kind`) are deliberate reader behavior, not drift. Versioning would move those obligations into a format version without removing them.

### Why not durable persistence?

`claim_chart_build` returns the complete `chart` value, so every model-visible fact is already reconstructable from the tool result in the session log. The JSON file matches the worker convention (`data/cases/<caseId>/outputs/`) and carries HITL `verified` state across reruns. A `patent/claim-chart` event would need a persistence review, both SDK projections, a keyless snapshot, and an upgrade guide, and would add no capability the file and tool result do not already provide.

### Why keep the current layering? (chosen)

The three layers have different obligations: the TypeScript protocol is the public contract, `CHART_SCHEMA` constrains only what the model may emit, and the runtime validators enforce the semantic invariants (verbatim substrings, pin-cite format, coverage rules). Collapsing them into one generated schema would either expose derived fields to the model or drop runtime checks.

Reopen this decision when one of these holds: an external consumer needs a stable JSON Schema promise; another domain needs a shared evidence grid, which would first overturn R1; or a cross-session audit or replay requirement appears that the workspace file cannot serve.
