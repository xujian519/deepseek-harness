---
kind: upgrade-guide
description: "Aborted patent stage calls now reject with `StageCancelledError` instead of retrying and reporting a degraded stage."
---

# Patent stage cancellation is typed

English | [中文](guide.zh.md)

## Change

`@deepseek-ai/dsh-patent-core` now treats caller cancellation as control flow instead of a retryable failure. When the `AbortSignal` passed to a `StageHandler` is already aborted, the handler rejects with `StageCancelledError` before calling the model or the retriever. When `provider.callLLM`, `provider.llm`, or `provider.search` is in flight and aborts, the handler rejects with `StageCancelledError` as well, including the case where the provider rejects with an `AbortError` but the signal no longer reports `aborted`. The error's `stageId` names the atom.

`@deepseek-ai/dsh-patent-workflow` rethrows that error from the stage executor: the stage is not retried, no `[WORKFLOW_DEGRADED]` output is written, and `runWorkflow` rejects instead of returning a result. The graph engine likewise propagates the rejection through `runNodeWithPolicy` and `CompiledGraph.run` instead of marking the node degraded. A node-level timeout still fails only its node; caller cancellation inside a node rejects the whole graph. A signal that is already aborted when `runWorkflow` reaches a stage boundary keeps rejecting with `WorkflowError('工作流执行已取消')`.

## Migration

1. Handle cancellation separately from failure. Catch `StageCancelledError` around `runWorkflow` and `graph.run`, and keep the boundary `WorkflowError` path; do not detect cancellation by looking for a degraded stage output.
2. Do not rely on retries to outlast a cancellation. Aborted calls no longer consume `maxRetries`, so code that expected a degraded result after retrying an aborted call must handle the rejection instead.
3. Recheck providers that report their own internal timeout as an `AbortError`. That rejection is now read as caller cancellation; return a normal error for provider-internal timeouts instead.
4. Confirm: abort the signal while a model call is in flight, then observe `runWorkflow` reject with `StageCancelledError` and no stage result for that stage.
