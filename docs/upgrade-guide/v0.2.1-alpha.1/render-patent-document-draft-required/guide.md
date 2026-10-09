---
kind: upgrade-guide
description: "render_patent_document removes its sections innerHTML parameter and requires a controlled draft for every template."
---

# render_patent_document requires a controlled draft

English | [中文](guide.zh.md)

## Change

`render_patent_document` no longer accepts the `sections` parameter (a record of element id to innerHTML), and `draft` is now required. A call that passes `sections` without `draft` fails at the tool argument gate with `missing required property "draft"` instead of rendering.

The draft carries a typed structure per template family: claims-spec takes the SpecDraft structure (bibliographic `meta` with the case number `caseNumber`, unnumbered `claims`, multi-paragraph `abstract`, `figureFiles` in figure order, the abstract figure number `abstractFigure` (an integer in `1..figureFiles`, default the first figure; both channels label the abstract figure from it), and the five specification parts as paragraph/list/table blocks, where the drawing-description part lists exactly one item per figure and that count must equal the `figureFiles` count); the other ten templates take id-keyed drafts (`fields` for leaf text slots, `sections` as blocks or rows). The converters generate headings, claim item numbers, figure numbers, table captions, and checkbox states, and escape all text, so a rendered document no longer carries model-authored HTML. A slot replaces only its own element's content: skeleton wrappers and section headings stay in the template, and an omitted optional slot contributes no text to the document. Document numbers are draft-supplied rather than template-invented: the claims-spec masthead line and footer print `meta.caseNumber`, and every document template fills its masthead number line (`doc-number`) and footer number (`footer-case`) from the draft, leaving no fabricated placeholder such as `CS-2026-XXXX` in a render. In claims-spec renders the specification carries exactly the five generated `h3` part headings, and the `h4` 实施例 example heading is gone.

Body slots now sit on a content container below the section heading, so filling a body never drops its heading: patentability-opinion's eight section slots become `basis-body`, `claim-decomposition-body`, `feature-comparison-body`, `inventiveness-step-1/2/3` (for 5.1/5.2/5.3), `other-requirements-body`, `evidence-body`, `citation-log-body`, and `assumptions-body`; search-report's `assumptions` becomes `assumptions-body`; claims-spec injects claims and specification into `claims-body`/`specification-body` while the `权利要求书`/`说明书` headings stay in the template.

## Migration

1. Replace the `sections` argument with `draft` in every call. Each template's `SKILL.md` (under `assets/templates/patent/<template>/`) documents its slots, and validation errors list unknown and missing slots. Drafts built with the previous slot ids (e.g. patentability-opinion's `basis`, `inventiveness`) fail as unknown slots and are renamed as above. A draft also has to carry the document number now: claims-spec takes it as the required `meta.caseNumber`, the eight document templates take the masthead number line as the required `doc-number` section and the footer number as the required `footer-case` field (patentability-opinion's optional `footer-docno` is renamed to `footer-case` and becomes required).
2. Re-render a representative document and diff it against the previous output: headings, numbering, and captions now come from the structure, so payloads that authored them no longer match.
3. Confirm: a call omitting `draft` fails with `missing required property "draft"`, and a call with a valid draft writes the HTML/PDF pair as before.
