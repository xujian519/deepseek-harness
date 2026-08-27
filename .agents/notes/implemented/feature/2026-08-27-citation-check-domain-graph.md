# Agent Note: Citation-check domain graph

Status: implemented

English | [中文](2026-08-27-citation-check-domain-graph.zh.md)

## Problem

A common patent-practice defect is the fabricated or strained citation: the
drafted conclusion cites a comparison document (D1/D2 or a patent number) that
is not actually present in the retrieved prior art, or does not disclose the
feature it is cited for. The `novelty`/`inventiveness`/`enablement` domain
graphs produce conclusion text that freely names comparison documents, but
nothing in `patent-core/src/graph/domains/` verifies those citations against
the evidence the run actually used. The existing `patent-fact-check` skill is
textual and model-driven; the missing piece is a deterministic, graph-scheduled
check that grounds every citation in `prior_art`.

## Decision

`patent-core` now ships a fourth domain subgraph, `citation-check`
(`src/graph/domains/citation-check.ts`), registered in `DOMAIN_GRAPHS` as
`'citation-check': { build: buildCitationCheckGraph, entry: 'check' }` and
re-exported through both graph barrels. The subgraph is pure computation — a
single deterministic `check` node with no LLM and no approval gate — ported
from Sati's citation-check domain.

The extraction rules (aligned with the Sati port) are: patent numbers
(`PATENT_NUMBER_RE` = `/[A-Z]{2}\d{1,14}[A-Z]?\d*/g`) take priority and are
extracted from conclusion text and document fields; free-text conclusions
extract only patent numbers, never hard-matching titles or paragraphs; when no
patent number is present, the extractor falls back to normalized document
labels (`对比文件N` / `证据N` / `D<N>`); and an empty `prior_art` (or an
un-extractable one) skips the hard check so a degraded search is not double
penalized. `extractCitationIds` / `extractDocIds` / `checkCitations` are
exported pure functions, mirroring how `extractNumericRanges` and the result
extractors are public.

Grounding is containment-based: a citation id is grounded when a document id
equals it, contains it, or is contained by it — the containment arms absorb the
URL path suffixes (`US11452699B2` inside a URL) and the application/patent
number split (`CN201910000000A` vs `CN201910000000`). The node reads the
conclusion ref-text from a configurable `refTextKeys` list (default
`inventiveness_conclusion` / `inventiveness_closest` / `inventiveness_hint` /
`novelty_report` / `text`) and the evidence from the `prior_art` state key,
writing `citation_check_grounded` / `citation_check_failures` /
`citation_check_report`. `extractCitationCheckResult` reads those back with the
present-key-only spread convention.

`patent_workflow_run` exposes the subgraph: the `graph` parameter enum gains
`citation-check`, and a new `priorArt` input accepts existing prior-art
evidence entries as a JSON array. `parsePriorArt` rejects non-JSON and non-array
input with `PatentToolError('invalid_tool_input', ...)` at the tool-input
boundary (fail loud, never silently degrade); `buildRunContext` maps it into
the `prior_art` workflow-context key through `buildWorkflowRunContext`.

The pure functions and extractor are public and JSDoc-typed; `PATENT_NUMBER_RE`
is exported so tests and future tools reuse the same extraction without drift.

## Alternatives considered

- **Model-verify citations instead.** Have an LLM node read the conclusion and
  judge whether each citation matches the retrieved docs. That reintroduces the
  hallucination risk the check exists to remove, adds latency, and cannot be
  pinned by a snapshot — the deterministic extract-and-ground computation is
  the point.
- **Gate inside the existing novelty/inventiveness graphs.** A shared
  deterministic tail node would couple citation grounding to those graphs'
  ref-text keys and approval flow. A standalone subgraph keeps the check
  reusable (`graph=citation-check` on its own) and lets each workflow choose
  its own ref-text sources.
- **Exact-match grounding only.** Requiring the document id to equal the
  citation id would mis-flag legitimate hits whose id embeds the number in a
  URL or carries a type suffix. The containment arms (`d.includes(refId)` /
  `refId.includes(d)`) match the Sati behavior and absorb those false
  negatives.
- **Add runtime string filters to `checkCitations`.** Sati type-checked each
  ref text at runtime; dsh's typed same-process contract makes `string[]` a
  static guarantee, so the `typeof t === 'string'` filter would be dead code.
  The port keeps only the `trim().length > 0` filter.

## Consequences

- `patent_workflow_run(graph=citation-check, priorArt=[...])` now gives a
  deterministic, model-visible verdict on whether every citation in the
  conclusion appears in the supplied prior-art evidence, instead of requiring a
  manual audit or trusting the model's self-report.
- Un-checkable inputs (no citations extracted, no extractable document ids,
  empty `prior_art`) pass through with an explicit report line, so a degraded
  or empty search is never double penalized as fabricated.
- The subgraph is LLM-free, so it runs without a model seam — but
  `patent_workflow_run`'s graph path still requires a model port for the other
  graphs, so `graph=citation-check` keeps that precondition.
- The extraction regexes carry a documented false-positive surface (the `ZL`
  prefix on Chinese utility models, `IP2022`-style tokens); because citation and
  document sides share the same extractor, grounding stays self-consistent and
  the residual risk is a flagged-but-actually-grounded citation, never a silent
  miss.

## Testing

`patent-core` tests cover both extraction branches (patent number first with
dedupe; doc-label fallback normalization), `extractDocIds` object/null/
non-object and non-string-field branches, all three grounding arms, all five
`checkCitations` outcomes, the graph node with `prior_art` state, custom
`refTextKeys`, `extractCitationCheckResult` present/absent keys, and the
`DOMAIN_GRAPHS` registration. `patent-tools` tests cover the `priorArt` JSON
parse (valid array, non-JSON, non-array → `invalid_tool_input`), the
`prior_art` workflow-context mapping, and a full `graph=citation-check` run
asserting the grounding fields in the returned graph state. Both packages stay
at 100% per-file statement/branch coverage.
