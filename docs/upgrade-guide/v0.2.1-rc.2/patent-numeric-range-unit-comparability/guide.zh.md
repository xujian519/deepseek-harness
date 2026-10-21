---
kind: upgrade-guide
description: "专利数值范围核验读取带符号数值与后缀单边表述、换算同量纲单位，并在单位不可比时返回 inconclusive 而不是 no_overlap。"
---

# 数值范围核验支持单位换算，单位不可比时失败关闭

[English](guide.md) | 中文

## 变更

`analyzeNumericRanges` 与 `numeric-range` 原子的数值读取与判定发生变化：

- 符号并入数值 token：`-5至-10℃` 读作 −10…−5 区间，而不再是正的 5…10；Unicode 减号 `−` 与全角减号 `－` 也按负号处理。
- 后缀单边表述（`70℃以上`、`80%以下`、`-5℃及以上`）与既有的方向词写法（`不低于`）一样成为单边发现。
- 同量纲单位先换算到基单位再比较：`5-10mg` 对 `0.005-0.01g` 现在判为 `overlapped`，而不再是 `no_overlap`；`1-2h` 对 `60-90min` 按秒比较。温度只按摄氏刻度比较，不做 °C/°F 偏置换算。换算后的端点相对误差在 1e-9 内视为共同端点，换算溢出为无穷大则不算。
- 表外单位仅在两侧写法完全相同时可比（`cps` 对 `cps`）。量纲不同（`mm` 对 `℃`）与表外单位写法不同（`cps` 对 `cp`）会记录到新增的 `incomparablePairs` 字段并给出 `reason`（`dimension-mismatch` 或 `unknown-unit`）；只要存在不可比对，结论就降为 `inconclusive`，已有破坏性重叠时除外。报告与 `summary` 会带上新增的 `reason` 文本。
- `NumericRangeAnalysis` 新增 `incomparablePairs` 与 `reason` 字段，均为新增项；结论枚举不变。

## 迁移

1. 将 `numeric-range` 返回的 `inconclusive` 理解为"单位无法比较"，而不是"没有重叠证据"：读取 `reason` / `incomparablePairs`，先把对比文件单位规范化后再依赖结论。
2. 数值请使用共享词表（`src/novelty/numeric-vocabulary.ts`）内的单位，或在两侧写成完全相同的单位。华氏度等带偏置的温标需在核验前换算为摄氏度；本模块不做偏置换算。
3. 重新建立包含跨单位比较 `no_overlap` 结论的录制报告基线：这些用例现在会给出 `overlapped` 或带不可比说明的 `inconclusive`。
4. 确认：`pnpm exec vitest run packages/patent/patent-core packages/patent/patent-tools` 通过，且合法输入的工作流运行输出中没有 `[WORKFLOW_DEGRADED]`。
