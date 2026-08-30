# Agent Note: H6 收敛 — 导出 canonical 的 aborted-before-dispatch 合成结果工厂

Status: implemented

[English](2026-08-30-aborted-before-dispatch-result-sink.md) | 中文

## 问题

台账 H6 条目登记了两族复制的模型可见恢复文案。动手前重扫发现台账已半数过时：它引用的两段漂移的 `TOOL_OUTCOME_UNKNOWN` 文案在仓内已不存在——`packages/core/session/src/repair.ts` 持有两段恢复文案的唯一现实定义，session README 逐字钉住。剩下的是取消结果形状：`toolAbortedBeforeDispatchResult()` 已作为 canonical 工厂存在于 `@deepseek-ai/dsh-tools`，但是私有的，于是两个消费者重新手打了字面形状——agent-loop 的 `appendSkippedToolCall`（为被取消跳过的模型调用追加的合成结果）与 session-checkpoint-policy 的 `tools/execute` 中止臂，后者的本地包装连工厂的意图文档都复制了。

## 决策

从 `@deepseek-ai/dsh-tools` 导出 `toolAbortedBeforeDispatchResult`，两个调用点改指工厂；删除两份手打形状。两个调用点都没有 `prior` 结果，追加与返回的对象与被删副本产出的逐字节相同。`toolAbortedResult`（body 已调用分支）保持私有：没有消费者手打它，导出无使用者的 API 比私有工厂更糟。

## 后果

H6 以比台账建议更小的机制关闭：无需共享 recovery-vocabulary 包，因为 canonical 的家已存在，且恢复文案那一半已坍缩为单一定义。各工具包钉住的 `ABORTED_BEFORE_DISPATCH` 错误码断言现在只有一个生产者。台账共享原语清单推进到 5 之 4；余 ResolvedConfig（M2）。

## 落选方案

**按台账新建共享 recovery-vocabulary 模块（错误码 + 逐字文案 + 工厂）。** 拒绝：它会用新包装下两个所有者的契约，而各自已有一个家——恢复文案在 `dsh-session`（唯一现实定义），取消结果在 `dsh-tools`（canonical 生产者）。新包只会增加一个所有者而不删掉任何副本。

**为对称一并导出两个取消工厂。** 就 `toolAbortedResult` 而言拒绝：这对工厂的对称性属于 `dsh-tools` 内部（两者由 body-invoked 检查选择），但导出面应跟随消费者，而只有 before-dispatch 工厂有消费者。
