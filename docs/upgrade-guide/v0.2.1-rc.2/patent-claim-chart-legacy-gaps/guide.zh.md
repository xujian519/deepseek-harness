---
kind: upgrade-guide
description: "`loadClaimChart` 对缺少 `gaps` 字段的旧图表 JSON 现在返回 `gaps: []`。"
---

# 旧权利要求图表加载时补空缺口列表

[English](guide.md) | 中文

## 变更

`@deepseek-ai/dsh-patent-core` 的 `loadClaimChart` 在已保存的 `claim-chart-*.json` 缺少 `gaps` 字段时，现在写入 `gaps: []`。此前它原样返回解析对象，导致 `chart.gaps` 为 `undefined`，而 `ClaimChart` 类型声明该字段必需。旧文件 `gaps[].mapping` 迁移为 `kind` 的逻辑保持不变。读取旧文件的调用方现在总能拿到数组，可直接遍历。

## 迁移

1. 删除 `chart.gaps === undefined` 的防御分支，或保留；通过 `loadClaimChart` 加载的文件不会再触发该分支。
2. 如果必须区分“没有记录缺口”与“旧文件缺少字段”，请在写入时记录该事实；加载器会把两者都归一为 `[]`。
3. 确认：写入一份含 `rows` 与 `elements`、但没有 `gaps` 的图表 JSON，调用 `loadClaimChart(caseId, chartId)`，观察到 `gaps` 为 `[]`。
