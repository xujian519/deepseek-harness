---
kind: upgrade-guide
description: "patent_fees 在点名索引未收录的收费阶段时扣留合计，并在 total.uncoveredTriggers 中列出该阶段。"
---

# 未收录的收费阶段扣留合计

[English](guide.md) | 中文

## 变更

当点名的阶段在索引中没有条目时，`patent_fees` 过去返回空行列表与 `total: {amount: "0.00", complete: true}`，让未收录阶段看起来像免费。现在该阶段会列在 `total.uncoveredTriggers`，`total.complete` 为 false，且不给金额。随包索引没有 `grant-registration` 条目，因此点名该阶段的查询会扣留合计，不再报零。全部阶段都已收录时，合计行为不变。

## 迁移

1. 把缺失的费项补进费用索引，并填写 `sourceDoc` 与 `verifiedOn`；或停止在 `triggers` 中点名该阶段。
2. 读取 `total.uncoveredTriggers`，把缺失阶段报为未知；不要引用工具拒绝给出的合计。
3. 确认：`triggers: ["grant-registration"]` 返回 `complete: false`、`uncoveredTriggers: ["grant-registration"]` 且无 `amount`；`triggers: ["filing"]` 仍能合计其已核验费用。
