---
kind: upgrade-guide
description: "The patent rule plugin now fails to load when its base compliance.yaml asset is missing or unreadable."
---

# Patent rule base asset fails closed

English | [中文](guide.zh.md)

## Change

A missing or unreadable base `compliance.yaml` previously produced an empty rule set, logged a warning, and let the output gate pass every result. `loadPatentComplianceRuleSet`, `loadPatentElectricalRuleSet`, and `loadPatentFullRuleSet` now throw `PatentRuleAssetError`, so mounting `@deepseek-ai/dsh-patent-rule` with a bad `rulesDir` fails at load instead of silently disabling the gate. A single missing or damaged follow-on pack file still warns and is skipped.

## Migration

1. Ensure `Config.rulesDir` (or the packaged `assets/rules/patent/` directory when the override is unset) contains a readable `compliance.yaml`.
2. If a deployment intentionally runs without the patent rule assets, remove the plugin from the composition instead of pointing `rulesDir` at an incomplete directory.
3. Confirm: the plugin mounts, `loadPatentFullRuleSet()` returns a non-empty rule set, and a mount with `/nonexistent/rules-root` fails with `PatentRuleAssetError`.
