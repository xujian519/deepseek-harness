# Agent Note: 畸形提供方流可重试

Status: implemented

[English](2026-09-28-malformed-provider-streams-are-retryable.md) | 中文
## 问题

提供方可能违反它自己流出的线上格式：SSE JSON 无法解析、块顺序错乱或重复、工具调用的 `arguments` JSON 被从中间截断。`dsh-llm-deepseek` 把每一种都归类为 `MALFORMED_RESPONSE`，并在终止 finish 之前抛出，因此该次 attempt 不会提交 Assistant message，也不会提交工具副作用。

这一分类是对的；把它当作终局失败才是问题。2026-09-27，`deepseek-official` 路由在一个 `bash` 工具调用的第 3,971 个字符处收束该调用，同时报告的停止原因不是 `max-tokens`，于是翻译层去校验那段 JSON，而不是把被截断的调用留给装配器丢弃。会话日志保留了提供方发来的每一个 delta，失败可由日志复现——`JSON.parse` 报字符串未终止。在[有界恢复](2026-06-21-bounded-llm-request-recovery.zh.md)下，协议失败不属于暂时性失败，因此一次被截断的响应让第 38 步所在的轮次失败，并丢弃它之前的全部步骤——其中包括智能体已经写入磁盘的工作。

## 决策

`MALFORMED_RESPONSE` 默认属于暂时性失败。`@deepseek-ai/dsh-llm` 导出 `MALFORMED_RESPONSE_CODE`，`DEFAULT_RETRYABLE_CODES` 把它列在 `EMPTY_RESPONSE` 之后；省略 `retryPolicy` 的提供方因此会在轮次以该 code 失败之前，带退避地最多重跑五次请求。

分类本身没有变化：每一种违反线上格式的情形仍然让该次 attempt 以 `MALFORMED_RESPONSE` 结束，`max-tokens` 结束仍然保留被截断的工具调用交给块装配器丢弃，预算耗尽仍然把该失败作为轮次错误抛出。改变的只是恢复行为。

## 考虑过的替代方案

**丢弃被截断的工具调用并继续轮次。** 装配器本来就为 `max-tokens` 结束丢弃工具调用，因此这条路不需要新代码。它落选的原因是：当响应只有这一个工具调用块时，组装出的 Assistant message 没有任何可让循环行动的内容——轮次照常完成，本该执行的工具从未运行，也没有任何表层告诉用户原因。

**新增一个 truncated-response code。** 独立的 code 可以只重试这一情形而不重试其他畸形流。它落选的原因是没有任何消费方按这一差异路由——两类都不提交任何持久内容、恢复方式完全相同——为一条恢复路径增加运行时词汇并不划算。

**让协议失败保持终局。** 它落选的原因是：提供方的一次抖动会让用户丢掉整轮已完成的工作，而用户唯一的补救是重跑请求，并且不知道哪一步被丢了。

## 后果

一次无法解码的响应不再让轮次丢掉之前的步骤；这次重跑在会话日志中表现为持久的 `llm/retry` 事件，`retryableCodes` 仍然允许提供方或部署移除该 code。

确定会复现的畸形响应现在会在轮次以同一 code 失败前多花最多五次请求，每次都重新发送请求，其输入走缓存读取。上下文很大时这个代价是真实的，这是防止瞬时提供方缺陷丢弃已完成工作所付的价钱。

## 测试

`packages/llm/llm/tests/retry-policy.spec.ts` 钉住默认集合，`packages/llm/llm-retry/tests/retry.spec.ts` 在默认策略下重试暂存块之后抛出的 `MALFORMED_RESPONSE`，`packages/llm/llm-deepseek/tests/stream.spec.ts` 保留适配器的分类 fixture，三个录制会话 `empty-response-retry`、`empty-response-retry-current`、`transport-failure-retry` 携带扩展后的策略键。
