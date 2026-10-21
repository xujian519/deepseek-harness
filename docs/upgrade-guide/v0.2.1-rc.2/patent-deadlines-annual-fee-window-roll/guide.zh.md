---
kind: upgrade-guide
description: "patent_deadlines 的年费补缴窗口改自顺延后的应缴日起算，窗口终点同样顺延。"
---

# 年费补缴窗口按报告用届满日起算

[English](guide.md) | 中文

## 变更

`patent_deadlines` 过去把 `latePaymentWindow.from` 报为年费未顺延的应缴日，`to` 报为整六个月后，两端都不应用专利法实施细则第5条。现在窗口自该项报告用（已顺延）届满日起算，`from` 等于该项的 `dueDate`；`to` 为自该日起六个月后，并按同一口径顺延。新增可选的 `latePaymentWindow.calendarCaveat`：窗口终点所在年份未载入节假日安排时，指出该年份。应缴日无需顺延、且窗口终点年份已覆盖的年费，日期不变。

## 迁移

1. 把 `latePaymentWindow.from` 与 `.to` 当作最终日期读取；不要自行再加顺延，也不要用 `rawDueDate` 推算 `to`。
2. 处理窗口上可选的 `calendarCaveat`：出现时表示该年份的节假日安排缺失，`to` 未应用顺延。
3. 确认：2023-10-01 申请、2026-09-01 授权的案件，第4年度年费应缴日为 2026-10-08（自 2026-10-01 顺延），补缴窗口为 2026-10-08 至 2027-04-08，并带指明 2027 年的 `calendarCaveat`。
