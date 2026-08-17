# @deepseek-ai/dsh-self-evolve

[English](README.md) | 中文

**`SelfEvolveEngine`**（`ctx.selfEvolve`）定义了自改进插件该做什么——观察基于验证器的失败模式，并对技能、提示片段、工作流或 harness 包提出窄范围编辑——而不规定怎么做。

本包拥有 self-evolve capability 的 Service Definition 角色，拆分目的是让每个角色可以独立演进（或被替换）：

| 包 | 角色 |
|---|---|
| `@deepseek-ai/dsh-self-evolve`（本包） | Service Definition：抽象服务 + `self-evolve/*` 事件 + `FailurePattern` 词汇表 + projection-unit 契约 |
| `@deepseek-ai/dsh-self-evolve-basic` | Service Provider：idle 压力触发、速率限制、L1/L2 提案与可逆 effect 提交 |
| `@deepseek-ai/dsh-tool-self-evolve` | Consumer：面向模型的工具与基于 `ctx.selfEvolve` 的提示片段 |

## 服务 API（`ctx.selfEvolve`）

| 成员 | 语义 |
|---|---|
| `evolveIfNeeded(agent, trigger, signal, levels?)` | 针对给定触发器考虑是否执行一次进化循环。当策略判定无需运行时返回 `null`。 |
| `evolveNow(agent, signal, levels?)` | 无视压力策略，立即显式执行一次进化循环。 |
| `readPatterns(sessionId)` | 读取某会话最新的失败模式投影状态。 |

四种编辑面，由窄到宽依次为 `L1-skill`、`L2-context`、`L3-workflow` 和 `L4-harness`。后端拥有触发策略、速率限制、提案模型路由、验证器 grounding 以及 held-in/held-out 回归执行的实现。

## 事件

`self-evolve/*` 事件通过声明合并扩展 `SessionEventMap`。它们是 session 事件，而非 cordis 的 `Events`，且均为仅日志事件。成对的 `self-evolve/start` → `self-evolve/end` 共享一次运行身份，贯穿 `mined`、`proposed`、`validated` 与 `commit` 事件。

## 失败模式投影

弱点挖掘通过 `failure-patterns` 投影单元（`SessionProjectionMap['failure-patterns']`）读取持久会话日志。该投影将 `tool/result` 失败面（shell 退出/信号标记或工具错误，通过配对的 `tool/call` 身份命名）、`agent/request-error`、`compaction/end` 与 `self-evolve/end` 事件折叠为以 `(level, verifierTier, causalSignature)` 为键、基于验证器的模式。

## Model Experience

无。Service Definition 只声明抽象生命周期与持久事件词汇；提供方与工具消费者拥有所有面向模型的效果。

#### KV Cache 效果

无直接请求变更；消费者拥有任何提示片段或工具注册。
