---
kind: upgrade-guide
description: "审查意见答复的渲染告警新增两类：修改对照表没有对应全文、三张表的数据体为空或只剩占位符。"
---

# 审查意见答复核对「双份」的两次呈现

[English](guide.md) | 中文

## 变更

渲染审查意见答复（`template: 'oa-response'`）时，渲染结果的 `warnings` 新增两类条目，都由 `checkDocumentCompliance` 产出，都不改动渲染出的 HTML。

`amendment-cross-reference` 守的是所内保留两份的那一处：修改对照表（表 1）与修改后独立权利要求全文（2.1）。它有两个报告方向：

- 表里至少登记了一项修改，本章却没有 `claim-text` 全文块——只写「参见修改对照表」而没有给出修改后的文本；
- 全文块写明的权项号，表里从未登记。

反向不报：从属权项的修改只出现在对照表里是合规体例，全文只对独立权利要求作强制要求。

`empty-table` 报的是没有任何数据行、或数据行整行只有模板占位符（`________`）的表格。按表体 id 限定在三张答复用表上：`amendment-table`、`evidence-table`、`citation-table`；其余模板的表格不查。

背后是一条新口径：两对载体——修改对照表与修改后全文、证据清单与引用日志——继续分两份，不合并。它们是同一事实的两种视图，不是重复，因此没有合并、也不会合并。理由与配套的判定写在 `oa-response` 模板的 `references/conventions.md` §11；新增的用例（`oa-double-carrier.spec.ts`）在任一侧从口径、自查清单、两个 SKILL 文件或模板里被删掉时失败。

把「`warnings` 非空」当作渲染失败的管线受影响；按旧的告警集合做文本匹配的人同样受影响。

## 迁移

1. 管线把任何告警都判为失败时，升级前先查既有草稿：表 1 登记过的独立权利要求，2.1 必须有全文；全文出现的权项号，表 1 必须登记。
2. 从属权项的修改只留在表里即可——这个方向不报。
3. 无内容可填的表整张删掉，不要留占位行。确实要留空格时，该行只要有一个单元格是真实内容就不算占位。
4. 按规则名 `amendment-cross-reference` 与 `empty-table` 匹配，不要匹配写给起草人看的告警正文。
5. 重跑 `pnpm exec vitest run packages/patent/patent-document/tests`：新增用例与既有合规用例都在其中。
