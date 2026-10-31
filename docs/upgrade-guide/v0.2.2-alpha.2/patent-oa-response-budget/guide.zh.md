---
kind: upgrade-guide
description: "审查意见答复的 draft 阶段新增篇幅预算与删减要求，同一案件产出的答复稿正文明显变短。"
---

# 审查意见答复按篇幅预算成文

[English](guide.md) | 中文

## 变更

`patent_oa_response_v1` 的 `draft` 阶段指引原本只说明要写什么，现在同时给出写到多长、删掉什么：

- **篇幅预算**：正文总量 ≤ 4000 字（不含表格与权利要求全文）；总体立场 ≤ 200 字；本案事实 3.1／3.2 各 ≤ 5 项、每项 ≤ 2 句；适用规则 R 条 ≤ 6 条；5.1／5.2 各 ≤ 1200 字；5.3 ≤ 3 条；结论与请求 ≤ 150 字。
- **删减三禁令**：不复述上游产物（要素对照表、答复计划的逐理由策略、对立模型的弱点清单）；同一结论在总体立场、论证末句、结论与请求三处不换词重述；同一段原文只整段引用一次，其后以事实编号或「见前述引文」指代。
- **未提出的争点不设节**：审查意见未就新颖性提出异议时，写一句即可，对应槽位置空，由渲染器折叠（见 `patent-oa-optional-sections`）。

模型的既有调用序、阶段数与产物结构都没有变化，变的只有成文阶段的输出密度。

同一案件重跑产出的答复稿会明显变短。受影响的是拿新产出与历史答复稿逐字比对的人，以及把录制样张当作当前行为读数的人：`snapshots/session/patent-oa-response` 与 `patent-oa-chain` 里的答复文本仍是旧行为，回放不重跑模型，所以测试照旧通过，但样张不再代表当前产出。

## 迁移

1. 比对历史答复稿时，把篇幅下降视为预期；判断质量用 `response_check` 与 `legal_gaps` 的结论，不要用字数。
2. 预算数值是建议初值（尚未按本所实际答复稿的分布定标）。要按本所口径调整，改 `OA_RESPONSE_DRAFT_BUDGET`（`packages/patent/patent-workflow/src/workflow/manifests.ts`）：提示文字由该常量插值，改一处即生效。若 `packages/patent/patent-document` 另存了槽位配额，须与该表同步。
3. 个别案件确需更长论证（多理由并列、多独权）时，在案件材料里写明理由并临时抬高预算，不要依赖模型自行判断。
4. 重录含 draft 产出的样张，并运行 `pnpm exec vitest run packages/patent/patent-workflow/tests`，确认 `manifest-guidance` 的预算与禁令断言仍成立。
