---
kind: upgrade-guide
description: "patent_fees 不再对外观设计计收权利要求/说明书附加费，且零数量的费项不再扣留合计。"
---

# 附加费按专利类型适用，零数量不扣留合计

[English](guide.md) | 中文

## 变更

随包费用索引把权利要求附加费与说明书附加费声明为 `patentTypes: null`，于是 `claims: 15` 的外观设计案件被计收 750 元“权利要求附加费”，而外观设计没有权利要求书和说明书页数。现在两项仅适用于 `invention` 与 `utility-model`，外观设计报告会在类型过滤说明中列出它们。另外，`total.complete` 过去把数量为 0、且没有转录单价的费项（例如 20 页时的说明书附加费）判为不完整并扣留合计；数量为 0 的费项不再影响合计。附加费数量大于 0 的案件合计不变。

## 迁移

1. 重跑受影响的外观设计案件；权利要求与说明书附加费行消失，合计只含适用费项。
2. 重跑小页数申请（权利要求 ≤ 10 项、说明书 ≤ 30 页）；说明书附加费仍以 `quantity: 0` 出现，但不再扣留 `total.amount` 与 `total.complete`。
3. 确认：`patentType: "design", claims: 15, specificationPages: 40, triggers: ["filing"]` 只返回外观设计申请费；`claims: 5, specificationPages: 20, triggers: ["filing"]` 返回 `complete: true` 与已核验合计。
