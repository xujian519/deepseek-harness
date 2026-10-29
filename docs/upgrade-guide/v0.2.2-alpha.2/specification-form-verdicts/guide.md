---
kind: upgrade-guide
description: "validate_specification returns per-family verdicts and not_assessed, its title-length rule and default workflow gates now block unfinished or unlawful specifications."
---

# Specification checks return per-family verdicts

English | [中文](guide.zh.md)

## Change

`validate_specification` now adds a required `family` to every violation and a `not_assessed` list to its result. Its `passed` field keeps its name but means only that the deterministic rules it ran found no error; the report no longer reads as a statement that the specification complies with the Patent Law.

The default `patent_disclosure_v1` and `patent_patentability_v1` workflows now block on: template placeholders (`【撰写指引】`, `待补充`, `TODO`, `TBD`), empty sections, a claim citation (`如权利要求1所述`), commercial advertising, internal-process markers, a utility model without drawings, missing or duplicate figure numbers, body references to a figure absent from the drawing description, and unnamed drawing entries. An invention without drawings is accepted with four parts.

`spec-check` now reads `title`, `abstract`, `patent_type`, `has_drawings`, `figure_analysis`, `drawing_count`, and `abstract_figure_number` from the workflow state and writes `spec_form_check_passed`, `spec_claims_check_passed`, `spec_figure_check_passed`, `spec_prohibitions_check_passed`, and `spec_not_assessed`. `legal-gaps` maps `spec-form` and `claim-support` to those verdicts and no longer treats a passing form check as proof of enablement under A26.3: `enablement` stays `not-assessed` until an `enablement_report` exists.

Invention titles of 26–40 characters are now a warning instead of an error; over 40 characters remains an error.

The same release also:

- makes `draft_specification` return a deterministic `abstract`, and both drafting workflows run `figure_analysis` (sub-agent) plus `figure_analysis_parse` before drafting; empty `figure_files` or `[SKIP]` yields `figure_analysis_skipped`.
- adds heuristic warnings to `validate_specification`: background-citation elements, effect comparison, sequence listings, text media, term/mark consistency, and utility-model drawing content.
- adds `delivery_review` to `verify_patent_figure`, `abstract_figure` to `generate_patent_figure`, and a drawing-free filing path (`figureFiles: []`, three-section output) to `build_patent_filing`/`verify_patent_filing`.

Anyone reading `validate_specification` results, `spec-check` state, or `legal-gaps` reports, anyone whose workflow previously passed an unfinished draft, and anyone building a drawing-free filing, is affected.

## Migration

1. Replace reads of `specification_check_passed` for A26.3 with `enablement_report`/`enablement_passed`; keep `specification_check_passed` only as the overall form-and-claim verdict.
2. Read `spec_form_check_passed` and `spec_claims_check_passed` in `legal-gaps` consumers; a `failed` item is now blocking for `spec-form`.
3. Surface `not_assessed` (or `spec_not_assessed`) in any report that previously claimed full compliance.
4. Pass `patent_type`, `title`, `abstract`, `has_drawings`, `figure_analysis`, `figureFiles`, `drawing_count`, and `abstract_figure_number` to `patent_workflow_run` (or to `validate_specification` directly) where the application supplies them; omitted items become `not_assessed`.
5. For a drawing-free invention, pass `figureFiles: []` and an empty `drawingDescriptions` part, and omit `abstractFigure`; do not keep the old five-part draft with an empty drawing section.
6. Read `figure_analysis_skipped` when the figure-analysis stage could not run (no drawings, no vision, or no result) before treating figure-mark consistency as checked.
7. Run `pnpm exec vitest run packages/patent/patent-tools/tests packages/patent/patent-filing/tests` and confirm a placeholder draft fails, a four-part invention without drawings passes, and a drawing-free filing builds as three sections.
