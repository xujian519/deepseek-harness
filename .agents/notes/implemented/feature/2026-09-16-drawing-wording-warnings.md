# Agent Note: Report drawing-wording defects from the figure tools

Status: implemented

English | [中文](2026-09-16-drawing-wording-warnings.zh.md)

## Problem

Chinese patent drawings carry form requirements the generator can violate without knowing it. 《专利法实施细则》第二十一条: 「附图中除必需的词语外，不应当含有其他注释。」《专利审查指南》第一部分第一章 4.3 adds 「附图中的词语应当使用中文，必要时可以在其后的括号里注明原文」 and 「附图标记应当使用阿拉伯数字编号」. A caller passing a component label such as 「注：仅用于说明」, an English-only label, or a reference numeral such as `S101` received a successful render with no signal that the drawing would draw a 补正通知书 on those grounds.

The information needed for that signal is already in the tool's input: the labels that reach the DOT, and the numerals assigned to components.

## Decision

**`figure/wording-rules.ts` derives wording warnings from the figure's own words and numerals, and both figure tools report them.**

- `figureWordingWarnings(labels, numerals)` returns warning text and never rewrites input. Labels are split on newlines (the DOT `\n` line-break form) and each line is judged; duplicate wording and numerals report once, in first-seen order.
- Four annotation features warn with their own hint: an annotation prefix (注/注意/说明/备注/提示 followed by a colon), a text reference (如图/见图/参见图/见附图, `see fig`), a dimension callout (a number followed by a length unit, including 英寸/毫米/厘米/分米/微米/纳米), and sentence-ending punctuation (。；;).
- A word with no CJK character and no permitted non-Chinese form warns. Permitted forms are all-caps acronyms (CPU, EPROM, GB, I2C, A/D) and strings without Latin letters (digits, symbols, unit spellings), matching the non-Chinese forms the guidelines permit for Chinese patent text.
- A reference numeral that is not purely ASCII digits warns, quoting the numeral rule.
- `generate_patent_figure` collects the wording it will draw — node labels, edge labels, and, for `raw_dot`, the quoted `label` attribute values — and appends the warnings on both the single-figure and `panels` paths. `add_patent_figure_references` checks the numerals it is asked to draw; its `label` values are match keys for the caller's existing drawing, not wording this tool places.

## Alternatives considered

**Refuse the figure when a rule trips.** A drawing with an annotation that a drafter considers necessary is still the applicant's call, and the tool cannot distinguish 「必需」 from 「非必需」 words. Blocking would either drop legitimate drawings or force callers to bypass the tool, so the report is advisory and the renderer never edits the labels.

**Scan the rendered SVG's text instead of the input.** Reading the produced figure would cover content the input does not name, but png/pdf output has no text to read, `raw_dot` would need the DOT parsed anyway, and a scan of a caller-supplied SVG in `add_patent_figure_references` would flag the caller's own drawing rather than this tool's placement.

**Expose the check as its own tool.** A separate `check_patent_figure` call produces no artifact of its own and separates the verdict from the drawing it judges; the caller would have to pass the same labels twice. Returning the warnings from the call that drew them keeps one record per figure.

**Judge necessary-versus-unnecessary wording by label length or a classifier.** No length threshold follows from the regulation, and a classifier would introduce a model call for a check the regulation states as concrete text patterns. The implemented rules quote the regulation's own categories.

## Consequences

- Figures with English-only component names now report a warning. Callers labelling software figures in English see it on every generation until they switch to Chinese labels or all-caps acronyms, which is the regulation's requirement rather than a tool preference.
- The report never blocks or rewrites, so a caller that ignores `warnings` gets the same artifact as before.
- `add_patent_figure_references` reports non-digit numerals only; its warning list mixes unmatched-reference reports with numeral reports, so a caller counting warnings must read the text.

## Testing

- `packages/patent/patent-tools/tests/figure-wording.spec.ts` pins each rule, the permitted forms, newline splitting, and deduplication.
- `packages/patent/patent-tools/tests/figure-generate-tool.spec.ts` covers the tool-level path for structured labels, `raw_dot` label extraction, a clean input with no warnings, and the numeral report from `add_patent_figure_references`.

## Related

- [Leader-line numerals land inside the figure canvas](../bug-fix/2026-09-16-leader-line-numerals-inside-canvas.md)
