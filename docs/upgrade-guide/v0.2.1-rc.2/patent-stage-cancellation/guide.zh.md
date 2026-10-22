---
kind: upgrade-guide
description: "被中止的专利阶段调用现在以 `StageCancelledError` 拒绝，不再重试并报告降级阶段。"
---

# 专利阶段取消改为类型化错误

[English](guide.md) | 中文

## 变更

`@deepseek-ai/dsh-patent-core` 现在把调用方取消当作控制流，而不是可重试的失败。传给 `StageHandler` 的 `AbortSignal` 已中止时，handler 在调用模型或检索器之前即以 `StageCancelledError` 拒绝。`provider.callLLM`、`provider.llm` 或 `provider.search` 执行中发生中止时同样以 `StageCancelledError` 拒绝，包括 provider 以 `AbortError` 拒绝而信号已不再报告 `aborted` 的情况。错误的 `stageId` 标识对应原子。

`@deepseek-ai/dsh-patent-workflow` 的阶段执行器会重新抛出该错误：阶段不重试、不写入 `[WORKFLOW_DEGRADED]` 输出，`runWorkflow` 以拒绝结束而不是返回结果。图引擎同样让拒绝穿过 `runNodeWithPolicy` 与 `CompiledGraph.run`，不再把节点标记为降级。节点级超时仍只让该节点失败；节点内的调用方取消会拒绝整张图。`runWorkflow` 在阶段边界发现信号已中止时，仍以 `WorkflowError('工作流执行已取消')` 拒绝。

## 迁移

1. 把取消与失败分开处理。在 `runWorkflow` 与 `graph.run` 外层捕获 `StageCancelledError`，保留边界 `WorkflowError` 路径；不要通过查找降级阶段输出判断取消。
2. 不要指望重试能拖过取消。被中止的调用不再消耗 `maxRetries`，原先期待重试后得到降级结果的代码需要改为处理拒绝。
3. 复核把自身内部超时报告为 `AbortError` 的 provider。该拒绝现在会被读作调用方取消；provider 内部超时应返回普通错误。
4. 确认：在模型调用进行中中止信号，观察到 `runWorkflow` 以 `StageCancelledError` 拒绝，且该阶段没有阶段结果。
