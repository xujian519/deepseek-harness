---
kind: upgrade-guide
description: "amendment-basis 不再忽略单字新增；插入一个“不”反转限定方向时该检查不再通过。"
---

# 修改依据检查报出单字新增

[English](guide.md) | 中文

## 变更

`AmendmentBasisHandler`（`amendment-basis` 原子）现在会报出单字新增片段：该字连同相邻上下文未记载于原申请文件时，列为疑似超范围项。此前剥离虚词后短于两个字符的片段一律忽略，因此在 `设置有散热孔` 前插入 `不` 也能通过检查，尽管它反转了限定方向。

单字新增连同相邻文字在原申请文件中出现过时仍然通过，例如 `散热孔` → `散热孔组` 且原说明书含 `散热孔组`，不会被误报。仅由虚词构成的片段继续忽略。

## 迁移

1. 对修改后权项与原权项仅差一个字符的答复重新运行 amendment-basis 阶段。变更前保存的结果可能显示 `amendment_basis_passed: true`，而现在会报出违规。
2. 新增违规按复核项处理，不是自动驳回：报告列出片段，并保留“字符级对照不能判定是否可直接、毫无疑义地确定”的固定说明。
3. 确认：`pnpm exec vitest run packages/patent/patent-core` 通过，且在肯定性限定前插入 `不` 的修改稿返回 `amendment_basis_passed: false`、`addedSpan: 不`。
