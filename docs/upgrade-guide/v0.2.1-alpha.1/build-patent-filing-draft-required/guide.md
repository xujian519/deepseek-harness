---
kind: upgrade-guide
description: "build_patent_filing removes its content parameter and requires a SpecDraft; the DOCX gets automatic claim item numbers, 图N为 drawing descriptions, and caption paragraphs."
---

# build_patent_filing requires a controlled draft

English | [中文](guide.zh.md)

## Change

`build_patent_filing` no longer accepts the `content` parameter and requires `draft`, the same SpecDraft structure the claims-spec render takes. A call carrying `content` is rejected at the argument gate with `missing required property "draft"`.

The produced DOCX changes with the structure: claims are prefixed with item numbers automatically; drawing-description list items are rewritten as `图N为……；/。` paragraphs; and every table gets a `表 N · 名称` caption paragraph numbered by its own continuous 表 counter. Caption paragraphs carry no `[NNNN]` number and consume no number slot — the engine numbers body paragraphs only, so the body sequence stays continuous.

## Migration

1. Map `content` to `draft`: `meta`, unnumbered `claims`, `abstract`, `figureFiles`, `drawingDescriptions`, and the five specification sections as blocks. Remove authored item numbers, `图N` prefixes, table captions, and `[NNNN]` prefixes from the text; the tool generates them and the engine rewrites numbering from paragraph order.
2. Re-run `build_patent_filing` and verify the result with `verify_patent_filing`.
3. Confirm: a call without `draft` fails with `missing required property "draft"`; the verifier reports continuous `[NNNN]` numbering over the body paragraphs, with captions present and unnumbered.
