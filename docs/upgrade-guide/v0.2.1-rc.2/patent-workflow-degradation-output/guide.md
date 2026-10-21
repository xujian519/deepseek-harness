---
kind: upgrade-guide
description: "Failed patent workflow stages now emit `[WORKFLOW_DEGRADED] <reason>` and retry only transient LLM/search failures."
---

# Patent workflow failures now carry a reason

English | [中文](guide.zh.md)

## Change

`executeStage` in `@deepseek-ai/dsh-patent-workflow` now separates terminal and transient failures. A stage handler reports an expected failure by returning `_error`; the executor removes `_error` and `_retryable` from shared state and writes `[WORKFLOW_DEGRADED] <reason>` into the stage output.

Terminal failures (missing input, missing provider configuration, invalid JSON, invalid params) run once. Transient failures (`_retryable: true`, currently LLM call errors and search errors) retry up to the configured `maxRetries`; when retries are exhausted, the output still carries the last reason. `stageResults[].retries` records the number of retries. Empty stage output for a failed stage is gone, so code that treated an empty string as failure must match the new prefix.

Graph-mode runs use the same report: `handlerNode` and `manifestToGraph` convert a handler `_error` into a `<node>__degradation` mark with `reason: node_failed` and `severity: critical` (the message notes retryability), remove the internal keys before merging the delta, and expose the mark through `graphDegraded`. The tool reports `completed: false` for any graph run that carries a mark.

## Migration

1. Replace empty-output checks with a prefix check:
   ```ts ignore-check
   const failed = output.startsWith('[WORKFLOW_DEGRADED]')
   const reason = failed ? output.slice('[WORKFLOW_DEGRADED] '.length) : undefined
   ```
2. Do not read or persist `_error` / `_retryable` from `PipelineState`; the executor strips them. Use the stage output and `stageResults[].retries` instead.
3. Recheck retry budgets. Deterministic failures no longer consume `maxRetries`; transient failures still retry the configured number of times.
4. Graph-mode consumers: read `graphDegraded` or the `<node>__degradation` state key instead of `graphState._error`; a run that previously reported `completed: true` while hiding a handler failure now reports `completed: false`.
5. Confirm: run a stage with no `provider.search` configured and observe one execution with `[WORKFLOW_DEGRADED] [search] 未配置检索器（provider.search 缺失）`; run a failing LLM call and observe `retries` equal to the configured limit.
