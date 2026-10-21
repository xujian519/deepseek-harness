---
kind: upgrade-guide
description: "patent_deadlines 的 PCT 申请费按30个月进入期限计算，优先权要求费自 nationalPhaseEntryDate 起算。"
---

# PCT 进入阶段费用按各自期限计算

[English](guide.md) | 中文

## 变更

对于 `isPctNationalPhase: true` 的案件，`patent_deadlines` 过去从国际申请日起算申请费期限。现在按专利法实施细则第121条把申请费、公布印刷费及必要的申请附加费作为进入中国国家阶段的手续费用：应在自优先权日起30个月的进入期限内缴纳（缴纳宽限费后可延至32个月，专利法实施细则第120条）。自 `nationalPhaseEntryDate` 起算的2个月期限属于专利法实施细则第127条的优先权要求费；该项以 `priority-claim-fee` 返回，进入日未知时保持 pending。国内案件行为不变。

## 迁移

1. PCT 案件的 `application-fee` 从 `computed` 读取；它报告30个月进入期限，`legalBasis` 为 `专利法实施细则第121条、第120条`，不再依赖进入日。
2. 主张优先权的 PCT 案件应提供 `nationalPhaseEntryDate`（进入日），以便计算2个月的 `priority-claim-fee`；未提供时该项进入 `pending`。
3. 确认：2024-01-01 国际申请、未主张优先权的 PCT 案件，`application-fee` 到期日为 2026-07-01；优先权日为 2023-01-01 且 `nationalPhaseEntryDate: "2025-07-01"` 时，`application-fee` 到期日为 2025-07-01，`priority-claim-fee` 到期日为 2025-09-01，`legalBasis` 为 `专利法实施细则第127条`。
