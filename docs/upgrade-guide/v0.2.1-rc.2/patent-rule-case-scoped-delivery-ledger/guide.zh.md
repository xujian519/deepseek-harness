---
kind: upgrade-guide
description: "patent-rule 的交付台账改为按 agent 与案卷键归属，case-A 的前置调用不再放行 case-B 的交付。"
---

# 交付门禁证据按案卷隔离

[English](guide.md) | 中文

## 变更

交付门禁台账过去只按调用方（agent）归属。同一会话处理多个案件时，在 case-A 中执行的 `rule_check` 等前置调用，会满足 case-B 交付的同一前置要求。现在台账按 agent 与调用声明的案卷键（`caseId`、`case_id`、`case_dir` 或 `caseDir`）归属。声明了案卷的前置调用只满足该案卷，其他案卷的记录永不被查询；未声明案卷的前置调用仍是会话级记录，只在交付的案卷没有专属记录时采用。未声明案卷的交付采用本会话内的任一记录。

## 迁移

1. 交付调用声明案卷时，为其前置调用传同一个案卷标识；否则这些前置调用会作为会话级证据。
2. 在同一会话中切换案件后重跑该案的前置调用，不要沿用前一案件的运行记录。
3. 确认：带 `caseId: "case-A"` 的 `rule_check` 之后，带 `caseId: "case-B"` 的 `render_patent_document` 被拒并点名缺失前置；补跑带 `caseId: "case-B"` 的 `rule_check` 后放行。
