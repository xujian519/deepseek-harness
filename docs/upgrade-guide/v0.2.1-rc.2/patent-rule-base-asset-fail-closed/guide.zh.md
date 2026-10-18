---
kind: upgrade-guide
description: "专利规则插件在基础 compliance.yaml 资产缺失或不可读时改为加载失败。"
---

# 专利规则基础资产改为失败关闭

[English](guide.md) | 中文

## 变更

基础 `compliance.yaml` 缺失或不可读时，过去会得到空规则集、记录一条告警，并让输出门禁放行所有结果。现在 `loadPatentComplianceRuleSet`、`loadPatentElectricalRuleSet` 与 `loadPatentFullRuleSet` 会抛 `PatentRuleAssetError`；用错误的 `rulesDir` 挂载 `@deepseek-ai/dsh-patent-rule` 会在加载期失败，不再静默关闭门禁。单个后续包文件缺失或损坏仍只告警并跳过。

## 迁移

1. 确认 `Config.rulesDir`（未覆盖时为随包 `assets/rules/patent/` 目录）中存在可读的 `compliance.yaml`。
2. 若部署确实不运行专利规则资产，请从组合中移除该插件，不要把 `rulesDir` 指向不完整目录。
3. 确认：插件可挂载，`loadPatentFullRuleSet()` 返回非空规则集；用 `/nonexistent/rules-root` 挂载会以 `PatentRuleAssetError` 失败。
