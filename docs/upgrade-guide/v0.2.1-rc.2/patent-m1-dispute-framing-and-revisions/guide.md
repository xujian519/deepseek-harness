---
kind: upgrade-guide
description: "Patent manifests now locate disputes before parsing and record every retry rewind; law_search hits carry a point-in-time validity state."
---

# Patent dispute framing, revision records, and law validity

English | [中文](guide.zh.md)

## Change

The six required analysis manifests (`patent_novelty_v1`, `patent_inventiveness_v1`, `patent_oa_response_v1`, `patent_invalidation_v1`, `patent_reexamination_v1`, `patent_infringement_v1`) and the optional `patent_patentability_v1` now start with a deterministic `dispute-framing` stage and run `dispute-framing-refine` after `time_baseline` (or `grounds`/`parse` where no time baseline exists). `patent_disclosure_v1` keeps its 22-stage shape. Both atoms are registered by `registerBuiltinAtoms()`; they do not call a model, so model-stage budgets are unchanged.

`WorkflowRunResult` gains optional `revisions` and `revisionsTruncated`. A text or structured retry signal now appends a `RevisionRecord` (gap id, rewind target, before/after output digests, rationale, outcome) instead of leaving the rewind implicit. A stage can request a structured rewind by returning `_revision_signals: RetrySignal[]`; declare `retry.whenRevisionRequested: true` on the stage to consume it. `legal-gaps` emits one signal per `not-assessed` item and leaves the target list in `state.revision_targets` for the rewound extract stage.

`law_search` hits now include `validity` (`in-force`, `expired`, `not-yet-effective`, or `unverified`). `KnowledgeLawSearch` filters expired and not-yet-effective rows; rows without `valid_from`/`valid_to`/`expired` columns are `unverified` and still returned by default (`includeUnverified: false` excludes them). `installKnowledgeDb` adds those nullable columns to its output database and writes no in-force default.

## Migration

1. Add `dispute-framing` and `dispute-framing-refine` to any per-stage output list passed to `patent_workflow`. Missing stages are still reported as degraded, so a recap that used to complete now reports `completed: false`.
2. If you asserted exact stage counts or `consumes` arrays for a built-in manifest, update them. The new counts are novelty 14, inventiveness 16, patentability 14, OA response 10, invalidation 11, reexamination 11, infringement 8, disclosure 22.
3. Read `revisions` when you need an audit trail; do not parse stage output text to infer that a rewind happened. `before`/`after` are 16-character digests, and the log stops at 64 records with `revisionsTruncated: true`.
4. `law_search` consumers that switch on the hit shape must accept `validity`. A caller relying on stale statutes must now pass an explicit `asOf` to the underlying search or handle the filtered result.
5. Confirm: run `patent_workflow` with the old eight OA stage outputs and observe the two new steps as degraded; run with all ten and observe `completed: true`.
