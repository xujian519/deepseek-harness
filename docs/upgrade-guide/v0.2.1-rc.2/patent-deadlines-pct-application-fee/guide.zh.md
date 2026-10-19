---
kind: upgrade-guide
description: "patent_deadlines 的 PCT 申请费改为自 nationalPhaseEntryDate 起算；缺少该日期时保持 pending。"
---

# PCT 申请费自进入国家阶段之日起算

[English](guide.md) | 中文

## 变更

对于 `isPctNationalPhase: true` 的案件，`patent_deadlines` 过去从国际申请日起算申请费期限。2024 年国际申请的案件因此会在 2024 年就报申请费逾期，而进入中国国家阶段的期限实际到 2026 年。现在按专利法实施细则第120条从新增的 `nationalPhaseEntryDate` 起算。PCT 案件未给该日期时，`application-fee` 条目进入 `pending`，`requiredInput` 为 `nationalPhaseEntryDate（进入中国国家阶段之日）`，不再借用其他日期计算。国内案件行为不变。

## 迁移

1. 在 `patent_deadlines` 调用中为每个 PCT 案件提供 `nationalPhaseEntryDate`（进入日）。
2. 从 `computed` 读取 `application-fee`；若它出现在 `pending`，先记录进入日再重跑，不要改用国际申请日。
3. 确认：2024-01-01 国际申请、`nationalPhaseEntryDate: "2025-07-01"` 的 PCT 案件，申请费到期日为 2025-09-01，`legalBasis` 为 `专利法实施细则第120条`；同一案件不给该日期时，`application-fee` 出现在 `pending`。
