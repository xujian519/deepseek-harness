---
kind: upgrade-guide
description: "The length budget now counts prose only: `visibleChars` drops tables and the amended-claims full text before counting, and `tighten` reports carrier blocks that went missing instead of spending them to hit a budget."
---

# The length budget stops counting tables

English | [中文](guide.zh.md)

## Change

The written rule was already "visible characters, excluding tables and the full text of amended claims" (`conventions.md` §10). The implementation only stripped markup, so table cells counted. On a real recorded answer the gap was not cosmetic: 987 of the 2892 counted characters — 34% — were table text.

`visibleChars` now removes the carriers first: Markdown table rows, HTML `<table>` elements, `claim-text` elements, and the whole section under a 修改后的独立权利要求 heading (until a heading of the same or higher level). It then strips markup and whitespace as before. `slop-gate`'s concision dimension and `tighten`'s before/after count both call it, so the number a model is told and the number it is judged by are now the same number.

`tighten` also stops treating carriers as slack. It counts table blocks and claim-full-text blocks before the model runs and compares afterwards; a missing block becomes a `tighten_violations` line even when the character count passes. Deleting 表 1 or the 2.1 full text is a lost deliverable, not a shorter answer.

An unchanged body is now reported as unchanged — "model returned the text unchanged" plus the remaining deficit — instead of the generic "still over budget". "Cut nothing" and "cut too little" are different failures and different fixes.

The prompt gained two lines: tables and the full text are excluded from the count and must not be deleted whole; anything listed in `removed` must actually be gone from the body.

## Migration

1. Length numbers drop for any answer carrying tables: the same answer reads 2892 before, 1905 after. Budgets and pass lines do not have to move; if you calibrated a budget against the old table-inclusive numbers, recheck it.
2. `slop-gate` scores move only for texts that sat near a band edge; the scoring bands themselves are unchanged.
3. `tighten` will now degrade more often on answers whose only slack was tables. That is the intended verdict: carriers are not slack, and a degraded stage falls back to `draft`.
4. If your own check counts tables as prose, it sees less text than before; the `patent-oas` length observation already used this convention.
