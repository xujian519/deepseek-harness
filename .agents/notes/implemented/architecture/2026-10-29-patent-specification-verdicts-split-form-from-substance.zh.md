# Agent Note: 说明书检查把形式判定与实体结论分开

Status: implemented

[English](2026-10-29-patent-specification-verdicts-split-form-from-substance.md) | 中文

## 问题

`validate_specification` 已带不少确定性规则，但 `passed` 读起来像合规结论，实际只统计 `error`。只有 `【撰写指引】` 占位的草案以 0.9 分通过；正文引用 `如权利要求1所述` 或使用 `世界领先` 通过；附图说明缺图号通过；无附图发明却因 `缺少必要章节：附图说明` 失败。默认披露与可专利性工作流只把 `text`/`claims` 传给 `spec-check`，标题、摘要、专利类型、有无附图、附图分析都没进入门禁。`legal-gaps` 又把只覆盖形式的 `specification_check_passed` 当作 A26.3 充分公开通过。

## 决定

违规项新增必填 `family`（`structure`、`title`、`abstract`、`description`、`prohibitions`、`figures`、`claims`）。`validate_specification` 返回 `not_assessed` 列出确定性规则不能判断的事项，`passed` 只表示已运行的规则未发现 error。

`spec-check` 写出分项判定：`spec_form_check_passed`（全部形式族）、`spec_claims_check_passed`、`spec_figure_check_passed`、`spec_prohibitions_check_passed`，以及 `spec_not_assessed`。它从工作流状态读取 `title`、`abstract`、`patent_type`、`has_drawings`、`figure_analysis`、`drawing_count`、`abstract_figure_number`；`patent_workflow_run` 把这些输入连同 `background` 映射进状态。

`legal-gaps` 把 `spec-form` 映射到形式判定、`claim-support` 映射到权项判定。`enablement` 只读 `enablement_report`/`enablement_passed`，形式检查通过时 A26.3 仍为 `not-assessed`。`claim-support-breadth` 始终 `not-assessed`，且不进入反哺清单，因为补提事实解决不了概括范围。

必要章节按专利类型与有无附图计算：无附图发明四部分即可，实用新型必须有附图说明，写了附图说明却无图号报 error。发明名称 26–40 字为 warning，超过 40 字仍为 error。

## 同一版本的后续覆盖

P1 补上摘要检查（读请求书 `abstract_figure_number` 而不是正文）、附图说明覆盖（连续性、重复、正文引用、图名、图数）、`verify_patent_figure` 的交付前复核（`delivery_review`）、落版图号/页码校验，以及无附图交卷。交卷用同一份 spec，把两个附图节标为 `optional: true`：`build.py` 删除其分节边界，`verify.py` 按实际省略的可选节推导期望节数与页眉。无附图发明因此成文三节；实用新型仍由 `spec-check` 阻断。

T19 从撰写字段生成确定性摘要。T28 增加 sub_agent 附图分析阶段与确定性 `figure-analysis` 原子：sub_agent 阶段把文本写在阶段 id 下，本身满足不了 `validate_specification` 读取的数组形状，因此由原子收口。

P2 只加启发式 warning：背景技术引证要素、效果对比、序列表、正文图片/表格、术语与标记一致性、实用新型附图内容、摘要附图 40×60 毫米缩放字高。它们都不把 `passed` 变成实体结论；充分公开、支持广度、清晰度、比例与照片适用性仍为 `not_assessed`。

## 备选方案

**把所有 warning 当阻断项。** 法定形式缺陷与部署体例目前都用 warning 表达；全部阻断会让门禁靠例外清单绕过。

**用形式检查代表 A26.3。** 能否实现取决于所属领域技术人员能否实施，字符串规则无法证明；判为通过会在法条层面重复原来的假通过。

**继续要求固定五部分。** 《专利审查指南》第二部分第二章 2.3 允许发明无附图，固定要求会拒绝有效申请。

**从摘要正文推断摘要附图。** 摘要附图号在请求书中；从正文推断会产生误报。检查改为读取 `abstract_figure_number`，未提供时列为未评估。

## 测试

| 证据 | 行为 |
|---|---|
| `spec-p0-rules.spec.ts` | 每条新规则有命中、不命中、边界用例；宣传语词表与规则 `CON-COMP-0105` 逐项比对。 |
| `validate-specification.spec.ts`、`spec-check.spec.ts`、`legal-gaps.spec.ts` | 占位草案失败、四部分发明通过、实用新型无附图失败、无实体报告时充分公开保持未评估。 |
| `patent-workflow-run.spec.ts` | 披露工作流放行完整无图发明、阻断无图实用新型；`legal-gaps` 给出对应状态。 |
| `patent_oa_response` 快照 | 工具 schema 伴随文件包含新参数，回放一致。 |

## 影响

默认工作流现在阻断未完成或违法的草案，而不是交付。把 `specification_check_passed` 当作 A26.3 证据的消费者必须改用 `enablement_report`；升级指南记录了这项破坏。`图1A` 一类带字母后缀的图号、附图清晰度、比例一致性、照片适用性与名称中的人名地名保持 `not-assessed`；P2 的启发式只报告实测事实与 warning，不给出这些结论。
