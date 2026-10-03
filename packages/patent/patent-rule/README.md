---
description: "Function plugin porting the Sati constitutional rule engine into the DeepSeek Harness: it ships the YAML rule packs as package assets, evaluates text deterministically, registers the EVI-011 evidence-compliance guards as monotonic denies, wires the RuleOutputGate onto tools/post-execute with review routed through ctx.approval, and denies a delivery tool call whose declared prerequisite gate runs have not succeeded earlier in the same session."
kind: "package-reference"
---

# @deepseek-ai/dsh-patent-rule

English | [中文](README.zh.md)

## Summary

Function plugin porting the Sati constitutional rule engine into the DeepSeek Harness: it ships the YAML rule packs as package assets, evaluates text deterministically, registers the EVI-011 evidence-compliance guards as monotonic denies, wires the RuleOutputGate onto tools/post-execute with review routed through ctx.approval, and denies a delivery tool call whose declared prerequisite gate runs have not succeeded earlier in the same session.

## Table of Contents

- [Output gate](#output-gate)
- [Delivery gate](#delivery-gate)
- [EVI-011 evidence guards](#evi-011-evidence-guards)
- [Rule engine (library API)](#rule-engine-library-api)
- [Rule assets](#rule-assets)
- [Applicability premises and quoted text](#applicability-premises-and-quoted-text)
- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Output gate

On the result of each delivery tool named in `gateToolNames` (`render_patent_document`, `draft_claims`, `draft_specification`, `validate_specification` by default), the plugin runs the rule subset selected by `gateCheckTypes` (`selectGateRules`; default `keyword_blocklist`, including the compliance keyword rules PAT-RISK-001 / PAT-APPROVAL-001 / PAT-ABS-001) through the `RuleOutputGate`. A block-level violation returns a block decision. A review-level violation fires `ctx.get('approval')` and accepts only on `allowed-once`, failing closed when there is no answerer, no agent, or `approvalDisabled` is set. warn/log violations pass through unchanged. Non-matching tools delegate via `next()`.

The check families split by semantics. `keyword_blocklist`, `pattern_analysis`, `citation_analysis`, and `quote_repetition` are incident families — a hit is a violation, so they hold on any text and a deployment may widen `gateCheckTypes` to all of them. `structural_analysis` and `synonym_match` are absence families — a missing element is a violation, and a tool result's prose always misses most expected elements, so they never enter the result gate; naming one in `gateCheckTypes` is rejected with a load warning rather than installing a gate that mass-reports. Their execution point is the artifact structural gate below.

The loaded gate is also exposed as `ctx.get('patentRuleGate')` (Context merge, optional — present only while this plugin is mounted), so team consumers such as patent-teams can rule-gate task completion consistently with the post-execute path.

### Artifact structural gate

A deployment may declare `structuralGate` entries: each names a delivery tool, the arguments carrying that tool's artifact text, the absence-based rule ids to judge it by, and optional `whenArgs` for exact-match argument values. The plugin evaluates the artifact text before dispatch through `tools/pre-execute` and denies the call when a block-level rule fires, so a non-conforming artifact is never rendered or written; the denial names the rule, its statement, and its legal basis.

The declaration is per rule id rather than per domain because a domain's absence rules may not suit the artifact's form: `patent_claims` holds CON-301, whose patterns are review words (清楚 / 简要 / 限定 / 必要技术特征) that a plain claim draft never contains. A declared id missing from the loaded rule set draws a load warning and is dropped, so a typo never leaves a gate that looks armed but judges nothing.

An entry is only correct for arguments that carry the artifact itself. `render_patent_document` takes template slot fragments in `sections`, and the shipped templates already contain the fixed wording (claim sentences, section headings), so judging those fragments reports absences the rendered document does not have — that template is not a safe target. Enable the gate where the tool's argument is the document text in full.

## Delivery gate

A deployment may declare `deliveryGate` entries: each names a delivery tool and the tools that must have succeeded earlier in the same session before it may run, with optional `whenArgs` (a string matches exactly, a string array is a value set) narrowing the entry to matching calls. An unsatisfied entry denies the call through `ctx.tools.guard()`, a monotonic guard, so no listener ordering or permission rule can turn the denial back into a call. The denial names the missing prerequisite tools, and the model re-invokes them instead of losing the delivery to a silent gap.

The gate exists because a discipline stated only in a prompt is indistinguishable from no discipline in the call record: the run that happened and the run that did not leave the same trace when nothing checks. The ledger holds the tool names that returned successfully, recorded from `tools/post-execute` where the outcome is known — a deny decided before dispatch cannot know whether the call it is about to allow will succeed. Recording and judging are therefore separate: the guard reads a ledger the post-execute listener fills.

The ledger is keyed by the calling agent, so one case's gate run never satisfies another case's delivery. A call with no agent cannot be attributed to any session, so it is treated as unsatisfied: an unattributable deliverable has no session record to show either. The shipped default declares no entry — which gate runs a delivery owes is the deployment's delivery policy, not this package's.

`render_patent_document` is the production consumer: the `patent` preset requires `rule_check` and `law_verify` before any delivery render, and additionally `patent_workflow_run` for the analysis templates, which run a manifest to closure. The two drafting forms (`claims-spec`, `rectification-response`) run no manifest and stay outside that second entry.

## EVI-011 evidence guards

`evaluate_evidence` calls are denied by two monotonic guards when an overseas or foreign-language evidence record omits its required notarization, legalization, or translation declaration. The guard condition fields derive from the packaged `evidence-rules.yaml`, falling back to a hardcoded set when the asset is missing. Each guard returns a denial reason string, so no allow result can override it.

## Rule engine (library API)

The package re-exports the ported rule engine: `evaluateText`, `evaluateRule`, `groupByAction`, `parseRuleSetFromYaml`, `loadRuleSetFromFile`, `loadRuleSetDir`, `mergeRuleSets`, `applyRuleOverrides`, `loadPatentComplianceRuleSet`, `loadPatentElectricalRuleSet`, `loadPatentFullRuleSet`, `loadActivationOverrides`, `selectGateRules`, `isGateCheckType`, `PATENT_CASE_DOMAINS`, `patentCaseDomains`, `loadRulePack`, `loadSynonymsAsset`, `RuleOutputGate`, the artifact gate's `resolveStructuralGate` / `structuralGateText` / `structuralGateViolations` / `renderStructuralGateDenial`, and the delivery gate's `DeliveryAttemptLedger` / `deliveryGateMissing` / `renderDeliveryGateDenial` / `resolveDeliveryGate` plus the shared `jsonRecord` / `declaredArgsMatch`.

## Rule assets

Three families live under `assets/rules/patent/`, distinguished by who owns them and how they load.

| Family | Files | Loaded as |
| --- | --- | --- |
| Hand-written compliance | `compliance.yaml`, `electrical-section-h.yaml` | One fixed file name each, by `loadPatentComplianceRuleSet` / `loadPatentElectricalRuleSet` |
| Generated upstream mirrors | `nuo-*.yaml` | By `loadPatentFullRuleSet`, through the explicit `NUO_RULE_FILES` list |
| Hand-merged current-law and gap rules | `current-law.yaml`, `mady-gap-rules.yaml`, `oa-response-form.yaml` | By `loadPatentFullRuleSet`, through the explicit `MERGED_RULE_FILES` list |

`current-law.yaml` bans superseded statute wording in output text: the two-year infringement limitation, the replaced judicial interpretation as the equivalence basis, and attributing utility-model subject matter to the second paragraph of Article 2. Its checks are `pattern_analysis`, so the default output gate does not take them (a deployment that names the family in `gateCheckTypes` does). `mady-gap-rules.yaml` holds upstream rules converted to the engine's check types — bans whose keywords are literal, and completeness checks whose element terms are literal — with every upstream `block` reviewed down to `warn` (`log` for the upstream `info` level). Two of its bans are `keyword_blocklist`, so the output gate picks them up alongside the mirror rules. `oa-response-form.yaml` holds the answer-form checks (count-based argument, duplicate quotation, the enablement standard an answer must argue) and is `warn`-only. `activation-overrides.yaml` applies to the merged result, so a review conclusion can target either family.

`activation-overrides.yaml` patches by rule id. `action` and `premise` replace their field; `addKeywords`, `negationContext`, and `additionalNegationWords` add to the existing check without restating it, so a review conclusion never creates a second copy of a generated rule. `premise-vocab` holds the shared vocabularies as YAML anchors — one home per subject. Patches that miss (unknown key, unknown id, empty or non-regex premise, negation words behind a closed switch) draw a load warning instead of silently not applying.

### Applicability premises and quoted text

`ConstitutionalRule.premise` is a rule-level regex OR-list: when no pattern matches the text, the rule is not evaluated and reports nothing. Completeness checks (`structural_analysis`, "missing element = violation") only mean something about text that touches their subject, so the reviewed assets give them subject-matter premises — a 26.3-only office-action answer draws no novelty, inventiveness, or claim-drafting findings. Two properties are deliberate: an unsatisfied premise is silence, not a downgrade (downgrading lowers severity and keeps the noise), and a premise names the subject, never the rule's own element terms — where a single-element expectation rule's pattern list is its own subject vocabulary, gating makes it permanent silence, which the patch reasons record per rule.

`keyword_blocklist` accepts `quoteImmune: true`: a match inside a paired quote (`「」`, `『』`, `“”`) is not the author's own statement, so an examiner sentence quoted with 「一定」 no longer reads as the model's absolute claim. Unclosed quotes exempt nothing — the failure direction is detection, not silence. `quote_repetition` (defaults `minLength` 12, `minOccurrences` 2) reports the same quoted span recurring, comparing spans after whitespace and ellipses are normalized: an answer that grows by restating a passage instead of arguing becomes visible. The answer-form rules built on these checks live in `oa-response-form.yaml` and stay out of the default output gate, which takes only `keyword_blocklist`.

### Job scopes

`PATENT_CASE_DOMAINS` maps the four job scopes — `patent-oa-response`, `patent-invalidation`, `patent-reexamination`, `patent-infringement`, named after the four job manifests and exposed through the `rule_check` tool — to the rule `domain` lists each one evaluates. A scope evaluates the common domains (`patent`, `patent_general`) plus its own document and procedure domains and the domains of the clauses it must answer or establish. The union of the four covers every domain in the merged set, so no asset domain lacks a job entry point. Office-action answers and reexamination requests share one domain set, because the reexamination reason table is the invalidation table plus the utility-model subject-matter defect and that defect lives in a common domain; invalidation carries no answer-practice domain and infringement only its own. `evaluateText`'s `domain` option takes one domain or a list.

## Configuration

Schemastery configuration.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `rulesDir` | string | packaged assets | Rule-asset root override, mirroring the packaged `assets/rules/` layout. |
| `gateToolNames` | string[] | delivery tools | Tool names whose results run through the output gate. |
| `gateCheckTypes` | string[] | `keyword_blocklist` | Check families the result gate keeps; an absence-based family is rejected with a warning. |
| `structuralGate` | object[] | `[]` | Artifact gate entries (`tool`, `textArgs`, `ruleIds`, optional `whenArgs`): a block-level hit on the artifact text denies the call before dispatch. |
| `deliveryGate` | object[] | `[]` | Delivery gate entries (`tool`, `requires`, optional `whenArgs`): a call whose prerequisite tools have not succeeded earlier in the same session is denied by a monotonic guard. |
| `approvalDisabled` | boolean | `false` | Block review-level violations without an approval round-trip. |

## Model Experience

None, as this plugin registers no tool schema, prompt section, or result projection; its EVI-011 guards and post-execute gate deny or block existing tool calls, and dsh-tools renders the denial and block feedback as ordinary error results.

#### KV Cache effect

Independent; the plugin appends nothing to the request prefix, so enabling or disabling it never invalidates KV-cache reuse.

## Known Limitations and Deferred Work

- **Asset location differs from Sati** — rules resolve from the packaged `assets/rules/` via `import.meta.url` (with an optional `rulesDir` override); the `SATI_RULES_DIR` environment variable, cwd/workspace-root walking, and the project `.sati/rules.yaml` auto-discovery are dropped. `loadRulePack` accepts only an explicit `manifestPath`.
- **Layered pack default is base only** — `loadRulePack` without a manifest loads only the packaged base pack; domain and override layers require an explicit manifest.
- **Rule-set loading is fail-soft** — a missing or damaged asset degrades to an empty rule set (the gate passes through) rather than failing the deployment.
- **Merged assets cover machine-checkable rules only** — upstream rules whose payload is prose (analysis principles, statutory conditions, decision citations) are not converted into checks and stay outside this package; the conversion set, the check-type mapping, and the boundary are recorded in [the merge-boundary note](../../../.agents/notes/implemented/architecture/2026-09-21-mady-rule-asset-merge-boundary.md).
- **Rules are narrowed by domain and premise, not by document type** — a job scope keeps only its domains and a rule's premise silences it on text that never touches its subject, but nothing classifies the document: a rule whose premise matches (an answer quoting the claim text, say) still reports its missing elements.
- **No shipped structural gate entry** — the artifact gate ships with no `structuralGate` entry because no production tool in this deployment takes the delivered document as one argument: `render_patent_document` takes template slot fragments, and the templates already carry the fixed wording, so absence checks on those fragments report defects the rendered document does not have. A deployment whose production tool takes the document text enables it there.
- **The delivery ledger does not survive a resume** — it is held in the plugin mount and keyed by the live agent object, so a session resumed in a fresh process starts with no record and re-runs the prerequisites even when an earlier run satisfied them. The failure direction is a repeated gate run, not a missing one.
- **A prerequisite counts on a successful call, not on a passing verdict** — the ledger records that a tool returned without error. A `rule_check` whose result reports violations, or a `patent_workflow_run` paused at its review gate, satisfies the gate; what the gate enforces is that the run happened in this session, and the delivery report carries the verdict for a human to read.
- **Guideline citations are free text** — `legalBasis` reaches output verbatim and no stage parses it, so a rule's 《专利审查指南》 section number is only as correct as the text it was transcribed from; `tests/guideline-citations.spec.ts` holds the numbering form the assets keep and the sections already checked against the 2023 revision, and the remaining citations are unverified.

### Dev Note

None.

No companion is published because the dsh-tools runtime’s own invariant companion enforces and audits the EVI-011 guards and the tools/post-execute output gate.
