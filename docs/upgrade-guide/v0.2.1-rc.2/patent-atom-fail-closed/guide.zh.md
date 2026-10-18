---
kind: upgrade-guide
description: "专利原子在月级日期、复合证据、畸形 JSON、非法 chart mode、非字符串 LLM 数组与非法调参上改为降级，不再猜测或抛错。"
---

# 专利原子输入改为失败关闭

[English](guide.md) | 中文

## 变更

`@deepseek-ai/dsh-patent-core` 的原子在输入含糊或畸形时改为降级，不再猜测。受影响的行为：

- `time-baseline`、`prior-art-filter`、`evidence-check` 与 `conflicting-application` 拒绝仅精确到月的申请日、优先权日与截止日；月级公开日仍按月末推定。
- `evidence-check` 会运行每一项命中的证据形式。复合证据（现有技术 + 外文 + 域外）同时检查中文译本、公证与认证，原先按单一标签通过的条目现在可能报告违规。
- `claim-chart`、`response-plan` 与 `coverage` 对畸形的 `office_action`、`claim_chart_doc` 或 `chart_targets` 条目（null、缺 `id`、非法 `kind` 或 `mapping`）降级并给出下标；非法 `chart_mode` 不再回退为 `invalidity`。
- `extract`、`keywords`、`draft-claims`、`compare` 与 `novelty` 在 LLM 数组含非字符串或非对象项时降级。带 `output_key` 的 `extract` 现在只要求并返回该键。
- Stage params 会校验：`temperature` 为 0-2，`max_retries` 为 0-10 的整数，`prompt_char_limit` 为正整数，`groundedness_threshold` 为 0-1。非法值降级。

## 迁移

1. 将申请日、优先权日与截止日规范为 `yyyy-MM-dd`；公开日可以保留具体日期或月级写法。
2. 对复合证据显式填写 `translated`、`notarized`、`legalized`、`notarizedExempt`、`legalizedExempt` 与 `witnessDisclosed`。缺失布尔值会成为待核项，`false` 会成为违规。
3. 在阶段执行前校验生成的 `office_action`、`claim_chart_doc` 与 `chart_targets`。每个目标需要非空 `id` 与 `kind`：`prior-art`，或被控产品使用 `product` / `accused-product`。`claim_chart_doc` 的每一行需要以下 `mapping` 之一：`literal`、`literal-construction-dependent`、`doe`、`anticipation`、`obviousness-combination`、`partial`、`not-found`、`needs-evidence`、`construction-dependent`。
4. 将 `chart_mode` 设为 `infringement`、`invalidity`、`oa-response`、`reexamination` 或 `patentability`。从 stage params 中移除越界的调参值。
5. 要求模型输出字符串数组，或包含必需 `feature` / `disclosed` 字段的记录。
6. 确认：`pnpm exec vitest run packages/patent/patent-core` 通过，且合法输入的工作流运行输出中没有 `[WORKFLOW_DEGRADED]`。
