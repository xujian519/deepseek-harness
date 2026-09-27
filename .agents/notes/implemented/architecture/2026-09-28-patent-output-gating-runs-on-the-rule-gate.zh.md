# Agent Note: 专利输出门禁由规则门禁单独执行

Status: implemented

[English](2026-09-28-patent-output-gating-runs-on-the-rule-gate.md) | 中文

## 问题

专利 preset 的 persona 承诺输出级强制：风险结论附免责声明、含结论的交付物先经人工审批、绝对化表述给出提示。这三条职责只存在于 [`@deepseek-ai/dsh-patent-workflow`](../../../../packages/patent/patent-workflow/README.zh.md) 的 `PatentOutputGate`（`src/output-gate.ts`）与其 `processPatentOutput` 步骤（`src/quality-gate.ts`），二者都没有生产调用点。与此同时，[`selectGateRules`](../../../../packages/patent/patent-rule/README.zh.md) 以「关键词门禁镜像了同一词表」为由排除全部 `PAT-*` 规则——而所指的正是这个从未接线的模块。两条链各自以为对方在执行这些规则。

该门禁没有可挂载的接缝。循环每步结算一条 `assistant/message`，而已文档化的瀑布（`agent/pre-step`、`agent/request`、`llm/stream`、`tools/*`）都不会重写它：`llm/stream` 变换的是 provider 流，无法表达「把这条消息扣住直到人工批准」。接线意味着给循环新增扩展点，并在消息层新增审批通道。相比之下，规则门禁已经挂在 `tools/post-execute` 上、并被 `patent-teams` 消费；凡是调用方能够改写输出的地方，它的 `process()` 就能改写文本。

## 决策

规则门禁是合规规则的唯一执行者。`selectGateRules` 现在保留全部 `keyword_blocklist` 规则，因此 `PAT-RISK-001`（warn）、`PAT-APPROVAL-001`（review）、`PAT-ABS-001`（warn）在规则门禁运行的所有位置都执行：

- `tools/post-execute` 上 `gateToolNames` 命名的交付工具（`render_patent_document`、`draft_claims`、`draft_specification`、`validate_specification`）：block 命中拦截调用，review 命中请求 `ctx.approval`，无答案者时 fail-closed，warn/log 命中记日志。
- `patent-teams` 任务收口消费的 `patentRuleGate` 服务。

未接线的一侧整体删除，而不是留成无消费者的公有 API：`output-gate.ts`、`processPatentOutput` 与 `quality-gate.ts` 中的引用核验镜像（已接线的引用核验是 [`@deepseek-ai/dsh-patent-law`](../../../../packages/patent/patent-law/README.zh.md) 的 `law_verify`）、审批审计存储（`approval.ts`，其唯一消费者是该门禁），以及 `src/types.ts` 中的输出门禁消息词汇。唯一存活的导出 `ABSOLUTE_PHRASES` 迁到其唯一消费者 `patent_eval`。

## 考虑过的替代方案

**把 `PatentOutputGate` 接入 assistant 输出流。** 该接缝不存在。新增它属于循环改动加新的文档化扩展点，而且门禁的「暂缓持久化」审批仍然需要循环不具备的消息级审批流。规则门禁已经在专利模式真正交付的输出上执行同样的规则。

**保留门禁与其关键词表作为公有 API。** 它没有消费者，其词表与规则门禁现在执行的规则重复；保留它等于把不成立的声明留在原地，并让同一组词存在两份。

**在 post-execute 的 warn 路径追加免责声明。** `PostToolDecision` 可以替换结果内容，因此 warn 命中本可追加合规提示块。但 warn 按设计只是提示——为每个提到「侵权」或「绝对」的受门禁工具结果追加规则引用，只会给模型可见结果添噪；交付物上的免责声明由渲染路径（[`@deepseek-ai/dsh-doc-style`](../../../../packages/document/doc-style/README.zh.md) 的模板/风格声明）持有，而不是由工具结果上的门禁持有。

## 测试

| 证据 | 行为 |
|---|---|
| [output-gate.spec.ts](../../../../packages/patent/patent-rule/tests/output-gate.spec.ts) | 门禁携带全部 `keyword_blocklist` 规则（含三个 `PAT-*` 键）；命中 `PAT-APPROVAL-001` → `needsApproval`，命中 `PAT-ABS-001` → warn。 |
| [patent-compliance.spec.ts](../../../../packages/patent/patent-rule/tests/patent-compliance.spec.ts) | 已加载全量规则集中每条 `PAT-*` 关键词规则都被 `selectGateRules` 选中，没有合规关键词规则处于无人执行状态。 |
| 专利会话快照（`pnpm run test:snapshot -t patent`） | 受门禁工具的录制结果不含审批或拦截关键词，重放输出不变。 |

## 后果

- 受门禁交付工具上命中 `PAT-APPROVAL-001` 现在会请求审批；无审批通道时与既有 review 命中一样按拦截处理。preset persona 的「结论性判断需人工确认」在这些工具上成立。
- `PAT-RISK-001` 与 `PAT-ABS-001` 命中只记日志、不追加文本。专利交付物携带的免责声明来自模板/风格渲染路径，工作流运行自身的 HITL 阶段仍是其审批点。
- `PAT-CITE-001`（`citation_analysis`）仍只经显式 `rule_check` 可达；移植过来的相关性镜像（R2）本就没有执行者，已删除。
- `@deepseek-ai/dsh-patent-workflow` 不再导出 `PatentOutputGate`、`processPatentOutput`、`verifyCitations`、`formatCitationWarnings`、`ApprovalRecord` 存储与输出门禁消息类型；`ABSOLUTE_PHRASES` 由 `patent_eval` 持有。
