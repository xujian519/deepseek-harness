# Agent Note: 以内存实现闭合 ApprovalStore 类型 seam

Status: implemented

[English](2026-09-20-approval-store-seam-closed.md) | 中文

## Problem

`packages/patent/patent-workflow/src/approval.ts` 声明了 `ApprovalStore`（`saveRecord` 与 `listRecords`）与 `createApprovalRecord`，却没有交付任何实现。仓里每一个 `ApprovalStore` 都是 `output-gate.spec.ts` 里的内联桩，于是该接口不承载可执行的契约，而 `stats()`——Golden Benchmark 转换所需的 `AdoptionRate` 的来源——在任何地方都不存在。

只有类型无法告诉读者实现该如何处置交给它的记录：`listRecords` 可以返回内部数组、听任调用方改写已存审计记录；`saveRecord` 可以是同步的也可以是返回 Promise 的；空存储的采纳率可以是 `NaN` 也可以是 `0`。

促成此项工作的那条结论本身还有两处夸大，这两处更正也记在此处，否则后来的读者会重新推导一遍：

- **`PatentOutputGate` 没有生产构造点。** `new PatentOutputGate(` 只出现在 `output-gate.spec.ts`。生产上生效的门是 `RuleOutputGate`，由 `patent-rule/src/index.ts` 接线到 `tools/post-execute`，review 级违规经 `ctx.get('approval')` 路由，无应答者时 fail-closed。所以往 `PatentOutputGate` 里接一个 store，是挂在一条无人可达的链上。
- **本域并非没有留痕。** `packages/interaction/user-approval/src/index.ts` 写入 `approval/asked` 与 `approval/decided` 事件对（声明于 `packages/core/session/src/known-event-types.ts`），`packages/interaction/user-approval/src/invariant.ts` 校验该配对。相对上游设计所缺的是决策之上的**聚合指标层**，而不是决策记录本身。

## Decision

`InMemoryApprovalStore` 实现 `ApprovalStore`：只增 push、`listRecords` 返回深拷贝、`stats()` 报告 `total`、三类结论计数与 `adopted / total`，空存储时为 `0`。

**本次只闭合类型 seam。** 没有门被接到 store 上，没有任何调用方的行为改变，也没有任何东西落盘。持久化审计库、以及应由哪个门持有 store，都是独立的决策，本 note 有意两者都留开：一个存在却无人使用的实现，比一个被接进「其在生产路径上的位置本身尚未定论」的门里的实现，承诺更小。

`listRecords` 经 `structuredClone` 拷贝，而非上游使用的浅展开。同包的 `InMemoryWorkflowRunStore` 在存取两侧都深拷贝，而一条能被调用方经返回引用改写的审计日志不成其为审计日志。记录都是纯 JSON 值，故克隆是精确的。

空存储时 `stats()` 的 `adopted / total` 返回 `0` 而非 `NaN`。消费该比率的基准不应为了「无数据」被拼成一个非数字而额外设防。

`saveRecord` 返回 `void`，在接口的 `void | Promise<void>` 中取更窄的一侧，同步调用方不受影响；落盘实现返回 Promise。

`createApprovalRecord` 未改；两侧对其语义本已一致。

## Alternatives considered

**在 `approval/asked` + `approval/decided` 会话事件之上补一层指标，不做 store。** 本次否决：那是一项真实能力，事件也确实是为承载它而存在，但它引入一个自带归属包、自带快照义务、自带「`AdoptionRate` 在哪里发布」决策的新会话事件消费方。闭合一个类型 seam 与搭一层聚合是两种规模的改动，合在一起会让小者等大者。

**两个实现都移植，并把 store 接进 `PatentOutputGate`。** 否决：`PatentOutputGate` 没有生产构造点，接线得先复活这道门，而复活后的门会与已经接线、已经路由审批的 `RuleOutputGate` 功能重叠。两道门同时消费 `tools/post-execute` 的结果是行为变化，不是移植。

**照上游那样从 `listRecords` 返回内部数组。** 否决：调用方于是持有 store 自身状态的引用，而事后被改写的审计记录与本来就那样写入的记录无法区分。深拷贝正是这个方法的意义。

**现在就落盘到 SQLite。** 否决：落盘需要 schema、迁移策略与文件归属，只有在真的有东西经 store 写入之后才值得付出这些。推迟它，本次改动就不带任何持久格式承诺。

## Consequences

`ApprovalStore` 有了测试可驱动的实现，`stats()` 对空存储与每类结论都有确定行为。

任何调用方的行为都不变。`PatentOutputGate` 的测试保留其内联桩：那些桩的存在是为了驱动这道门的 fail-open 契约，换成真实 store 就变成在测 store。

Golden Benchmark 转换在生产上仍读不到 `AdoptionRate`，因为生产上没有任何东西写入记录。补上这一缺口需要先选定指标层的归属，本 note 不做此决定。

## Testing

`packages/patent/patent-workflow/tests/approval.spec.ts` —— 存列往返；`listRecords` 返回副本，改动它不触及 store；`stats()` 逐类计数并给出 `adopted / total`；空存储时 `adoptionRate === 0`。

## Related

- [Sati 专利域作为 dsh 插件](../feature/2026-08-17-sati-patent-domain-dsh-plugins.zh.md) —— 本包所属的移植。
