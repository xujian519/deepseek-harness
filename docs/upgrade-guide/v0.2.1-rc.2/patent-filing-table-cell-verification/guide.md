---
kind: upgrade-guide
description: "verify_patent_filing now checks font size, color, and internal marks inside table cells, so affected documents can newly fail."
---

# Filing verification covers table cells

English | [中文](guide.zh.md)

## Change

`verify_patent_filing` iterated only body paragraphs. Table cell paragraphs — where a parts list or parameter table commonly carries text — were skipped, so a table cell with a 10 pt run, a non-black color, or the internal mark `内部复核稿` passed verification. The verifier now walks table cell paragraphs in body order and applies the same line-spacing, indent, font-size, color, and forbidden-text assertions to them. Documents whose tables already match the template keep passing; documents with a defective cell now return `passed: false` and name that cell's text in `errors`.

## Migration

1. Run `verify_patent_filing` on previously delivered documents; treat new table-cell errors as findings, not regressions.
2. Correct the named cell's font size, color, line spacing, indent, or internal mark in the source draft and rebuild, rather than editing the DOCX.
3. Confirm: a document whose only defect is a red 10 pt table cell containing `内部复核稿` reports errors for the mark, the font size, and the non-black color; the same document with a clean cell passes.
