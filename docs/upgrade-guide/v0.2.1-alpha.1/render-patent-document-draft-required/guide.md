---
kind: upgrade-guide
description: "render_patent_document removes its sections innerHTML parameter and requires a controlled draft for every template."
---

# render_patent_document requires a controlled draft

English | [中文](guide.zh.md)

## Change

`render_patent_document` no longer accepts the `sections` parameter (a record of element id to innerHTML), and `draft` is now required. A call that passes `sections` without `draft` fails at the tool argument gate with `missing required property "draft"` instead of rendering.

The draft carries a typed structure per template family: claims-spec takes the SpecDraft structure (bibliographic `meta`, unnumbered `claims`, multi-paragraph `abstract`, one `drawingDescriptions` entry per figure, `figureFiles`, and the five specification parts as paragraph/list/table blocks); the other ten templates take id-keyed drafts (`fields` for leaf text slots, `sections` as blocks or rows). The converters generate headings, claim item numbers, figure numbers, table captions, and checkbox states, and escape all text, so a rendered document no longer carries model-authored HTML. A slot replaces only its own element's content: skeleton wrappers and section headings stay in the template. In claims-spec renders the specification carries exactly the five generated `h3` part headings, and the `h4` 实施例 example heading is gone.

## Migration

1. Replace the `sections` argument with `draft` in every call. Each template's `SKILL.md` (under `assets/templates/patent/<template>/`) documents its slots, and validation errors list unknown and missing slots.
2. Re-render a representative document and diff it against the previous output: headings, numbering, and captions now come from the structure, so payloads that authored them no longer match.
3. Confirm: a call omitting `draft` fails with `missing required property "draft"`, and a call with a valid draft writes the HTML/PDF pair as before.
