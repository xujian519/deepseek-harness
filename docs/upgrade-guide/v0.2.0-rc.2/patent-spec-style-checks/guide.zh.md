---
kind: upgrade-guide
description: "validate_specification 新增六项说明书体例校验（五部分之外的标题、部分顺序、标记加括号、图号空格、段落编号、摘要标题），draft_claims 新增 max_claims 项数上限并按 error 拦截，此前通过门禁的文本现在可能不通过。"
---

# validate_specification 判定说明书体例与项数上限

[English](guide.md) | 中文

## 变更

`validate_specification` 新增六项确定性校验，读取的输入仍是 `text` 与 `abstract`；除注明外均为 `severity: 'error'`，会令 `passed` 变为 false 并拉低 `score`：

- `heading_set` — `text` 中出现《专利法实施细则》第二十条规定的五部分标题（技术领域、背景技术、发明内容、附图说明、具体实施方式）与 `说明书` 外层标题之外的任何标题。要解决的技术问题、技术方案、有益效果、实施例一、替代实施方式属于正文内容而非部分标题，写成标题即报错。
- `section_order` — 五部分未按上述顺序排列。
- `figure_mark_parentheses` — 说明书正文出现 `名称（数字）`（《专利审查指南》第二部分第二章 §2.2.6 要求标记不加括号）。以列举后缀结尾的名称会被跳过。
- `figure_number_spacing` — `图 1` 未写作 `图1`。
- `paragraph_numbering` — **仅 warning**：正文出现 `[0001]` 形态的段落编号。法条与指南均未要求该体例。
- `abstract_heading` — `abstract` 输入中出现标题（《专利审查指南》第一部分第一章 §4.5.1 禁止）。

`draft_claims` 新增可选参数 `max_claims`。传入后，超过上限的权利要求会判 `claim_count_cap`（error），不再只是原有的 `additional_fee` 警告；此前只触发费用提示的草案现在会判不通过。

## 迁移

1. 对每份在维护的说明书跑一次 `validate_specification`，按新增规则名逐条处置：删掉五部分以外的标题（内容保留、标题去掉），把 `图 1` 改为 `图1`，把 `模块（1）` 改写为 `模块1`，删除摘要中的标题。
2. 要满足项数要求，把收到的上限传进去：`draft_claims({ …, max_claims: 10 })`。超项按 error 拦截，不得当作费用权衡保留。
3. 段落编号仍只是 warning；提交体例不使用段落编号的部署应让渲染器不写编号（见 claims-spec 段落编号那份指南），不要由撰写方手工增删。
4. 确认：重跑 `validate_specification`，上述五个 error 规则名（`heading_set`、`section_order`、`figure_mark_parentheses`、`figure_number_spacing`、`abstract_heading`）不再出现在 `violations` 中；带 `max_claims` 的 `draft_claims` 不再报 `claim_count_cap`。正文仍带 `[0001]` 形态编号时，`paragraph_numbering` 的 warning 属预期结果。
