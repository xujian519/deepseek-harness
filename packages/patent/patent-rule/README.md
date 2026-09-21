---
description: "Function plugin porting the Sati constitutional rule engine into the DeepSeek Harness: it ships the YAML rule packs as package assets, evaluates text deterministically, registers the EVI-011 evidence-compliance guards as monotonic denies, and wires the RuleOutputGate onto tools/post-execute with review routed through ctx.approval."
kind: "package-reference"
---

# @deepseek-ai/dsh-patent-rule

English | [中文](README.zh.md)

## Summary

Function plugin porting the Sati constitutional rule engine into the DeepSeek Harness: it ships the YAML rule packs as package assets, evaluates text deterministically, registers the EVI-011 evidence-compliance guards as monotonic denies, and wires the RuleOutputGate onto tools/post-execute with review routed through ctx.approval.

## Table of Contents

- [Output gate](#output-gate)
- [EVI-011 evidence guards](#evi-011-evidence-guards)
- [Rule engine (library API)](#rule-engine-library-api)
- [Rule assets](#rule-assets)
- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Output gate

On the result of each delivery tool named in `gateToolNames` (`render_patent_document`, `draft_claims`, `draft_specification`, `validate_specification` by default), the plugin runs the `keyword_blocklist` rule subset (`selectGateRules`) through the `RuleOutputGate`. A block-level violation returns a block decision. A review-level violation fires `ctx.get('approval')` and accepts only on `allowed-once`, failing closed when there is no answerer, no agent, or `approvalDisabled` is set. warn/log violations pass through unchanged. Non-matching tools delegate via `next()`.

The loaded gate is also exposed as `ctx.get('patentRuleGate')` (Context merge, optional — present only while this plugin is mounted), so team consumers such as patent-teams can rule-gate task completion consistently with the post-execute path.

## EVI-011 evidence guards

`evaluate_evidence` calls are denied by two monotonic guards when an overseas or foreign-language evidence record omits its required notarization, legalization, or translation declaration. The guard condition fields derive from the packaged `evidence-rules.yaml`, falling back to a hardcoded set when the asset is missing. Each guard returns a denial reason string, so no allow result can override it.

## Rule engine (library API)

The package re-exports the ported rule engine: `evaluateText`, `evaluateRule`, `groupByAction`, `parseRuleSetFromYaml`, `loadRuleSetFromFile`, `loadRuleSetDir`, `mergeRuleSets`, `applyRuleOverrides`, `loadPatentComplianceRuleSet`, `loadPatentElectricalRuleSet`, `loadPatentFullRuleSet`, `loadActivationOverrides`, `selectGateRules`, `PATENT_CASE_DOMAINS`, `patentCaseDomains`, `loadRulePack`, `loadSynonymsAsset`, `RuleOutputGate`.

## Rule assets

Three families live under `assets/rules/patent/`, distinguished by who owns them and how they load.

| Family | Files | Loaded as |
| --- | --- | --- |
| Hand-written compliance | `compliance.yaml`, `electrical-section-h.yaml` | One fixed file name each, by `loadPatentComplianceRuleSet` / `loadPatentElectricalRuleSet` |
| Generated upstream mirrors | `nuo-*.yaml` | By `loadPatentFullRuleSet`, through the explicit `NUO_RULE_FILES` list |
| Hand-merged current-law and gap rules | `current-law.yaml`, `mady-gap-rules.yaml` | By `loadPatentFullRuleSet`, through the explicit `MERGED_RULE_FILES` list |

`current-law.yaml` bans superseded statute wording in output text: the two-year infringement limitation, the replaced judicial interpretation as the equivalence basis, and attributing utility-model subject matter to the second paragraph of Article 2. Its checks are `pattern_analysis`, so they never reach the output gate. `mady-gap-rules.yaml` holds upstream rules converted to the engine's five check types — bans whose keywords are literal, and completeness checks whose element terms are literal — with every upstream `block` reviewed down to `warn` (`log` for the upstream `info` level). Two of its bans are `keyword_blocklist`, so the output gate picks them up alongside the mirror rules. `activation-overrides.yaml` applies to the merged result, so a review conclusion can target either family.

### Job scopes

`PATENT_CASE_DOMAINS` maps the four job scopes — `patent-oa-response`, `patent-invalidation`, `patent-reexamination`, `patent-infringement`, named after the four job manifests and exposed through the `rule_check` tool — to the rule `domain` lists each one evaluates. A scope evaluates the common domains (`patent`, `patent_general`) plus its own document and procedure domains and the domains of the clauses it must answer or establish. The union of the four covers every domain in the merged set, so no asset domain lacks a job entry point. Office-action answers and reexamination requests share one domain set, because the reexamination reason table is the invalidation table plus the utility-model subject-matter defect and that defect lives in a common domain; invalidation carries no answer-practice domain and infringement only its own. `evaluateText`'s `domain` option takes one domain or a list.

## Configuration

Schemastery configuration.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `rulesDir` | string | packaged assets | Rule-asset root override, mirroring the packaged `assets/rules/` layout. |
| `gateToolNames` | string[] | delivery tools | Tool names whose results run through the output gate. |
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
- **Job scopes filter by domain, not by document type** — the completeness checks in those domains (`structural_analysis`) report missing expected elements on any text, so a scope run over a document of another type still returns those hits; the scope narrows the rule set, it does not classify the text.

### Dev Note

None.

No companion is published because the dsh-tools runtime’s own invariant companion enforces and audits the EVI-011 guards and the tools/post-execute output gate.
