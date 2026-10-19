---
kind: upgrade-guide
description: "失败的专利工作流阶段现在输出 `[WORKFLOW_DEGRADED] <原因>`，且只重试 LLM/检索临时失败。"
---

# 专利工作流失败现在携带原因

[English](guide.md) | 中文

## 变更

`@deepseek-ai/dsh-patent-workflow` 的 `executeStage` 现在区分终态失败与临时失败。阶段 handler 通过返回 `_error` 报告预期失败；执行器从共享 state 中移除 `_error` 与 `_retryable`，并把 `[WORKFLOW_DEGRADED] <原因>` 写入阶段输出。

终态失败（缺输入、缺 provider 配置、非法 JSON、非法参数）只执行一次。临时失败（`_retryable: true`，当前为 LLM 调用错误与检索错误）重试至配置的 `maxRetries`；重试耗尽后输出仍携带最后一次原因。`stageResults[].retries` 记录重试次数。失败阶段不再输出空字符串，原先以空串判断失败的代码需要匹配新前缀。

## 迁移

1. 把空输出判断换成前缀判断：
   ```ts ignore-check
   const failed = output.startsWith('[WORKFLOW_DEGRADED]')
   const reason = failed ? output.slice('[WORKFLOW_DEGRADED] '.length) : undefined
   ```
2. 不要从 `PipelineState` 读取或持久化 `_error` / `_retryable`；执行器会剥离它们。改用阶段输出与 `stageResults[].retries`。
3. 复核重试预算。确定性失败不再消耗 `maxRetries`；临时失败仍按配置次数重试。
4. 确认：在未配置 `provider.search` 时运行检索阶段，观察到只执行一次并输出 `[WORKFLOW_DEGRADED] [search] 未配置检索器（provider.search 缺失）`；运行一次失败的 LLM 调用，观察到 `retries` 等于配置上限。
