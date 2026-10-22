---
kind: upgrade-guide
description: "prior-art-filter 以最早优先权日计算 A24 宽限期，要求公开来源与情形匹配，无法判定时如实报告而不回退到申请日。"
---

# A24 宽限期改用优先权日与公开来源

[English](guide.md) | 中文

## 变更

`@deepseek-ai/dsh-patent-core` 的 `prior-art-filter` 在主张优先权时改用 `state.priority_date` 确定 A24 宽限期：

- 基准取最早的有效优先权日；优先权日可以是单个日期字符串或日期字符串数组。只有未主张优先权时才以申请日为基准。
- 优先权日仅精确到月或无法解析时，基准标为未判定。阶段不再回退到申请日，避免宽限期被悄悄平移或放宽。
- 每条标注 A24 的条目必须带 `a24DisclosureSource`：A24.1–A24.3 为 `applicant` 或 `derived-from-applicant`，A24.4 为 `unauthorized-disclosure`。来源缺失、为 `unknown` 或与情形不匹配时不认定宽限期；来源值无法识别时阶段降级。
- 无法判定的标注不再按宽限期排除，条目保留在 `prior_art` 并在报告中列明。
- `a24_grace` 输出解析出的基准或无法判定的原因；`prior_art_grace` 为每条 A24 标注给出判定结果。因宽限期排除的条目同时带 `disclosureSource`。
- Stage params `priority_date_key` 与 `a24_disclosure_source_key` 可指定替代的状态键与条目字段名。

## 迁移

1. 将 `priority_date` 提供为完整日期（`yyyy-MM-dd` 或其他可解析格式）；多项优先权使用日期数组。移除仅精确到月的优先权日。
2. 为每条带 `a24Exception` 的现有技术条目补充 `a24DisclosureSource`；公开来源未知且不希望评估该主张时，去掉 `a24Exception`。
3. 下游逻辑需要基准或逐条判定结果时，读取 `a24_grace` 与 `prior_art_grace`；报告文本不再唯一承载这些信息。
4. 确认：`pnpm exec vitest run packages/patent/patent-core` 通过，且带优先权日的 A24 条目要么被排除，要么报告为未判定，不会被静默当作现有技术或宽限期豁免。
