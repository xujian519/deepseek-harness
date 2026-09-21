# Agent Note: Merge the Mady rule assets into the patent rule engine

Status: implemented

English | [中文](2026-09-21-mady-rule-asset-merge-boundary.zh.md)

## Problem

The Mady rule corpus (`domains/rules/data/rules/`, 313 entries across 27 files) was the presumed source for the patent rule gate, and the rule-difference report left 165 entries as the merge target. What runs in Mady is narrower than that corpus suggests: `Check.Evaluate` (`domains/rules/evaluate.go`) executes only `presence` / `absence` / `numeric` / `composition` and returns `Passed: true, Score: 0.5` with the detail "类型 %q 需要 LLM 判断，跳过自动检查" for every other `check.type`. No corpus entry uses one of the four executable types, so none of the 313 entries is machine-checked in Mady.

Two further facts narrowed the merge. The 48-entry infringement file carries empty payloads (`keyword_blocklist` with `keywords: []`, `structural_analysis` whose `requiresAll` elements hold `patterns: []`), so there is nothing to convert. The entries that do carry literal keyword, pattern, or element lists are already mirrored in this repository's `assets/rules/patent/nuo-*.yaml`; a scan for entries that are both absent here and hold a literal payload returned none.

## Decision

Merge into two hand-written asset files under `packages/patent/patent-rule/assets/rules/patent/`, both loaded by `loadPatentFullRuleSet` through the explicit `MERGED_RULE_FILES` list beside the generated-mirror `NUO_RULE_FILES` list. `activation-overrides.yaml` applies to the merged result, so a review conclusion can target either family.

`current-law.yaml` (3 rules, `LAW-*` ids) turns the current-statute baseline into deterministic bans on output text: a two-year infringement limitation (`民法典第188条` sets three years), the replaced judicial interpretation as the equivalence basis (`法释〔2009〕20 号第 17 条` is current), and attributing utility-model subject matter to `专利法第二条第二款`. Each ban is `pattern_analysis`, so none of them reaches the output gate; a bare phrase such as "两年" cannot be banned through `keyword_blocklist` without over-firing, and clause numbers that the baseline did not verify are named semantically instead of cited.

`mady-gap-rules.yaml` (14 rules, upstream ids) converts upstream entries the mirrors do not cover, using the same mapping the mirrors were generated with:

| Upstream check | Converted check |
| --- | --- |
| `regex_pattern.antiPatterns` | `keyword_blocklist` (hit = violation) |
| `category_detection` (`categories[].keywords`, `minCategories` N/M) | `structural_analysis` (elements = categories, `minConfidence` ≈ N/M) |
| `section_structure` / `specification_analysis` (`requiredSections`) | `structural_analysis` (elements = section names) |
| `patent_*` (`requiredElements` / `requiredAspects`) | `structural_analysis` (elements = literal term lists) |
| `regex_pattern.requireAny` | not merged — equivalent to the mirrored `X-REF-001` / `X-REF-002` reference-completeness rules |

Every upstream `block` is reviewed down to `warn` (upstream `info` becomes `log`), matching the rule that a newly merged rule does not land as `block`. The review conclusions sit in the asset itself, since the file is hand-written; `activation-overrides.yaml` still applies to the merged result, so a later review can target either family. No synonym additions accompany the merge: `synonyms.yaml` feeds `synonym_match` only, and no merged rule uses that check. Two of the converted bans are `keyword_blocklist`, so `selectGateRules` picks them up next to the mirror rules and the output gate grows from 9 to 11 rules; the earlier scenarios' text contains none of their keywords.

Not merged, and why:

- **Empty payloads** — the 48 infringement entries and the 15 no-`check` entries in `infringement-rules.yaml` have nothing to match.
- **Equivalent to an existing rule** — `CON-202` / `PR-FMT-001` (specification sections and abstract) are the same checks as `EX-DIS-001` / `EX-SPEC-003`; `CON-304` duplicates `EX-CLM-004`; `P-INV-005` and the per-field `IPC-*-INV-*` three-step variants duplicate `EX-INV-001`; `EX-NOV-002` reduces to a near-always-true pair of words. Merging them would produce two user-visible prompts for one text, which the difference report forbids.
- **Payload is prose** — principles, statutory conditions, methods, decision citations (`amendment-rules.yaml` 15 entries, `NOV-*`, `INV-*`, `DIS-*`, `CLA-*`, `RES-*`, `patent-core.yaml`, `novelty-rules.yaml`). These are standards for a draft, not patterns; they stay outside the package and belong to the skill layer.
- **Payload is wording used by correct text** — `JD-DEF-006` (`贴标行为` / `标注商标`), `IPC-B23-INV-002` and `IPC-H02-INV-001` (`割裂` / `分别判断` / `简单组合`, which appear in the sentence stating the standard itself). A literal ban would fire on correct statements.

## Alternatives considered

**Convert all 165 difference entries.** Rejected: most carry prose labels (`技术特征拆解`, `实质联系`, `客观要件`) whose literal match is either near-always-true or fires on text that never uses the label; the converted rules would add prompt noise without a decision.

**Repair the mirror conversion in `nuo-compliance-enforceable.yaml`.** Not done. `CON-COMP-0104` upstream is `pattern_analysis` with an `antiPatterns` exemption list — "citing the Examination Guidelines without naming the chapter" — and the mirror renders it as a completeness rule that fires whenever the text does not mention 审查指南 at all, with `activation-overrides.yaml` lowering it to `log`. Generated mirrors are not edited here (an upstream re-sync would silently overwrite the edit), and an activation patch can change an action or append keywords but cannot express the exemption list, so the conversion is left as it stands and recorded here.

**Land the current-law bans in `patent/compliance.yaml`.** Rejected: that file is the general-compliance scope's home (4 `PAT-*` rules), so planting domain bans there would change the default `patent` scope's meaning and mix two homes.

**Land the current-law bans as `keyword_blocklist` so the output gate enforces them.** Rejected: the bans need regex windows (a citation followed by 17, a 实用新型 mention within 40 characters of a clause number); keyword matching on the shortened phrases would fire on correct text.

## Consequences

`rule_check(patent-full)` now evaluates 117 rules, and the output gate 11. Current-law wording and the converted bans surface through `rule_check`; the current-law bans do not gate output, so a session that publishes such wording still sees them only when the model self-checks.

The residual upstream corpus stays outside the package: no executable payloads to move, and prose standards that are skill material. The merge set, its upstream ids, and the boundary are asserted in `packages/patent/patent-rule/tests/merged-rule-assets.spec.ts`, so an unrecorded merge or a reintroduced equivalent fails the suite.

The mirror conversion of `CON-COMP-0104` remains as described above. Any future decision to repair mirror conversions has to happen either upstream or as a new asset, not as a patch.

## Testing

`packages/patent/patent-rule/tests/merged-rule-assets.spec.ts` pins the two files' rule sets, the upstream-id traceability table, the review downgrade (no merged rule blocks; severities stay in the closed set), the not-merged boundary ids, and one rejecting plus one accepting text per merged rule class. `tests/patent-full-rule-set.spec.ts` and `tests/output-gate.spec.ts` carry the new rule and gate counts.
