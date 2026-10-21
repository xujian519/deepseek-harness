---
kind: upgrade-guide
description: "全面覆盖改为逐权利要求判定、整体结论取覆盖最佳的权项；空要素表返回 `undetermined` 而非 `not-covered`；coverage 原子要求图表要素带 `claimNo`。"
---

# 全面覆盖改为逐权利要求判定

[English](guide.md) | 中文

## 变更

`@deepseek-ai/dsh-patent-core` 的 `deriveAllElementsCoverage` 改为按每条权利要求各自的要素判定，不再把图表中的全部要素混在一起比对。落入任一权利要求的保护范围即侵害该专利，因此整体 `outcome` 取覆盖最佳的权项（排序 `literal` > `construction-dependent` > `equivalence-required` > `not-covered`，同级取权项号最小者）；所选权项在 `claimNo` 给出，`claims` 携带每条权利要求各自的结论与要素分项。顶层要素列表与所选权项一致。

空要素表不再报 `not-covered`：结论为 `undetermined`，要素列表为空，因为没有可判定的要素。对 `undetermined` 的结论，`scoreInfringement` 抛出 `RangeError`，不再按覆盖度为零打分。

`coverage` 原子现在要求 `claim_chart_doc` 的每个要素带正整数 `claimNo`，缺失或非法时按下标降级说明原因。图表含多条权利要求时，`claim_chart_build` 工具逐权项渲染结论。

## 迁移

1. 图表混合多条权利要求的要素时，按逐权项结果读取：需要每条权利要求的结论读 `claims`，需要知道整体结论出自哪条权利要求读 `claimNo`。
2. 不再把空 `elements` 数组当作"不落入保护范围"。按 `outcome === 'undetermined'` 分支处理，并在评分前补齐要素；`scoreInfringement` 对该输入现在会抛错。
3. 为 `coverage` 原子读取的每个 `claim_chart_doc` 要素补上 `claimNo`（正整数）。本包写出的图表已携带该字段。
4. 确认：`pnpm exec vitest run packages/patent/patent-core packages/patent/patent-tools` 通过，且多权项图表的侵权运行逐权项输出结论。
