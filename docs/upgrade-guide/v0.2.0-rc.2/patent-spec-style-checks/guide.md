---
kind: upgrade-guide
description: "validate_specification reports specification-style errors it did not report before — headings outside the five parts, part order, parenthesized figure marks, spaced figure numbers, abstract headings — and draft_claims blocks a claim set over the max_claims the caller passes, so texts that passed the gate before can now fail it."
---

# validate_specification decides specification style and the claim-count ceiling

English | [中文](guide.zh.md)

## Change

`validate_specification` gained six deterministic checks. They read the same `text` and `abstract` inputs as before and report `severity: 'error'` unless noted, which flips `passed` to false and lowers `score`:

- `heading_set` — any heading in `text` other than 技术领域、背景技术、发明内容、附图说明、具体实施方式 (the five parts 专利法实施细则第二十条 names) and the `说明书` document wrapper. 要解决的技术问题、技术方案、有益效果、实施例一、替代实施方式 are content, not parts; written as headings they are now errors.
- `section_order` — the five parts out of the order above.
- `figure_mark_parentheses` — `名称（数字）` in the specification body (指南第二部分第二章 §2.2.6 requires the mark without parentheses). A name ending in an enumeration suffix is skipped.
- `figure_number_spacing` — `图 1` instead of `图1`.
- `paragraph_numbering` — **warning only**: `[0001]`-form numbering appears in the text. No law or guideline clause requires it.
- `abstract_heading` — a heading inside the `abstract` input (指南第一部分第一章 §4.5.1 prohibits it).

`draft_claims` gained the optional `max_claims` parameter. Passing it turns a claim set larger than the ceiling into an `error` (`claim_count_cap`) rather than the existing `additional_fee` warning, so a draft that only tripped the fee notice now fails.

## Migration

1. Run `validate_specification` on each specification you maintain and read the new rule names. Delete every heading other than the five parts (keep the content, drop the heading), close up `图 1` to `图1`, and rewrite `模块（1）` as `模块1`. Remove headings from the abstract.
2. To satisfy the claim-count requirement, pass the ceiling you were given: `draft_claims({ …, max_claims: 10 })`. Do not treat exceeding it as a fee trade-off — the error blocks.
3. Paragraph numbers stay a warning; a deployment whose filing format omits them should have the renderer drop them (see the claims-spec paragraph-numbering guide), not the writer.
4. Confirm: re-run `validate_specification`; the five error rule names above (`heading_set`, `section_order`, `figure_mark_parentheses`, `figure_number_spacing`, `abstract_heading`) are absent from `violations`, and `draft_claims` with `max_claims` reports no `claim_count_cap`. A `paragraph_numbering` warning is expected and correct wherever the text still carries `[0001]`-form numbers.
