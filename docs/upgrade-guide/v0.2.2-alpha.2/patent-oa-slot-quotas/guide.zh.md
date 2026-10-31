---
kind: upgrade-guide
description: "答复稿正文超出槽位配额时渲染直接失败，不再产出一份超长文书。"
---

# 超长的答复稿草案不再渲染成文

[English](guide.md) | 中文

## 变更

`validateTemplateDraft` 新增可选的配额校验，`oa-response` 注册表在其中七个小节上启用了它。此前超长的草案照旧通过校验并渲染成文，现在在校验阶段就被拒绝，磁盘上不会落下成品：

| 槽位 | 配额 |
| --- | --- |
| `facts-application`、`facts-prior-art` | 可见字符 ≤ 1000，列表项 ≤ 7 |
| `argument-novelty`、`argument-inventiveness` | 可见字符 ≤ 1500 |
| `amendment-table` | 数据行 ≤ 20 |
| `evidence-table` | 数据行 ≤ 15 |
| `citation-table` | 数据行 ≤ 30 |

「可见字符」指段落文本与列表项去掉全部空白后按码点计数。每条配额是该小节的成文预算（见 `patent-oa-response-budget`）× 1.25，正常写作留有余量，只拦明显失控的草案。

拒绝是一般的草案校验失败：文案给出槽位、实测值、上限与需删减量，例如 `sections.argument-novelty 正文 1620 字超出配额（上限 1500 字）：请删减 120 字以上`。模型按可重试错误处理，删减后重跑即可通过。

schema 这一侧是**新增可选字段**：`TemplateBlocksSlot` 接受 `maxChars` / `maxItems`，`TemplateRowsSlot` 接受 `maxRows`。其余九个通用模板与两个表单模板都没有声明配额，行为与之前完全一致。

## 迁移

1. 案件报配额违规时删减提示所指的小节，不要按案件抬高配额——文案里的槽位 id 就是该改的那一节。
2. 要按本所口径调整配额，改 `OA_RESPONSE_SLOT_QUOTAS`（`packages/patent/patent-document/src/document/draftSchema/generic.ts`），并让它与 `OA_RESPONSE_DRAFT_BUDGET`（`packages/patent/patent-workflow/src/workflow/manifests.ts`）对应项保持约 1.25 倍的关系：两个包互不依赖，任何一个常量都不会自动跟着另一个变。
3. 要给其他模板加配额，在其槽位声明里补 `maxChars` / `maxItems` / `maxRows` 即可，无需改代码。`draft-schema-conformance` 目前断言只有 `oa-response` 声明配额，改声明时记得同步该断言。
4. 改完任一表后运行 `pnpm exec vitest run packages/patent/patent-core packages/patent/patent-document`。
