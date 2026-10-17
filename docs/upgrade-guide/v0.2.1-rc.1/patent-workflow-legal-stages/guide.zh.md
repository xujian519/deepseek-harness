---
kind: upgrade-guide
description: "新颖性与披露工作流现在要求显式提供申请日或优先权日以确定现有技术截止日，多个专利工作流新增确定性合规阶段，此前可完成的工作流现在可能报告阶段降级。"
---

# 专利工作流新增法律基准、证据与引用阶段

[English](guide.md) | 中文

## 变更

八个内置专利工作流现在会执行额外的确定性原子阶段：

- `patent_novelty_v1` 在 `parse` 之后执行 `time_baseline`，在 `search` 之后执行 `conflicting_application`，在 `compare` 之后执行 `numeric_range`，最后在 `conclude` 之后执行 `legal_gaps`。现有技术截止日取申请日与优先权日中较早者。`patent_workflow_run` 新增可选输入 `filingDate`、`priorityDate` 与 `conflictingApplications`。缺少日期时基准阶段降级，而不再跳过法律基准。
- `patent_disclosure_v1` 在 `preprocess` 之后执行 `eligibility`，在 `search` 之前执行 `time_baseline`，在 `search` 之后执行 `prior_art_filter`，在 `novelty` 之后执行 `citation_check`，在 `draft_claims` 之后执行 `spec_check`，最后在 `slop_clean` 之后执行 `legal_gaps`。
- `patent_patentability_v1` 在 `parse` 之后执行 `eligibility`，在 `draft` 之后执行 `spec_check`，随后执行 `legal_gaps`。
- `patent_inventiveness_v1` 在 `diff` 之后执行 `problem_check`，最后在 `conclude` 之后执行 `legal_gaps`。
- `patent_oa_response_v1` 在 `draft` 之后执行 `response_check`，在 `response_check` 之后执行 `amendment_basis`，随后执行 `legal_gaps`。
- `patent_invalidation_v1` 与 `patent_reexamination_v1` 在 `inventiveness` 之后执行 `evidence_check`，随后执行 `citation_check`，最后执行 `legal_gaps`。
- `patent_infringement_v1` 在 `report` 之后执行 `legal_gaps`。

`prior-art-filter` 排除公开日不早于截止日的检索结果，并排除申请日前六个月内属于 A24 宽限期的首次公开；条目以 `a24Exception`（`A24.1`–`A24.4`）标注情形。检索结果现在携带 `publicationDate`。`conflicting-application` 适用 A22.2 第二句：候选在目标申请日以前提出、在申请日以后（含申请日）公布，且属于同样的发明或者实用新型时构成抵触申请；同样性由调用方通过 `sameInvention` 显式给出。抵触申请只破坏新颖性。`citation-check` 报告未接地的引用（`D1`、`D2`、专利号）；`spec-check` 报告特征未得到文本支持的权利要求（A26.4）。`numeric-range` 标记范围重叠或共同端点；没有可比对文本时报告 `inconclusive`，不将阶段标为降级。`problem-check` 拒绝把技术问题写成区别特征自身、包含解决手段或捆绑多个成因的表述。`response-check` 执行答复规则 PR-OA-007/008/009：26.3 答复须落到本领域技术人员、能否实现与说明书记载三要素；通知书提出的每条驳回理由须在答复中出现；引用了通知书未提出的驳回条款会被点名。缺少通知书时，依赖通知书的规则显式列为未评估。`amendment-basis` 从答复正文提取修改后权利要求，逐项核对新增片段是否记载于原说明书或原权利要求书（A33）；没有修改后权利要求段时视为未修改，A33 不适用。`legal-gaps` 汇总上述检查对应的法条覆盖情况。`evidence-check` 拒绝无正当理由的逾期证据，并报告形式缺陷、不早于截止日的公开日以及未关联的证据。`eligibility` 筛查 A2/A5/A25 客体：纯智力活动规则、疾病诊断/治疗方法、动植物品种与原子核变换；含技术特征时不按 A25 排除。

通过 `patent_workflow_run` 运行、读取阶段列表，或用 `patent_workflow` 走 recap 路径的调用方，都会观察到新增阶段与新的完成条件。运行结果新增 `evidenceLedger`；只要运行消费了证据来源，就会追加一条 `patent/evidence-ledger` 事件，按来源逐项给出收据；`patent_workflow_run` 现在也会写入 `patent/workflow-run` 与 `patent/legal-gaps` 事件。

## 迁移

1. 新颖性与披露运行传入已有日期：`filingDate`（`2024-06-01`、`2024/06/01` 或 `2024年6月1日`），有优先权时再传 `priorityDate`。不可解析的日期会以 `invalid_tool_input` 拒绝。

2. 通过 `patent_workflow` 走 recap 时，在既有阶段产出旁补上 `time_baseline`、`prior_art_filter` 与 `conflicting_application` 产出。recap 不执行原子，缺少产出会把该阶段标为降级。

3. 提供现有技术条目时，补充 `publicationDate`（`yyyy-MM-dd`）；仅当属于 A24 首次公开时才补充 `a24Exception`。没有公开日的条目会保留并报告为待核实。

4. 新颖性运行通过 `conflictingApplications` 传入在先申请、在后公布的候选。每个条目需提供 `filingDate`、`publicationDate`、可选 `priorityDate`，以及调用方判定的 `sameInvention` 布尔值（例如 `[{"filingDate":"2023-01-01","publicationDate":"2024-07-01","sameInvention":true}]`）。未提供 `sameInvention` 时条目报告为待定，不计为抵触申请。完全不传该输入会报告“未提供候选；不等同于已排除抵触申请”。外国申请不适用 A22.2 第二句。

5. 复核新增的阶段产出。校验未通过时结果写在阶段产出中，不会中断工作流。

6. 无效宣告与复审运行通过 `evidence` 与 `evidenceDeadline` 传入证据清单与举证期限；没有 `lateJustification` 的逾期条目会阻断。

7. 新颖性权利要求含数值范围时，通过 `priorArt` 传入 JSON 数组作为可比对文本；否则 `numeric_range` 报告 `inconclusive`。

8. 确认每个工作流现在都以 `legal_gaps` 结束；`not-assessed` 表示该法条尚未被任何确定性阶段覆盖。

9. 从运行结果或 `patent/evidence-ledger` 事件读取 `evidenceLedger`；未消费任何来源时既没有该字段，也没有该事件。
