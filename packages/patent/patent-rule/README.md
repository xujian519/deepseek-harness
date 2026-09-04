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
- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Output gate

On the result of each delivery tool named in `gateToolNames` (`render_patent_document`, `draft_claims`, `draft_specification`, `validate_specification` by default), the plugin runs the `keyword_blocklist` rule subset (`selectGateRules`) through the `RuleOutputGate`. A block-level violation returns a block decision. A review-level violation fires `ctx.get('approval')` and accepts only on `allowed-once`, failing closed when there is no answerer, no agent, or `approvalDisabled` is set. warn/log violations pass through unchanged. Non-matching tools delegate via `next()`.

The loaded gate is also exposed as `ctx.get('patentRuleGate')` (Context merge, optional — present only while this plugin is mounted), so team consumers such as patent-teams can rule-gate task completion consistently with the post-execute path.

## EVI-011 evidence guards

`evaluate_evidence` calls are denied by two monotonic guards when an overseas or foreign-language evidence record omits its required notarization, legalization, or translation declaration. The guard condition fields derive from the packaged `evidence-rules.yaml`, falling back to a hardcoded set when the asset is missing. Each guard returns a denial reason string, so no allow result can override it.

## Rule engine (library API)

The package re-exports the ported rule engine: `evaluateText`, `evaluateRule`, `groupByAction`, `parseRuleSetFromYaml`, `loadRuleSetFromFile`, `loadRuleSetDir`, `mergeRuleSets`, `applyRuleOverrides`, `loadPatentComplianceRuleSet`, `loadPatentElectricalRuleSet`, `loadPatentFullRuleSet`, `loadActivationOverrides`, `selectGateRules`, `loadRulePack`, `loadSynonymsAsset`, `RuleOutputGate`.

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

### Dev Note

None.

No companion is published because the dsh-tools runtime’s own invariant companion enforces and audits the EVI-011 guards and the tools/post-execute output gate.
