---
kind: upgrade-guide
description: "`response-check` gains a brevity channel (`response_concision_*`) plus two warn-level rules, PR-OA-010 (empty sections) and PR-OA-011 (repeated conclusions)."
---

# The response check splits off a brevity channel

English | [中文](guide.zh.md)

## Change

`response-check` (`packages/patent/patent-tools`) used to judge three compliance rules only: PR-OA-007 (enablement standard), PR-OA-008 (ground coverage), PR-OA-009 (unraised statute citation). It now also judges four brevity rules — PR-OA-005 (count-based argument), PR-OA-006 (duplicate quotation), PR-OA-010 (empty sections), PR-OA-011 (repeated conclusions) — and reports them under three separate keys:

| Key | Content |
| --- | --- |
| `response_concision_report` | Brevity report (Markdown) |
| `response_concision_passed` | Whether the brevity channel found nothing |
| `response_concision_violations` | Brevity violations |

`response_check_report` / `response_check_passed` / `response_check_violations` / `response_check_unevaluated` keep exactly their old meaning: the three compliance rules decide them. The channels are separate because a compliance hit means the document fails a statutory or procedural requirement, while a brevity hit only means the draft should be cut — `legal-gaps` books the former as `block` and the latter as `warn`, so a false `response_concision_passed` never blocks delivery.

The rule-id constants split into `COMPLIANCE_RULE_IDS` (three) and `CONCISION_RULE_IDS` (four); the old `RESPONSE_CHECK_RULE_IDS` stays as an alias of the former with an unchanged value.

`oa-response-form.yaml` gains two `warn` rules:

- **PR-OA-010 empty sections**: a section heading followed by no body, or by a placeholder such as 「无」. Both Markdown headings and `<h2>` headings are recognised; a parent section holding only sub-headings is not empty; stylesheets, scripts and code blocks are not body.
- **PR-OA-011 repeated conclusions**: the same sentence (12+ characters) appearing three or more times. Stylesheets and table delimiter rows are excluded from counting.

The `patent-full` scope goes from 123 to 125 rules.

`example.html` in the `oa-response` template changed one phrase: step two of the inventiveness argument re-quoted the feature added to claim 1 in 「」, and now refers to `F2` (see 3.1) instead, so the reference answer itself passes PR-OA-006. The change is illustrative and touches neither template slots nor render structure.

## Migration

1. Consumers that read only `response_check_passed` are unaffected. To take up brevity, read `response_concision_passed` as well; do not fold the two into one boolean — that makes "the sentence is wordy" look like a legal block.
2. If you assemble the rule list yourself, put PR-OA-010/011 on the brevity side: both are warn-level and incident-style, and putting them on the compliance side flips `response_check_passed`.
3. A hand-written document that trips PR-OA-010 should lose the whole section, not just its body; one that trips PR-OA-011 keeps a single conclusion and turns the rest into "see the conclusion above".
4. PR-OA-006 keeps `minOccurrences: 2` (unchanged here): two occurrences of the same quotation in an answer still report, including a legitimate "state it, then cite it" pair. Adjust it in the rule asset if your practice differs.
5. Re-run `pnpm exec vitest run packages/patent/patent-rule packages/patent/patent-tools` after editing either side.
