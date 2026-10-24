# Agent Note: Argument-quality scoring and a coherent second OA turn in patent-oas

Status: implemented

English | [中文](2026-10-24-patent-oas-argument-quality-scoring.zh.md)

## Problem

Two defects in `patent-oas` made the regression gate track noise instead of deliverable quality. The `novelty-creative` rubric gave full marks on dimensions 4 and 5 only when the deliverable concluded the application was inventive. Runs that argued the D1 + D2 combination was obvious scored 20/30 and 60/100, so `technical-teaching` swung from 74.2 to 69.9 and needed a special floor of 60. Separately, the `oa-answer` round-2 opinion asserted that the applicant had amended claim 1, while the round-1 task allowed a reasoned non-amendment. All three round-1 deliverables chose not to amend, and the round-2 evaluators scored `amendment-grounding` at 35, 50, and 60 (mean 48.3) against a floor of 50, so the gate refused the re-recorded baseline.

## Decision

`novelty-creative` dimensions 4 and 5 score the argument rather than the conclusion. Dimension 4 asks whether D2's technical field and role are correctly identified and whether the combination motivation is argued completely in either direction. Dimension 5 asks for explicit novelty and inventiveness conclusions, consistency with the argument, and correct citations to Article 22.2 and 22.3. The problem-space observables already stated these direction-neutral criteria; the rubric carried the drift.

The `oa-answer` round-2 opinion is conditional: it raises Article 33 only if the first response amended the claims, and `amendment-grounding` accepts a reasoned non-amendment that stays consistent with the first response and the current opinion. The gold digest and baseline were re-recorded on 2026-10-24: aggregate 95.70, `novelty-creative` 98.1, `oa-answer` 92.0, `technical-teaching` 92.2, `amendment-grounding` 83.3.

## Alternatives considered

**Keep conclusion-direction scoring and exclude `novelty-creative`.** Rejected: the task admits two defensible conclusions, and dropping the case hides the distinction between argument quality and the chosen side.

**Require the first round to amend.** Rejected: the first office action raises only Article 22.3, so a reasoned non-amendment is a legitimate response. Having the second opinion invent an amendment made the evaluation incoherent.

**Lower the `amendment-grounding` floor to accept the old measurement.** Rejected: the floor would then read a case defect as model quality and let a real regression through.

## Consequences

- `technical-teaching` and `amendment-grounding` use the unified node floor of 70; their special floors of 60 and 50 are gone.
- The gate rejects a baseline whose round-2 statement digest differs from the current scripted opinion, so the case edit and re-baseline land together.
- The checked-in baseline comes from two captures under the same profile: the three single-round cases from one capture and `oa-answer` re-captured after the statement edit. Its token totals cover all 96 accepted calls.
- `novelty-creative` no longer treats either defensible conclusion as a failure; a future change that reintroduces direction scoring must re-record the gold digest and the baseline.
