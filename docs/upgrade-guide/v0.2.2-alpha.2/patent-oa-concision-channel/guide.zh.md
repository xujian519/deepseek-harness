---
kind: upgrade-guide
description: "`response-check` 新增表达质量通道（`response_concision_*`），并新增 PR-OA-010 空节、PR-OA-011 结论重复两条 warn 级规则。"
---

# 答复检查分出表达质量通道

[English](guide.md) | 中文

## 变更

`response-check`（`packages/patent/patent-tools`）此前只判合规三条：PR-OA-007（26.3 判准落位）、PR-OA-008（驳回理由覆盖）、PR-OA-009（未提条款引用）。现在它同时判表达质量四条：PR-OA-005（计数式论证）、PR-OA-006（重复引证）、PR-OA-010（空节）、PR-OA-011（结论重复），产出独立的三个键：

| 键 | 内容 |
| --- | --- |
| `response_concision_report` | 表达质量检查报告（Markdown） |
| `response_concision_passed` | 表达质量是否零命中 |
| `response_concision_violations` | 表达质量违规项 |

`response_check_report` / `response_check_passed` / `response_check_violations` / `response_check_unevaluated` 的语义**一字未改**：仍只由合规三条决定。两条通道分开，是因为合规命中的后果是文书不满足法定或程序要求，而表达质量命中只说明该改稿——`legal-gaps` 里前者按 `block` 记账、后者按 `warn` 记账，因此`response_concision_passed` 为 false 不会拦住交付。

规则编号常量随之拆成 `COMPLIANCE_RULE_IDS`（三条）与 `CONCISION_RULE_IDS`（四条），旧名 `RESPONSE_CHECK_RULE_IDS` 保留为前者的别名，取值不变。

`oa-response-form.yaml` 新增两条规则，均为 `warn`：

- **PR-OA-010 空节**：小节标题后没有正文，或正文只有「无」一类占位语。同时识别 Markdown 标题与 `<h2>` 标题；只含子标题的父节不算空；样式表、脚本与代码块不算正文。
- **PR-OA-011 结论重复**：同一句（≥12 字）在全文出现 3 次以上。样式表与表格分隔行不参与计数。

`patent-full` scope 的规则总数由 123 增至 125。

`oa-response` 模板的 `example.html` 同步改了一处措辞：创造性第二步原以「」重引权利要求 1 补入的特征，现改为指代 `F2`（见 3.1 节），使参考成品本身通过 PR-OA-006。这处改动是示范性质，不改变模板槽位或渲染结构。

## 迁移

1. 只读 `response_check_passed` 的消费方行为不变。要接表达质量，额外读 `response_concision_passed`；不要把两者合并成一个布尔——合并会让「句子写啰嗦了」以法律阻断项的样子出现。
2. 自建规则资产若自行拼规则列表，把 PR-OA-010/011 放进表达质量一侧：两条都是 warn 级、都命中即违规，放进合规一侧会翻 `response_check_passed`。
3. 手写成件若报 PR-OA-010，删掉整个小节而不是留标题；报 PR-OA-011，保留一处结论、其余改为「见前述结论」。
4. PR-OA-006 的阈值仍是 `minOccurrences: 2`（本次未改）：答复里同一引文出现两次即提示，两处「提出—引用」关系会被报出，属既有口径，按需在资产里调。
5. 改完运行 `pnpm exec vitest run packages/patent/patent-rule packages/patent/patent-tools`。
