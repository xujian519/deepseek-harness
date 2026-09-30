# Agent Note: Patent rule findings gate on applicability premises and quoted spans

Status: implemented

English | [中文](2026-09-30-rule-applicability-premises-and-quoted-spans.zh.md)

## Problem

A 26.3 office-action answer drafted on 2026-09-30 (case 202522146475.8) returned 49 `rule_check` findings under scope `patent-oa-response`, and none of them named its real trouble. 48 were `structural_analysis` "要素不完整" hits from completeness rules belonging to legal grounds the answer never argued — novelty, inventiveness, claim-drafting form. A completeness rule reports a missing element on any text that lacks it, so it fires exactly as loudly on a document that never discusses its subject as on one that does. The last hit was a false positive: `PAT-ABS-001` matched 「一定」 inside a sentence the answer quoted verbatim from the examiner's notice. The two defects the answer did have — arguing sufficiency with word counts ("『储漆』出现 0 次") instead of the enablement standard, and restating one specification passage four times — had no rule at all.

The lever before this change was severity: review had already taken the merged completeness rules down from upstream `block` to `warn`/`log`. That quiets a finding without removing it, and 48 inapplicable `warn` rows around the 2 relevant findings a run does not contain make the self-check unusable precisely when the model consults it.

## Decision

Three additions to the rule model, declared in [`@deepseek-ai/dsh-patent-core`](../../../../packages/patent/patent-core/README.md)'s rule types and executed by [`@deepseek-ai/dsh-patent-rule`](../../../../packages/patent/patent-rule/README.md):

**Applicability premise.** `ConstitutionalRule.premise` is a rule-level, case-insensitive regex OR-list: when no pattern matches the text, the rule is not evaluated and reports nothing. A premise names the subject the rule is about — the legal question, the document topic; it never restates the rule's own element patterns, because for a completeness rule the elements are what may be missing and a premise built from them would leave a rule that only runs where it has nothing to report. An unsatisfied premise is silence, not a downgrade: "this rule does not apply to this document" is not a severity question.

**Quote immunity.** `keyword_blocklist` takes `quoteImmune: true`: a hit inside a paired quote (`「」`, `『』`, `“”`) is quoted text, not the author's own statement. `PAT-RISK-001` and `PAT-ABS-001` carry it, so an answer quoting the notice's 「需要一定的时间」 is no longer read as the model's absolute claim. Unclosed quotes exempt nothing — the failure direction stays detection.

**Quoted-span repetition.** The `quote_repetition` check normalizes each quoted span (whitespace and ellipses removed), counts spans of at least `minLength` (default 12) characters, and reports every span reaching `minOccurrences` (default 2) with its count and the span itself.

The answer-form rules built on these checks are the new hand-written `oa-response-form.yaml` family: `PR-OA-005` (count-based argument, `pattern_analysis`), `PR-OA-006` (duplicate quotation), and `PR-OA-007` (the 26.3 enablement standard an answer must argue, itself premise-gated). All three are `warn`-only and stay outside the output gate, which continues to take `keyword_blocklist` rules alone; they reach a document through an explicit `rule_check`, and the `patent-oa-response` skill asks for that self-check before delivery.

Patch surface: `activation-overrides.yaml` accepts `premise` as a replace field, and its new `premise-vocab` top level holds the shared subject vocabularies as YAML anchors — one home per subject. Premise mistakes fail loud at load: an empty, blank, or invalid-regex premise is a load warning on an asset and skips the patch on a review conclusion, so a written conclusion is never silently inapplicable. The 2026-09-30 review gated the completeness families whose grounds a document selectively discusses and recorded the degenerate cases it found (`EX-PRC-002`, `JD-PRC-003`, `P-PRC-003` — single-element expectation rules whose pattern list is their own subject vocabulary) in the patch reasons instead of leaving them silently dead.

## Alternatives considered

**Downgrade the completeness rules further instead of gating them.** Rejected: it keeps the finding and only lowers its level, and the merged rules had already gone `block` → `warn`/`log` — the 49-finding run is the result. The defect is that the rule is evaluated at all, not how loudly it reports.

**Classify the document type first and select rules from it.** Rejected as the shape of this fix: classification is a heavier, separate mechanism, while the premise form is deterministic and vocabulary-free — the rule declares the subject it is about and the text itself shows whether it touches it. It also composes with the domain filter instead of replacing it. Nothing classifies the document: a rule whose premise matches (an answer quoting the claim text, say) still reports its missing elements, which the package README keeps as a stated limitation.

**Build premises from the rule's own element terms.** Rejected: degenerate by construction. A completeness rule's elements are exactly the terms whose absence it reports, so gating on them leaves a rule that can never report anything; review found three rules already written that way and recorded them per rule.

**Exempt matches inside any quote character, closed or not.** Rejected: an unclosed quote would silence the rest of the document, and a red-line phrase the model wrote itself would hide behind a stray 「.

**Hold the notice text and excuse only spans copied from it.** Rejected: `rule_check` evaluates one text, quotations also come from statutes, the guidelines, and prior art, and a second input would change the tool's interface for a case the paired-quote mark already resolves.

## Consequences

On the audited answer, scope `patent-oa-response` now returns 2 findings — `PR-OA-005` and `PR-OA-006`, the two real defects — where the rule set in force returned 49, none of them the defects. Unfiltered, the same text yields 12: the other 10 are infringement and damages rules the job scope exists to exclude.

77 of the 120 bundled rules carry a premise; the full set grows by the 3 answer-form rules, and `activation-overrides.yaml` carries 90 patches. A premise wrong in the other direction — too narrow, or matching nothing — hides defects instead of adding noise; load-time regex validation, the shared `premise-vocab` anchors, and the per-rule patch reasons bound that risk without removing it. The accepted residue is that argument-type rules keep the broad `claims` vocabulary (arguing a claim defect is evaluated wherever claims vocabulary appears), while drafting-form rules use the product-shape `claim-drafting` vocabulary.

The output gate's composition is unchanged (14 `keyword_blocklist` rules); quote immunity narrows what `PAT-RISK-001` and `PAT-ABS-001` count as a hit, so a gated tool result that only quotes such phrases is no longer flagged.

## Testing

`packages/patent/patent-rule/tests/rule-engine.spec.ts` — an unsatisfied premise is silent while a satisfied one fires; case-insensitive matching; an empty premise array means always-evaluate; quote immunity inside `「」`/`『』`/`“”`, outside, and with an unclosed quote; `quote_repetition` at one and two occurrences, below `minLength`, after normalization, at a configured `minOccurrences`, with an unclosed span, and with an over-long span truncated in evidence and message alike.

`packages/patent/patent-rule/tests/rule-loader.spec.ts` — the three fields parse and validate; a patch replaces `premise`; an empty premise patch warns and is skipped.

`packages/patent/patent-rule/tests/patent-full-rule-set.spec.ts` — the 120-rule / 90-patch counts with no warnings; an answer about nothing but the specification draws no findings from the novelty, inventiveness, claim-drafting, subject-matter, or other untouched families; a numbered enumeration in the answer reactivates none of them, because only a numbered line opening with claims wording counts as a claim set; every untouched-family id is checked against the rule set; a premise is subject vocabulary, not global silence; a patch `premise` takes effect; `PR-OA-005`/`006`/`007` fire and stay silent as specified; `premise-vocab` entries and unknown top-level keys are validated.

`packages/patent/patent-rule/tests/output-gate.spec.ts` — quote immunity holds on the gate path: a quoted-only risky phrase draws no warn hint while the unquoted text still does.

`packages/patent/patent-rule/tests/case-scopes.spec.ts` — the scope probe text carries the subject vocabulary its rules require.

## Related

- [Job scopes for the patent rule gate](2026-09-21-patent-rule-job-scope-domains.md) — the domain filter the premise gate composes with.
- [Apply field-level activation patches, not just action](../feature/2026-09-20-field-level-activation-patches.md) — the patch mechanism `premise` joined.
- [Patent output gating runs on the rule gate alone](2026-09-28-patent-output-gating-runs-on-the-rule-gate.md) — the gate whose compliance hits quote immunity narrows.
