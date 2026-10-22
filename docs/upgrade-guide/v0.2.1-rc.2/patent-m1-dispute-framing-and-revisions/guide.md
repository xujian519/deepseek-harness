---
kind: upgrade-guide
description: "Patent manifests now locate disputes before parsing and record every retry rewind; law_search hits carry a point-in-time validity state."
---

# Patent dispute framing, revision records, and law validity

English | [中文](guide.zh.md)

## Change

The six required analysis manifests (`patent_novelty_v1`, `patent_inventiveness_v1`, `patent_oa_response_v1`, `patent_invalidation_v1`, `patent_reexamination_v1`, `patent_infringement_v1`) and the optional `patent_patentability_v1` now start with a deterministic `dispute-framing` stage and run `dispute-framing-refine` after `time_baseline` (or `grounds`/`parse` where no time baseline exists). `patent_disclosure_v1` keeps its 22-stage shape. Both atoms are deterministic, so model-stage budgets are unchanged.

`WorkflowRunResult` gains optional `revisions` and `revisionsTruncated`. A text or structured retry signal now appends a `RevisionRecord` (gap id, rewind target, before/after output digests, rationale, outcome) instead of leaving the rewind implicit. A stage can request a structured rewind by returning `_revision_signals: RetrySignal[]`; declare `retry.whenRevisionRequested: true` on the stage to consume it, and the trigger works even when the stage produced no text. `legal-gaps` emits one signal per `not-assessed` item and leaves the target list in `state.revision_targets` for the rewound extract stage; `revision_coverage` is optional audit data, so a missing or malformed coverage object does not discard a successful extraction.

`before` and `after` both describe the rewind target's output. `at` is written only when the caller injects `now` into `runWorkflow` or `rollbackStage`; without a clock, persisted runs stay deterministic. A retry may not rewind across an approval gate: manifest validation rejects it, so revised output cannot reuse an earlier approval. `patent_disclosure_v1` therefore runs `review_gate` after `legal_gaps`.

`law_search` hits now include `validity` (`in-force`, `expired`, `not-yet-effective`, or `unverified`), and the tool accepts `asOf` (YYYY-MM-DD) to judge validity at a historical point. `KnowledgeLawSearch` filters expired and not-yet-effective rows before applying `limit`; rows without `valid_from`/`valid_to`/`expired` columns are `unverified` and still returned by default (`includeUnverified: false` excludes them). Malformed or calendar-invalid dates are `unverified` rather than in force. `installKnowledgeDb` adds nullable `valid_from`, `valid_to`, and `validity_source` columns and writes no in-force default; existing rows stay `unverified` until backfilled.

## Migration

1. Add `dispute-framing` and `dispute-framing-refine` to any per-stage output list passed to `patent_workflow`. Missing stages are still reported as degraded, so a recap that used to complete now reports `completed: false`.
2. Update asserted stage counts or `consumes` arrays. The new counts are novelty 14, inventiveness 16, patentability 14, OA response 10, invalidation 11, reexamination 11, infringement 8, disclosure 22.
3. Read `revisions` for the audit trail. `before`/`after` are 16-character digests; the log stops at 64 records with `revisionsTruncated: true`.
4. `law_search` consumers that switch on the hit shape must accept `validity` and `asOf`. A caller relying on stale statutes passes `asOf`; `law_search` now rejects a malformed date with `invalid_tool_input`.
5. Backfill `valid_from`/`valid_to`/`expired` before strict filtering; `installKnowledgeDb` cannot infer dates.
6. Move approval gates outside a retry's rewind range. A manifest whose retry crosses a gate now fails validation at load; disclosure `review_gate` is last for this reason.
7. Confirm both shapes: old eight OA outputs show the new steps as degraded; ten outputs report `completed: true`.
