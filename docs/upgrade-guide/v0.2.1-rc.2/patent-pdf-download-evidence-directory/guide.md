---
kind: upgrade-guide
description: "patent_pdf_download with record=true now writes evidence screenshots under <outputDir>/evidence/."
---

# Evidence screenshots move into an evidence directory

English | [中文](guide.zh.md)

## Change

`patent_pdf_download` with `record: true` previously wrote each screenshot to `<outputDir>/evidence-<patent>.png` and returned that path in `recorded` / `evidence`. The screenshots now live in `<outputDir>/evidence/evidence-<patent>.png`, and `recorded` names `<outputDir>/evidence`. Keeping the images in their own directory stops them from mixing with downloaded PDFs when the output directory is used as a deliverable folder.

## Migration

1. Read the paths returned in the tool result; do not rebuild them from the patent number.
2. If a downstream step referenced the old flat path, point it at `<outputDir>/evidence/evidence-<patent>.png`.
3. Confirm: a `record: true` call returns `recorded: "<outputDir>/evidence"` and each evidence entry exists under that directory.
