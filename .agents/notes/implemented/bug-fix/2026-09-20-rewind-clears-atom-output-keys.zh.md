# Agent Note: 清掉被回退阶段写下的每一个输出键

Status: implemented

[English](2026-09-20-rewind-clears-atom-output-keys.md) | 中文

## Problem

两条回退路径都只删 stage-id 键，别的什么都不删：

- `patent-workflow/src/workflow.ts` 的 `runWorkflow` 遍历 `manifest.stages.slice(rewindIndex)`，逐个删 `stage.id`；
- `patent-core/src/graph/adapter.ts` 的 `makeRetryRouter` 删除 `stages.slice(rewindIndex, currentIndex + 1)` 里的每个 id。

atom 写下的绝不止 stage-id 键。`extract` 声明 `outputSchema: ['extraction_result', 'features', 'problems', 'effects']` 并把四个键都写进 state；`search` 在摘要之外还写 `prior_art`。执行器只把 `outputSchema[0]` 读作阶段主输出键，所以其余键从不是执行器的事——它们是后续阶段与 atom 按名读取的 state。回退时没有任何东西删它们。

失效形态是「重跑时解析失败」。`extract` 解析失败时保留模型原文而非 JSON，只写 `extraction_result`，于是重跑把**上一代**的 `features` 数组留在 state 里。下游 merge 于是读到一代特征的旁边是一代全新的问题，且什么都不报：state 看起来是齐的，没有任何消费方能分辨其中一路输入来自已被回退掉的那次运行。

`Reflect.deleteProperty` 在仓里恰好只出现在这两处，这正是缺口得以显形的原因：同一条回退语义的两份独立副本，以同一种方式不完整。

两条回退路径的测试都没有覆盖键清理。声明式路径的用例只断言最终输出是新的那个，图路径则完全没有清理用例，所以陈旧键对测试套件不可见。

## Decision

`packages/patent/patent-core/src/workflow/stage-outputs.ts` 的 `clearStageOutputs` 接管删除：对传入范围内的每个阶段，删 stage-id 键，再删 `atoms.lookup(stage.atom)?.outputSchema ?? []` 里的每一个键。两条路径都调它。

它落在 `patent-core`，因为那是两个调用方本就依赖的包：`patent-workflow` 与 `patent-tools` peer 依赖 `patent-core`，而 `patent-core` 不依赖其中任何一个。这条原语是共享的回退语义，而两份实现早已漂移成它的两份副本。

范围仍由调用方决定。`runWorkflow` 传回退点起的全部阶段；图 router 传含当前阶段在内的被回退切片。原语只处理交给它的阶段，不重算边界——两条路径从不同结构推导边界，一个重算边界的原语就得同时懂这两种结构。

`makeRetryRouter` 因此新增 `atoms: AtomRegistry` 参数以够到注册表，由 `manifestToGraph` 的 `deps` 串下来。

无 atom 的阶段、或 atom 未注册的阶段，只删其 stage-id 键。未注册的 atom 在构图时已被拒绝，无 atom 的阶段也没有可清理的声明输出键；两者在清理时刻都不是错误。

`clearStageOutputs` 由 `@deepseek-ai/dsh-patent-core` 导出，供 `patent-workflow` 调用。

## Alternatives considered

**整体移植 Sati 的 `stage-primitives.ts`。** 否决：它另外两个导出在这里已以内联形态存在——`executor.ts` 的主输出键解析与 `isApprovalGateHandler`——为了用三个函数里的一个而引入一个模块，且另两个与现存代码重复，等于给已有唯一归属的行为再添一个家。

**在两条路径里各自就地修。** 否决：那正是产生这个缺陷的安排。一条语义的两份副本漂移成了同一种遗漏，而第三条回退路径没有任何理由会做对。

**回退时清空整个 state，从头重放。** 否决：`runWorkflow` 的回退是从 `rewindTo` 重跑而非重启，回退点之前的阶段不会被重新执行——它们的输出必须留存。

**在调用点从阶段的 atom 推导输出键，把键列表传进去。** 否决：调用方于是要为每个阶段拿到注册表和 atom，而这正是原语已经在做的查询。传阶段，参数就只包含调用方手里已有的东西。

## Consequences

被回退的重跑从「被回退阶段不留任何键」的状态开始，无论重跑是否把它们全部写回。解析失败的重跑留下的是缺失的键而非陈旧的键，所以需要它们的下游消费方看到的是输入缺失，而不是一份旧的输入。

`Reflect.deleteProperty` 现在只出现一次，在原语内部。第三条回退路径有一个函数可调。

图 router 的签名变了；它唯一的构造点是 `manifestToGraph`。

## Testing

`packages/patent/patent-core/tests/workflow/stage-outputs.spec.ts` —— stage-id 键与三个 `outputSchema` 键都被删除；无 atom 的阶段只丢 stage-id 键，且传入范围之外的阶段不受影响；atom 未注册时删掉 stage-id 键且不抛错。

`packages/patent/patent-core/tests/graph/adapter.spec.ts` —— 两个提取阶段分别写 `features` 与 `problems`；第二轮的 feature 路返回非 JSON，故 `features` 无人写回。测试断言 `state.features` 为 `undefined` 且 `state.problems` 是新一代，这正是本修复所阻止的混代状态。

`packages/patent/patent-workflow/tests/workflow-retry.spec.ts` —— 回退用例跑一个声明 `out_primary` 与 `out_extra` 的探针 atom，并记录重跑在 `out_extra` 读到什么。断言重跑两轮都读到 `undefined`，才是「非 stage-id 键已被清理」的检查；原先对最终输出的断言做不了这件事。

## Related

- [Sati 专利域作为 dsh 插件](../feature/2026-08-17-sati-patent-domain-dsh-plugins.zh.md) —— 本包所属的移植。
