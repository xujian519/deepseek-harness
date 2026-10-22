---
kind: upgrade-guide
description: "`citation_analysis` 规则资产不再接受 `topics` 字段：`CitationAnalysisCheck` 已移除该字段，仍声明它的规则在加载期被拒绝，而不是带告警加载。"
---

# `citation_analysis` 规则拒绝已移除的 `topics` 字段

[English](guide.md) | 中文

## 变更

`CitationAnalysisCheck.statutes` 原先的类型是 `{ max, topics? }`。`topics` 只被解析进规则，没有任何检查读取它：`citation_analysis` 只报告超出 `max` 的条号，加载器另写一条「该字段不影响判定」的告警。

`topics` 已移除。`statutes` 现在是 `Record<string, { max: number }>`；规则资产若仍在法条下声明 `topics`，该条规则不会加载：加载器对该规则报 `法条 "<name>" 的 topics 不受支持（没有主题相关性判定），删除该字段后该规则才会加载` 并跳过它，与其他非法字段的处理一致。没有可开启的主题相关性判定。

随包规则资产从未声明 `topics`，因此内置规则集加载结果不变。受影响的是把 `rulesDir` 指向自建资产的部署：带 `topics` 的规则会从规则集里消失（连同它的 `max` 范围核验），仓库外读取 `statutes[name].topics` 的 TypeScript 消费方将无法通过编译。

## 迁移

1. 删除自建规则资产中 `citation_analysis` → `statutes:` 下所有 `topics:` 块，法条条目只保留 `max`：
   ```yaml
   statutes:
     专利法:
       max: 82
   ```
2. 确认：加载一遍规则集（`rule_check`，或脚本里的 `loadRuleSetFromFile`），确认 `的 topics 不受支持` 告警不再出现，且该规则 id 出现在已加载的规则集里。若主题词表曾驱动你自己的后处理，把它留在规则资产之外；没有任何检查消费它。
