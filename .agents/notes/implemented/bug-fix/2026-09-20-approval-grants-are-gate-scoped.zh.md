# Agent Note: 只批准一个门节点，而不是整个 run

Status: implemented

[English](2026-09-20-approval-grants-are-gate-scoped.md) | 中文

## Problem

`packages/patent/patent-core/src/graph/checkpoint.ts` 的 `grantApproval(store, checkpointId)` 通过把 `APPROVAL_GRANTED_KEY = '__approval_granted__'` 以布尔值 `true` 写入检查点的共享 state 来记录人工批准。`ApprovalGateHandler.execute` 读的是同一个键：存在且为真即不中断地返回。

该键活在共享 state 里，所以批准并没有限定在它所回答的那道门上。一个走到两道审批门的 run 会在没有任何人工决定的情况下越过第二道门继续跑。manifest 与图的契约都不阻止一个 run 携带多道门。

图节点自己无法避免这一点：`GraphNodeContext` 不带节点名，门 handler 没有途径询问被批准的到底是不是*它*自己。它能拿到的唯一事实就是这个 run 范围的布尔值。

manifest 路径（`packages/patent/patent-workflow/src/workflow/executor.ts`）本来就是门粒度的形态。它把正在等待的 `stage.id` 与 `approvalGrants` 白名单比对，并把放行标记注入**逐 stage 的 `execState` 副本**，不碰共享 state。

`tests/graph/checkpoint.spec.ts` 把缺陷形态钉成了期望值：它的假门直接读共享 state 的布尔值，断言是对写入记录 `.toBeTruthy()`、对共享键 `.toBe(true)`。

## Decision

`APPROVAL_GRANTED_KEY` 保留，但**只存在于 handler 的局部执行态**。没有任何地方把它写进共享 state；节点或宿主在依据门自身的身份判定「这道门已被批准」之后，才把它注入执行态拷贝。

共享 state 携带的是另一个键 `APPROVAL_GRANTED_NODES_KEY = '__approval_granted_nodes__'`，值为本次 run 被批准的门节点 id 列表。`grantApproval` 写入检查点自身的 `activeNodes`——run 中断时正在等待的那些节点——所以一次批准恰好回答一道门。`isGateApproved(state, nodeName)` 是成员判定。

`GraphNodeContext` 增加可选字段 `nodeName`，由 `graph/engine.ts` 在构造每个节点的上下文时以该节点的注册名填入。两个图节点工厂各按自己掌握的事实使用它：

- `handlerNode`（`graph/domains/shared.ts`）是通用工厂，对它所处的图一无所知，故读取引擎注入的 `nodeName`；
- `makeStageNode`（`graph/adapter.ts`）把节点注册在 `stage.id` 之下并闭包持有该 id，故直接对齐 manifest 路径的 `approvalGrants: stageId[]` 形态。

两者都只在 handler 是审批门时才计算放行，且都在拿不到节点名时退回不放行——直接构造的上下文不放行任何门（fail-closed）。两者都只把该键写进交给 handler 的执行态拷贝。

两个键都以 `_` 开头，故 `collectStateText` 等业务文本汇总天然跳过它们。

## Alternatives considered

**保留共享 state 布尔值，另加「已消费」标记。** 否决：消费需要自己的簿记和自己的提交点，而且一个被批准后再未 resume 的 run 会让「已消费的门」与「未消费的门」无法区分。记录门身份之后这个问题根本不必存在。

**让门节点在运行时把自己的 id 写进共享 state。** 否决：中断的门已经抛出 `InterruptStageError`，之后什么也写不了；而且被记录的事实——人工批准了这道门——源自图之外，该事实的入口正是批准动作本身。

**给共享布尔值改名，靠调用方约定只为当前门写入。** 否决：约定不是强制点，下一个写入该键的调用方就会把泄漏带回来。

**在每个工厂里闭包捕获节点名传入。** 否决：`handlerNode` 包装的 handler 由构图方决定注册名，工厂看不到这个名字；引擎是唯一知道节点以何名注册的地方。

## Consequences

一次批准放行一道门。批准一个 `activeNodes` 中不含审批门的检查点不放行任何东西，run 仍会在下一道门停下。

两条图路径与 manifest 路径现在在放行形态上一致：三者都依据门 id 判定并注入执行态拷贝，都不向共享 state 写放行标记。`APPROVAL_GRANTED_OUTPUT` 仍是 manifest 路径的占位 stage 输出。

本次变更之前写入的检查点只带全局布尔值。`isGateApproved` 不读它，所以 resume 这样的检查点会再次停在门处、需要重新批准。没有兼容读取，也没有降级路径。

图检查点的 state 新增一个键。断言该布尔值的测试、以及消费该布尔值的假门，都已改写为门粒度形态；修复落地前用一个探针在改前的实现上复现了两道门的泄漏。

## Testing

`packages/patent/patent-core/tests/graph/checkpoint.spec.ts` —— 批准写入门粒度列表并经该门 resume；批准非门检查点不放行任何门；同 run 两道门只批准第一道时第二道仍中断。

`packages/patent/patent-core/tests/graph/adapter.spec.ts` —— `handlerNode` 依引擎注入的节点名放行，且共享 state 中不残留放行布尔；`manifestToGraph` 在放行记录含该门 id 时经该门 resume。

`packages/patent/patent-core/tests/atoms.spec.ts` —— 门 handler 的执行态契约，以及门粒度成员判定。

## Related

- [Sati 专利域作为 dsh 插件](../feature/2026-08-17-sati-patent-domain-dsh-plugins.zh.md) —— 本包所属的移植。
