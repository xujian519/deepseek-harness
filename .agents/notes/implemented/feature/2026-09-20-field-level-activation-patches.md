# Agent Note: Apply field-level activation patches, not just action

Status: implemented

English | [中文](2026-09-20-field-level-activation-patches.zh.md)

## Problem

`activation-overrides.yaml` is the machine-readable authority for the patent rule-review conclusions: `scripts/port-nuo-rules.ts` regenerates `rules/patent/nuo-*.yaml` from upstream, so a review conclusion that edits those files is erased by the next port. The patch file is the only place a conclusion survives.

The patch could carry one field, `action`. `applyRuleOverrides` spread it over the rule and dropped everything else, so a review that concluded "tighten the match" — add the 9 case-number spellings that `X-REF-003` misses, switch on negation context so `防窃听装置` stops being flagged, extend the negation words with the domain's own — had nowhere to land. The asset's own `EX-SEL-004` entry said so in prose: a `negationContext` follow-up was noted and nothing could apply it.

Two structural failures were silent. A patch key that was misspelled, and a patch whose rule id did not exist in the rule set, both passed without a warning: `applyRuleOverrides` looked up each rule and ignored misses, and the compliance loader validated only `isRuleAction` and discarded unknown keys. A review conclusion that was written down but never took effect is indistinguishable from one that was never written.

`KeywordBlocklistCheck` had no field for domain negation words at all, and `RuleEngine.checkKeywordEntry` called `hasNegationContext` without a word list, so even a hand-edited asset could not introduce one.

## Decision

A patch is now a **field-level merge at two levels**. `action` replaces the whole field; `addKeywords`, `negationContext`, and `additionalNegationWords` merge at check level — `addKeywords` appends to the rule's existing `keywords`, `negationContext` overrides the switch, `additionalNegationWords` appends to whatever the rule already carries. `ActivationRulePatch` declares the four fields, and `ACTIVATION_PATCH_KEYS` lists the accepted keys (`reason` included, documentation only) so a misspelled key is reportable rather than invisible.

Append rather than redeclare is deliberate. Redeclaring the whole check in the patch would create a second copy in the repository that must be kept in sync with the generated rule, and editing the generated `nuo-*.yaml` is undone by the next port. Appending neither edits the generated artifact nor creates a copy.

Check-level keys apply only to `keyword_blocklist`; on any other check type the patch reports an issue and the rule is left alone.

`additionalNegationWords` and `negationContext` are **orthogonal**: the word list supplies words, the switch is the only thing that enables filtering. Declaring words without `negationContext: true` is reported at both points that can observe it — `parseCheck` for a hand-written asset, `applyActivationPatch` for a patch — instead of passing as a dead declaration. The engine does not auto-enable: a rule carrying `negationContext: false` and a word list is self-contradictory, and silently letting the word list win would hide which of the two is in effect.

Domain words stay per-rule. `mergeNegationWords` folds a rule's `additionalNegationWords` over `DEFAULT_NEGATION_WORDS` for that rule's evaluation only. Folding them into the shared default list instead would widen the release surface of every negation-context rule at once — `PAT-RISK-001`, `PAT-ABS-001`, `INV-EVIDENCE-001` and the rest — which is why the two regression cases in `rule-asset-review-samples.spec.ts` exist.

Every structural failure mode collects a `RuleSetValidationIssue` rather than disappearing: unknown key, unknown rule id, check-level keys on a non-`keyword_blocklist` check, a non-string-array field, a non-boolean switch, and an empty patch. `applyRuleOverrides` takes an optional third `issues` collector, so existing call sites stay valid. `loadPatentFullRuleSet` folds the collector's messages into its own warnings. A patch with any invalid field is skipped whole — a half-applied patch is not applied.

The asset gains the three ported conclusions the code now supports: `X-REF-003` variant spellings, `EX-SEL-004` negation context with its four domain words, and `IPC-GEN-INV-002` demoted to `log` beside its duplicate `EX-INV-007`.

## Alternatives considered

**Add the domain release words to `DEFAULT_NEGATION_WORDS`.** Rejected: it is the global list, so one entry would widen every negation-context rule at the same time. The domain words are meaningful for `EX-SEL-004` and wrong for the rules that would silently inherit them.

**Let a patch redeclare the whole `check`.** Rejected: the generated `nuo-*.yaml` is the single source for the rule body, and a redeclaration in the patch is a second copy that drifts. Appending fields keeps one home for the rule and one home for the conclusion.

**Edit the generated `nuo-*.yaml` directly.** Rejected: `port-nuo-rules.ts` rewrites those files from upstream, so the conclusion would survive only until the next port.

**Treat a present `additionalNegationWords` as implying the switch.** Rejected: `negationContext: false` plus a word list is a contradictory declaration, and resolving it silently makes the effective behaviour unreadable from the rule. Reporting it keeps both keys meaningful.

**Keep ignoring unknown keys and unmatched ids.** Rejected: a misspelled key or id is exactly the failure this file exists to prevent — a written review conclusion that never took effect. Neither was observable before.

## Consequences

A review conclusion that only tightens matching now lands in the patch file. `EX-SEL-004` releases legitimate security topics while the true positives still hit; `X-REF-003` covers 12 spellings of placeholder case numbers without extending its false-positive surface, because every added alternative carries the `202X`/`202x` year placeholder and real case numbers carry digits.

The patch file is validated. `loadActivationOverrides` skips a patch whose field is mistyped, and `loadPatentFullRuleSet` surfaces unknown ids, unknown keys, and the orthogonal-declaration case as warnings.

`asStringArray` is exported from `RuleLoader.ts` so the compliance loader validates list fields with the same rule the asset parser uses.

The asset's patch count moves from 29 to 31. `patent-full-rule-set.spec.ts` asserts the count together with "no warnings", so a future patch that is written but not applicable fails the suite rather than being absorbed.

## Testing

`packages/patent/patent-rule/tests/patent-full-rule-set.spec.ts` — the patch count with no warnings; check-level keys append rather than redeclare; the two keys are orthogonal and a missing switch is reported; an unknown id warns; an unknown key warns while the known keys still apply; check-level keys on a non-`keyword_blocklist` rule warn and leave the rule unchanged; a patch that appends words without the switch warns; an empty patch warns.

`packages/patent/patent-rule/tests/rule-asset-review-samples.spec.ts` — each review conclusion as an executable case: the 9 new `X-REF-003` spellings hit, the half-width uppercase spelling still hits, real case numbers stay clear, the four `EX-SEL-004` release words each release their topic, true positives still hit, the negation window's one-sidedness stays pinned, the duplicate pair produces one user-visible warning, and the two cases that fail if the domain words ever move into the shared default list.

`packages/patent/patent-rule/tests/rule-loader.spec.ts` — a non-array `additionalNegationWords` is reported and the field dropped.

`packages/patent/patent-rule/tests/patent-compliance.spec.ts` — a mistyped list field, an empty list, and a non-boolean switch each skip the whole patch.

## Related

- [Sati patent domain as dsh plugins](2026-08-17-sati-patent-domain-dsh-plugins.md) — the port this package belongs to.
