# Agent Note: Patent specification verdicts separate form from substance

Status: implemented

English | [中文](2026-10-29-patent-specification-verdicts-split-form-from-substance.zh.md)

## Problem

`validate_specification` already carried many deterministic rules, but its `passed` flag read as a compliance conclusion while only counting `error` violations. A draft containing nothing but `【撰写指引】` placeholders passed with score 0.9; a body citing `如权利要求1所述` or using `世界领先` passed; a missing figure number in the drawing description passed; a four-part invention without drawings failed with `缺少必要章节：附图说明`. The default disclosure and patentability workflows passed only `text`/`claims` into `spec-check`, so title, abstract, patent type, drawing state, and figure analysis never reached the gate. `legal-gaps` then read the form-only `specification_check_passed` as proof of enablement under A26.3.

## Decision

Violations carry a required `family` (`structure`, `title`, `abstract`, `description`, `prohibitions`, `figures`, `claims`). `validate_specification` returns `not_assessed` for what deterministic rules cannot decide, and its `passed` means only that the rules it ran found no error.

`spec-check` writes per-family verdicts: `spec_form_check_passed` (all form families), `spec_claims_check_passed`, `spec_figure_check_passed`, `spec_prohibitions_check_passed`, plus `spec_not_assessed`. It reads `title`, `abstract`, `patent_type`, `has_drawings`, `figure_analysis`, `drawing_count`, and `abstract_figure_number` from the workflow state; `patent_workflow_run` maps those inputs, together with `background`, into that state.

`legal-gaps` maps `spec-form` to the form verdict and `claim-support` to the claim verdict. `enablement` reads only `enablement_report`/`enablement_passed`, so a green form check stays `not-assessed` for A26.3. `claim-support-breadth` stays `not-assessed` and is excluded from revision targets because gathering facts cannot settle it.

Required sections follow the patent type and drawing state: an invention without drawings needs four parts, a utility model always needs `附图说明`, and a present-but-empty drawing section is an error. Titles of 26–40 characters are a warning; over 40 remains an error.

## Later coverage in the same release

P1 adds abstract checks that read `abstract_figure_number` instead of prose, figure-description coverage (sequence, duplicate, reference, name, count), delivery review in `verify_patent_figure` (`delivery_review`), caption/page-number validation at layout, and a drawing-free filing path. The filing path uses one spec with `optional: true` on the two figure sections: `build.py` removes their section boundaries, and `verify.py` derives the expected section count and headers from the optional sections actually omitted. A drawing-free invention therefore produces three sections; a utility model is still blocked by `spec-check`.

T19 writes a deterministic abstract from the drafting fields. T28 adds a sub-agent figure-analysis stage plus a deterministic `figure-analysis` atom that parses its JSON, because a sub-agent stage stores text under its stage id and cannot itself satisfy the array shape `validate_specification` reads.

P2 adds heuristic warnings only: background-citation elements, effect comparison, sequence listings, text media, term/mark consistency, utility-model drawing content, and the 40×60 mm abstract-drawing character height. None of them changes `passed` to a substantive conclusion; enablement, claim breadth, legibility, scale, and photo suitability stay `not_assessed`.

## Alternatives considered

**Treat every warning as blocking.** Legal form defects and deployment conventions both appear as warnings today; blocking all of them would make the gate easy to bypass with an exception list.

**Let the form check stand for A26.3.** Enablement asks whether a skilled person can carry out the invention, which no string rule establishes. Reporting it as passed would repeat the original false positive at the legal-provision level.

**Keep the fixed five-part requirement.** 《专利审查指南》第二部分第二章 2.3 permits an invention without drawings, so requiring `附图说明` rejects valid applications.

**Infer the abstract figure from the abstract text.** The designation lives in the request form; inferring it from prose produced false warnings. The checker now reads `abstract_figure_number` and lists the item as not assessed when absent.

## Testing

| Evidence | Behaviour |
|---|---|
| `spec-p0-rules.spec.ts` | Each new rule has hit, miss, and boundary cases; the advertising word list is compared against rule `CON-COMP-0105`. |
| `validate-specification.spec.ts`, `spec-check.spec.ts`, `legal-gaps.spec.ts` | Placeholder drafts fail, four-part inventions pass, utility models without drawings fail, and enablement stays unassessed without a report. |
| `patent-workflow-run.spec.ts` | Disclosure runs pass a complete invention without drawings and fail a utility model without drawings; `legal-gaps` reports the matching status. |
| `patent_oa_response` snapshot | The tool schema sidecar carries the new parameters; replay matches. |

## Consequences

A default workflow now blocks an unfinished or unlawful draft instead of delivering it. Consumers that read `specification_check_passed` as A26.3 evidence must move to `enablement_report`; the upgrade guide records that break. Figure-number suffixes such as `图1A`, drawing legibility, scale consistency, photo suitability, and title names remain `not-assessed`; the P2 heuristics report measured facts and warnings, not those conclusions.
