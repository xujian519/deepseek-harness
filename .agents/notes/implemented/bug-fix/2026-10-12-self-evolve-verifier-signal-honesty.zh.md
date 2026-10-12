# Agent Note：self-evolve 验证信号诚实性

Status: implemented

[English](2026-10-12-self-evolve-verifier-signal-honesty.md) | 中文

## 问题

基础提供方的聚合门把三个速率相乘——`min(judge 各维度分) × heldInRate × heldOutRate`——再与 `minAcceptConfidence`（0.5）比较。三个缺陷让这道门既与包文档不符，也与代码看起来在度量的东西不符。

**judge 缺失时得 1.0。** `_judge` 在 `validatorTarget` 未配置或 llm 服务缺失时返回 `null`，而调用点用 `SMOKE_SCORES` 兜底——四维全 1。这与其他维度的契约正好相反：那里缺失信号代之以弱路径 0.3。于是没有 `validatorTarget` 的部署，只要另外两维通过就会接受提案，`confidence` 为 1.0 且**完全没有 LLM 评审**；而 `self-evolve-basic/README.md` 承诺的是"缺失信号退化为弱路径 0.3，而不是伪造验收"。这个兜底源自 P0 的 bracket-smoke 阶段（[失败事件源与验证门](../architecture/2026-08-17-self-evolve-event-sources-and-validation-gates.zh.md)），后来只有 held-in 与 held-out 两条路径被收紧。

**弱路径不可达且静默。** 当 `heldInRate = heldOutRate = 0.3` 时，无论 judge 给多少分都到不了 0.5——需要 `min(scores) ≥ 5.56`。循环照常挖掘模式、产出提案、写入负面结果行，然后把每一条都以 `low-confidence` 拒绝。没有任何东西区分"验证器从未评判过它"与"验证器评判它不佳"，于是仅仅是验证器没配置的部署，产出的证据读起来像一连串糟糕的提案——而模板提案器又把这些行摘要回自己的上下文当作修复提示。

**字节预算在数 UTF-16 码元。** `maxPromptInflationBytesPerWeek` 与 `L2-context.estimatedBytes` 都以字节命名，但 `pruneInflatedSections` 与模板提案器量的是 `String.length`，对非 ASCII 文本低估最多达 3 倍。

第四个更窄的缺陷在同一段代码里：held-out 分支用 `heldOutRate === WEAK_VERIFIER_RATE` 判断该维度是否被测量过，于是恰好 0.3 的真实通过率（3/10）被读成"无信号"，而返回 `cases: 0` 的收集器会同时产出"已测量"与"不可用"两行证据。

**重放把"完成"当成了"修复"。** `replayCase` 的退出码取自 `result.stopReason === 'completed'`，于是一个只报告完成、什么都没执行的 fork 子代理，与一个真正重跑了失败命令的子代理得分相同。该判定中客观的那一半——重新折叠子代理自己的事件、看模式是否再次触发——本来就在，但单靠它无法拒绝一次空转。

**held-out 读的是提案会话自己的历史。** `collectHeldOutSignal` 检索 `sessionId: session.id`，于是模式的来源、提案、与 held-out 裁决都出自同一份日志。那是自证而非独立探针，也正是新会话中集中的失败模式常常一条命中都没有的原因。

## 决策

把无信号的维度当作**缺失**，绝不当作有利，并让由此产生的拒绝如实说明。

- **删除 1.0 兜底。** `_judge` 返回 `null` 时改用 `WEAK_VALIDATION_SCORES`（四维均为 0.3），与 held-in、held-out 两条路径一致。
- **记录原因。** `validateProposal` 收集弱维度名称；列表非空时，**先于**阈值比较返回 `rejected` 且 reason 为新增的 `verifier-unavailable`，诊断里点名缺失的维度。顺序是刻意安排的：调低 `minAcceptConfidence` 不得把缺失的证据变成验收。
- **区分两种拒绝含义。** `low-confidence` 此后只表示"所有维度都被测量过，而乘积不达标"。由于 `persistNegativeResult` 原样存储 reason、提案器前缀又会摘要它，这一区分把验证器配置问题挡在循环自己的 few-shot 修复上下文之外。
- **按字节计量。** 一个 `utf8Bytes` 辅助函数（`Buffer.byteLength(text, 'utf8')`）替换了剪枝预算与模板提案器 `estimatedBytes` 里的 `String.length`。
- **显式表达 held-out 是否被测量。** 用 `heldOutMeasured` 标志取代 `=== WEAK_VERIFIER_RATE` 比较，于是真实的 0.3 通过率会被测量，而 `cases: 0` 才是未测量。
- **要求重放真的动过手。** `replayCase` 现在把每个子代理一次性折叠为"重新触发的模式 id"与"工具调用次数"，只有子代理正常结束、至少调用过一次工具、且未重新触发任何模式才算通过。重放提示明确写出：只描述结果而不执行，不算验证。这证明子代理尝试过，而非证明失败已被修复。
- **让 held-out 可以读另一个会话。** `heldOutSessionIds` 指定提供 held-out 案例的会话；探针依次检索、合并命中，并按 `maxHeldOutCases` 截断。supporting seq 过滤只对提案会话生效，因为 seq 编号是会话局部的。留空是默认值，保持原先的同会话行为——这一点现在写进了配置文档、README 与 `Known Limitations`。
- **让 L4 保持诚实。** L4 的验收路径保留其评分，但命名为 `L4_APPROVAL_SCORES` 并注明"未被评估"：聚合门不评估 L4，人工审批流是它唯一的防线。

由于随附默认没有配置这三个维度中的任何一个，基础 bundle 仍然不提交任何东西——但它现在报告的是点名维度的 `verifier-unavailable`，而不是一连串 `low-confidence`。

## 备选方案

**把 1.0 兜底留作显式 opt-in**（`judgeFallback: 'weak' | 'smoke'`）。否决：没有当前消费者需要 smoke 验收；仓库约定不让 opt-in 进入随附默认；而一个唯一效果是接受未评审提案的配置开关是负债而非能力。删掉常量同时消除了未来调用者再次伸手去拿它的可能。

**只调高 `minAcceptConfidence`，不加新 reason。** 否决：阈值不是缺陷所在。这道门本来就不可达；缺的是对*为什么*的如实交代——而那正是负面结果日志回喂给提案器的东西。

**把弱路径变成关闭循环括号的错误。** 作为默认否决：没有配置验证器的 idle 循环是一个合法（尽管空转）的状态，而非 harness 故障；关闭括号会连带压下模式挖掘与负面结果行，而这些正是后续配置变更的收益来源。改由拒绝原因承载这一信号。

## 后果

- `verifier-unavailable` 加入 `@deepseek-ai/dsh-self-evolve/types` 的 `ProposalValidationOutcome` 拒绝原因联合；由于 `self-evolve/validated` 载荷类型变化，`docs/persistence-catalog.md` 需重新生成。
- 两个原本在弱路径下断言 `low-confidence` 的测试改断言 `verifier-unavailable`。三个新用例钉住此次修复：judge 缺失时即使验证器通过也拒绝；`minAcceptConfidence: 0` 仍不能接受缺失信号；多字节片段会被一个其 `length` 本可通过的字节预算剪掉。
- 三个重放 fixture 在更严判据下改变了含义：一个"干净"的 held-out 子代理现在会执行一次工具调用，而"无本地 agent"用例从通过变为不通过。另有一个新用例覆盖"完成了但没调用过任何工具"的子代理。
- 测试套件里原有一个用例的通过**完全依赖**那个 1.0 兜底（"both verifiers pass + held-out passes → accepted"）。它现在显式提供 judge 分数，因此日后若回退到兜底，套件会失败。
- 文档重新与代码一致：`self-evolve-basic/README.md`/`.zh.md`、`tool-self-evolve` 的提示片段与 README、`spec.md`、`tasks.md`、`check_list.md` 都写明三个前置条件与 `verifier-unavailable` 结果。`Known Limitations` 记录了本次**没有**修复的部分：held-out 限于本会话、重放只证明"确实做过"而非"确实修好"、L4 仅由人工审批授权。
- 仍然推迟：客观的重放判定（失败模式不携带可重放命令，因此"做过"仍在代替"修好"）、默认即独立的 held-out 来源（`heldOutSessionIds` 可以提供一个，但没有东西能自动发现它），以及尚未执行的 P1.10 评估。
