---
kind: upgrade-guide
description: "Patent workflows gain deterministic legal-baseline, evidence, and citation stages, so earlier runs can now report incomplete stages."
---

# Patent workflows gain legal-baseline, evidence, and citation stages

English | [中文](guide.zh.md)

## Change

Built-in workflows add stages:

- `patent_novelty_v1`: `time_baseline` after `parse`, `conflicting_application` after `search`, and `numeric_range` after `compare`, then `legal_gaps` after `conclude`. `patent_workflow_run` gained `filingDate`, `priorityDate`, and `conflictingApplications`. Without a date the baseline degrades.
- `patent_disclosure_v1`: `eligibility` after `preprocess`, `time_baseline` before `search`, `prior_art_filter` after `search`, `citation_check` after `novelty`, `spec_check` after `draft_claims`, then `legal_gaps` after `slop_clean`.
- `patent_patentability_v1`: `eligibility` after `parse`, `spec_check` after `draft`, then `legal_gaps`.
- `patent_inventiveness_v1`: `problem_check` after `diff`, then `legal_gaps` after `conclude`.
- `patent_oa_response_v1`: `response_check` after `draft`, `amendment_basis`, then `legal_gaps`.
- `patent_invalidation_v1` and `patent_reexamination_v1`: `evidence_check` after `inventiveness`, `citation_check`, then `legal_gaps`.
- `patent_infringement_v1`: `legal_gaps` after `report`.

`prior-art-filter` drops hits published on/after the cutoff and A24 grace-period disclosures within six months (`a24Exception`, `A24.1`–`A24.4`). Hits carry `publicationDate`; `conflicting-application` applies A22.2: a candidate filed before but published on or after the target date conflicts only when `sameInvention` is true; it destroys novelty only. `citation-check` reports ungrounded citations (`D1`, `D2`, patent numbers); `spec-check` unsupported claim features (A26.4). `numeric-range` flags overlapping ranges or shared endpoints; without comparable text, `inconclusive`. `problem-check` rejects a problem restating a distinguishing feature, containing a solution, or bundling causes. `response-check` runs PR-OA-007/008/009: 26.3 responses must state the skilled-person, enablement, and specification basis; every raised ground must appear; unraised statutes are flagged. No notice leaves dependent rules unevaluated. `amendment-basis` flags added claim spans absent from the original description or claims (A33); no amendment section means skipped. `legal-gaps` summarizes statutory coverage. `evidence-check` rejects late evidence without justification and reports form defects, post-cutoff dates, and unlinked evidence. `eligibility` screens A2/A5/A25: pure mental-activity rules, diagnostic/treatment methods, animal/plant varieties, and nuclear transformations; technical features defeat A25.

Run results now carry `evidenceLedger`; a run consuming sources appends a `patent/evidence-ledger` event with one receipt per consumed source, and `patent_workflow_run` also logs `patent/workflow-run` and `patent/legal-gaps`.

## Migration

1. Pass `filingDate` (`2024-06-01`, `2024/06/01`, or `2024年6月1日`) for novelty and disclosure runs and, when claimed, `priorityDate`; the earlier is the cutoff. Unparseable dates are rejected as `invalid_tool_input`.

2. For recap runs, add `time_baseline`, `prior_art_filter`, and `conflicting_application` outputs beside the existing stages. Recap executes no atoms; a missing output degrades the stage.

3. For prior-art entries, add `publicationDate` (`yyyy-MM-dd`) and, for an A24 first disclosure, `a24Exception`; undated entries remain unverified.

4. For novelty, pass candidates through `conflictingApplications`. Each entry needs `filingDate`, `publicationDate`, optional `priorityDate`, and the caller's `sameInvention`. Without it the entry is pending, not a conflict. Omitting it reports “no candidates supplied”, which does not rule out conflicts. Foreign filings do not qualify.

5. Checks do not interrupt the run.

6. Pass `evidence` and `evidenceDeadline` for invalidation/reexamination; a late entry lacking `lateJustification` blocks.

7. Supply `priorArt` (JSON array) for novelty numeric checks; otherwise `numeric_range` is `inconclusive`.

8. Every workflow ends with `legal_gaps`; `not-assessed` means no deterministic stage covers that provision.

9. Read `evidenceLedger` from results or the `patent/evidence-ledger` event; receipts are absent when nothing was consumed.
