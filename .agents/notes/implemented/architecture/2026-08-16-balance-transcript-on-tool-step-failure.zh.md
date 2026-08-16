# Agent Note：工具步骤中途失败时平衡会话转录

状态：implemented

[English](2026-08-16-balance-transcript-on-tool-step-failure.md) | 中文

## 问题

轮次在记录了 assistant `tool_calls` 消息之后、记录对应 `tool/result` 事件之前出错，转录便处于悬挂状态：下一次请求带着带 `tool_calls` 却没有对应 tool 消息的 assistant 消息，提供方以 `An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'` 拒绝，模型根本看不到失败。此后每次重试都以同样方式失败，会话只能靠分支或新建来恢复。

此问题由（已修复的）双副本调度器 bug 在工具管线内抛错时暴露：循环已记录 `tool/call` 并以错误关闭轮次，悬挂的 assistant 消息污染了该会话之后的所有请求。

## 决策

在 `dsh-agent-loop/tool-calls.ts` 中，调度器失败路径在重新抛出前，为本组所有未提交的工具调用记录合成错误结果：未记录 `tool/call` 的调用用 `TOOL_NOT_STARTED`，已开始的调用用 `TOOL_OUTCOME_UNKNOWN`（与 `dsh-session` 崩溃恢复的修复词汇一致）。assistant `tool_calls` 消息因此天然保持平衡，下一次请求被接受，模型能看到失败并在重试时作出反应。

## 备选方案

**在表面投影层丢弃悬挂的 assistant 消息。** 派生消息缓存假设节点投影一旦折叠即稳定；悬挂状态可能被后续追加的结果满足，配对感知投影需要在每次追加时失效缓存，并破坏请求重建。在投影层做静默转录手术也违反逐字直通的契约。不采纳。

**在日志尾部追加结果以修复已损坏的日志。** 已用 DeepSeek API 实证：tool 消息必须紧跟在 tool_calls 消息之后，因此对转录中段的悬挂调用，尾部追加无法满足；追加式日志也不能插入。不采纳；损坏会话通过分支或新建恢复。

**改在机器轮次错误路径做平衡而非组内。** 能覆盖组边界之外的失败（例如在记录任何调用前 `executionMode` 抛错），但扩大改动面；组级修复直接在损坏点落实文档化的调度器失败契约。更广的兜底留作后续候选。

## 影响

- 新增回归测试驱动组中段的调度器失败，并断言每个 assistant `tool-call` 块都带有合成错误结果。
- `dsh-agent-loop`、`dsh-tools`、`dsh-session` 共 999 个测试通过；typecheck 与 lint 干净。
- 已对真实提供方验证：紧邻的合成结果形态可被接受。

## 剩余风险

- 被原始 bug 损坏的会话（转录中段的悬挂调用）无法就地修复：追加式日志不能重排，且提供方要求 tool 消息紧跟在 tool_calls 消息之后。可在损坏消息之前分支会话或新建会话恢复。
- 在组边界之外抛出的失败（步骤中任何调用记录之前）仍可能留下未应答的 assistant `tool_calls` 消息；在循环轮次错误路径做机器级平衡是候选后续项。
