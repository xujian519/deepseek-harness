# Agent Note: 审查意见答复文书按「事实 → 规则 → 论证」组织

Status: implemented

[English](2026-10-16-oa-response-fact-rule-argument.md) | 中文

## 问题

审查意见答复（`@deepseek-ai/dsh-patent-document` 的 `oa-response`）以「每条审查意见一个块」组织争辩——审查意见要点、答复、事实与证据、结论——`patent_oa_response_v1` 的 draft 阶段 guidance 也规定同一形态。一次针对真实一通的试点重写暴露了这种形态自身的产物：

- **事实与评价同句**。诸如「本发明与对比文件有本质区别」的结论夹在事实陈述里：事实带了评价，结论没有出处。
- **文书跟着通知书走，不跟着争点走**。形式缺陷（用词删除、附图标记与摘要修改）拿到了与新颖性、创造性论证同量级的章节，注意力被平均分摊到轻重不等的事情上。
- **引用凭记忆**。同一试点稿把新颖性引到第 22 条第 3 款，又引了旧版细则第 51 条第 3 款——按项分块把法条写在说理之后、当作结论，没有任何环节强制规则先写明、核验、再适用。

提交载体同样无据可查：没有任何地方写明渲染产物是所内复核稿，向国知局提交须转录到 100012 意见陈述书与 100014 附页。这条边界停留在惯例里，不在模板里。

## 决定

意见陈述按三层、固定八节顺序推进——总体立场、本次修改、本案事实、适用规则、意见陈述、其他缺陷的处理、证据与引用、结论与请求。`oa-response` 模板的 `references/conventions.md`、其槽位注册表（`src/document/draftSchema/generic.ts` 的 `OA_RESPONSE`）与 `patent_oa_response_v1` 的 draft 阶段 guidance 陈述同一纪律：

- **事实**只写申请文件记载或对比文件公开的内容，编号 F1…／P1…，每项至多两句，注明出处（权项号、说明书节次、对比文件段落与附图标记）。本层禁止评价；结构性定位（「实施例 1」）只用于工作稿，正式稿落到页码行号（conventions §5）。
- **规则**逐条列出据以论证的法条与指南节号，编号 R1…，条号写入前须核验，旧版条号换算为现行条号（旧细则第 51 条第 3 款）。随包索引的指南节已转录 2023 年修订版正文，逐字引用前用 `law_verify` 核验命题落在所引节及其子节内；引 2026 年版改动过的节时另行提供该版文本来源（conventions §4）。
- **论证**回指所依据的事实与规则编号（F/P、R），按法律命题分节——5.1 新颖性、5.2 创造性、5.3 其他争点——不以审查意见项号分节，项号只作定位括注。三步法纪律保留在 5.2 内。
- **修改**给出修改对照表与修改后独权全文；新增内容下划线加粗，删除线只留在对照表（conventions §6）。
- **形式缺陷**汇总为一份清单，逐项写处理方式与依据，不再与实体章节争版面。
- 渲染产物是所内复核稿；向国知局提交时正文转入 100014 附页、载体为 100012 意见陈述书（conventions §8）。

## 考虑过的替代方案

- **保留按项分块，只加要求**（pin-cite、条号核验）。它输在：已观察到的缺陷由块本身的形态产生——同一块内事实、评价与法条相邻成句，「事实不带评价」退化为逐条核查；法条写在说理之后，是结论而非前提。
- **把事实与规则提升为独立章节，但论证仍按项号组织**。共同前提会在每个项号下重述一遍，章节数仍跟着通知书的构成走；形式缺陷仍占论证量级的章节，正是试点记录下的那种稀释。
- **只动模板，draft 阶段 guidance 保持按项号**。guidance 是模型撰写时实际读到的文本；只改模板会留下说一套、渲染另一套的作业指令，draft 阶段继续产出槽位集合已不再对应的行文。本次两处同改。

## 后果

- 槽位注册表变了：`arg-*` 字段移除，可寻址章节为 `facts-application`、`facts-prior-art`、`rules-body`、`argument-novelty`、`argument-inventiveness`、`argument-other`（可选）、`formalities-body`（可选）。按旧 id 写成的草案不再渲染，而是校验失败（未知键 + 缺必填章节）。
- 只涉一个实体理由的案件同样带 5.1 与 5.2；未涉及的子节写明该理由未被提出、不再展开，不静默留空。
- 工作流的 draft 阶段模型可见文本变化；`manifest-guidance.spec.ts` 钉住三层纪律与旧句的缺席。
- 受控草稿仍是专利交付物的唯一内容通道（[2026-10-10 笔记](2026-10-10-patent-documents-single-channel.zh.md)）。

## 测试

- `packages/patent/patent-workflow/tests/manifest-guidance.spec.ts`——draft guidance 含「事实 → 规则 → 论证」与按争点组织，不再含按项答复的旧句。
- `packages/patent/patent-document/tests/tool.spec.ts`——表单草案经新槽位集合渲染。
- `packages/patent/patent-document/tests/draft-schema-conformance.spec.ts`——注册表与模板双向锁定，单侧新增槽位会被拒绝。
- `pnpm exec vitest run packages/patent/patent-workflow packages/patent/patent-document`：38 个文件、499 例通过。
