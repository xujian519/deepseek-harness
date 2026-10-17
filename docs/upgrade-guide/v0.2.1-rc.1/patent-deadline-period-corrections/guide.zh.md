---
kind: upgrade-guide
description: "@deepseek-ai/dsh-patent-deadline 按专利类型修正外观设计期限、年费年度、类型门控与默认答复期限，并新增补偿年数、已缴年度、展望年限与时区输入。"
---

# 专利期限按类型修正

[English](guide.md) | 中文

## 变更

`patent_deadlines` 工具与 `evaluateDeadlines` 现在按专利类型推导期限。2021-06-01 前申请的外观设计期限为10年，该日及以后申请的为15年。年费止于专利权期限的最后一年（含已获准的 `termCompensationYears`），已过期专利不再报告不可能存在的年度。期限补偿仅适用于发明专利，优先权恢复与增加/改正仅适用于发明或实用新型，PCT 进入中国国家阶段不适用于外观设计；断言相反情形时查询直接失败，不再输出该项。

第一次审查意见的默认期限：发明专利实质审查为4个月，实用新型或外观设计初步审查为2个月。复审通知书答复默认1个月。无效宣告答复引用审查指南第四部分第三章第4.4.1节。

新增可选输入：`termCompensationYears`（发明专利，0—5）延长专利权期限及其年费年度；`paidThroughYear` 略过已记录缴费的年费。新增配置：`annuityHorizonYears`（默认2）与 `timeZone`（默认 `Asia/Shanghai`），后者取代宿主本地日期作为“当前日期”的来源。报告还会列出各项通知的送达规则，并写明专利权期限与优先权期限不适用恢复（细则第6条第5款）。

## 迁移

1. 对已缴费至某一已知年度的授权专利，把该年度作为 `paidThroughYear` 传入；否则报告会把展望范围内的年费列为逾期。

2. 已获准期限补偿时传入 `termCompensationYears`；不传时报告按法定期限封顶年费。

3. 更新实用新型或外观设计的预期：第一次审查意见为2个月，且不再出现期限补偿、优先权恢复与优先权增加/改正项。外观设计也不再出现 PCT 项，因此从外观设计查询中删除 `isPctNationalPhase: true`；实用新型可以保留。从外观设计或实用新型查询中删除 `marketingApprovalDate`；调用现在会失败。

4. 移除对宿主时区的假定。仅当部署必须以 `Asia/Shanghai` 以外的时区读取“当前日期”时才设置 `timeZone`。

5. 确认：`pnpm exec vitest run packages/patent/patent-deadline/tests` 通过，且实用新型案件在收到第一次审查意见后显示2个月期限。
