# Agent Note: 补齐 Claude Code 与 Codex hook 桥接的行为缺口

Status: implemented

[English](2026-09-12-hook-bridge-gaps.md) | 中文

## 问题

`dsh-hooks-claude-code` 与 `dsh-hooks-codex` 两个桥接已经把受支持的 hook 事件（Claude Code 为 7 个，Codex 为 5 个）实现为 harness 拦截扩展点，但参考工具的三项可观察行为仍然缺失：

1. **Session-start 上下文可能错过第一个请求。**`SessionStart` hook 在 `agent/session-start` 上脱离运行，把上下文注入会话而不等待第一步。一个稍慢或稍有延迟的 hook 可能在 agent 已经组装好第一个模型请求之后才返回，因此添加的上下文直到第二步才可见。

2. **阻塞式 `Stop` hook 可能永远强制 continuation。**两个桥接在 `Stop` hook 阻塞时都会 steering `continue`，但它们没有统计 `Stop` hook 已经强制了多少次 continuation。因此一个无条件阻塞的 stop hook 会无限循环，每次 stop 事件都多产生一个模型轮次。

3. **`{"continue": false}` 只被记录，未在运行级执行。**`UserPromptSubmit` 或 `PostToolUse` hook 返回 `{"continue": false}` 时只会被记录并警告，运行却继续。参考工具把它视为运行停止信号，因此期望该行为的 hook 作者会看到自己的指令被忽略。

这些缺口由 Issue #81 跟踪。

## 决策

两个桥接现在以相同机制对称实现于 `packages/hooks/hooks-claude-code/src/index.ts` 与 `packages/hooks/hooks-codex/src/index.ts`：

### Session-start 投递门控

`agent/session-start` 不再直接注入上下文。桥接改为启动脱离的 `SessionStart` 运行，并把生成的 `MergedHookOutcome` promise 存入每个 agent 的 `sessionStartGates` map。第一个 `agent/pre-step` 监听器 await 该 gate；若 outcome 包含被接纳的上下文，则把这些上下文消息 prepend 到该 step 的 admitted messages 中。

这样保留了脱离执行模型——`SessionStart` 不会阻塞会话启动——同时保证第一个模型请求能看到 hook 提供的上下文。gate 会一直保留到某个 step 消费它，因为 hook 通常在首个提示词到达之前就已 resolve；未被消费的 gate 随其 agent 一并丢弃。第一个 step 消费 gate 后，后续 step 不再看到存储的 outcome，上下文也不会重复投递。

### Stop-loop 防护

新增配置字段 `maxStopContinuations`，默认 `10`，并通过 `assertPositiveInteger` 校验。每个桥接为每个 agent 维护一个 `stopLoops` 计数器。在 `agent/turn-stopping` 中，阻塞式 `Stop` hook 强制 continuation 时会递增计数器；当计数器已大于 0 时，`stop_hook_active` 为 `true`。当计数器达到 `maxStopContinuations`，桥接调用 `agent.cancel({ kind: 'hook', reason: '...' })` 取消运行，而不是再 steering 一次 continuation。

计数器会自然重置：它只在 `agent/turn-stopping` 路径中被读取和递增，而 agent 在下一个非 stop 轮次结束运行，因此新的 stop 序列从 0 开始。

### 运行级停止

每次 hook 调用产生 merged outcome 后，桥接检查 `merged.stop`。当 `stop` 为 true 时，调用 `agent.cancel({ kind: 'hook', reason })`，并把 hook 决策映射为当前扩展点的合适拒绝：被阻塞的提示词以 `blocked` 结束该轮次，被阻塞的 pre-tool 变为 `deny`，被阻塞的 post-tool 变为带 hook 原因作为反馈的 `deny`。

两个桥接都监听 `agent/disposed`，从 `sessionStartGates` 与 `stopLoops` 中移除对应 agent 的条目。

## 考虑过的替代方案

**让第一步同步等待 `SessionStart`。**否决：桥接刻意让 `SessionStart` 脱离运行，以免慢 hook 挂起会话启动。同步等待会违背该设计，并可能在 hook 异常时让会话无响应。

**第一次强制 continuation 就取消。**否决：参考工具允许多次连续 stop-hook continuation，合理的 hook 会用它进行少量继续以推动模型越过过早停止。硬上限为 1 会破坏有用的配置。

**`maxStopContinuations` 默认无上限。**否决：无上限默认值无法关闭无限循环缺口。`10` 与 harness 类似安全边界的数量级一致，且足够高，合理的 nudging 配置极少触及。

**把 `{"continue": false}` 实现为事件特定行为，而非运行级取消。**否决：`UserPromptSubmit` 与 `PostToolUse` 的 `{"continue": false}` 参考语义是停止运行，而非跳过一步或阻塞一个工具后继续。运行级 `agent.cancel` 是最接近的 harness 等价物，也能避免 invent 每种事件的停止方言。

## 结果

`SessionStart` 上下文现在可靠地在第一步可见。`Stop` hook 仍可强制 continuation，但失控 hook 会被上限截断并取消运行。`UserPromptSubmit` 或 `PostToolUse` 的 `{"continue": false}` 现在会停止运行，而不是被记录后忽略。

新增的 `maxStopContinuations` 字段出现在两个桥接配置及其生成的配置目录中。每个 agent 的 map 为桥接增加了少量状态；dispose 监听器保证这些状态不会跨越 agent 生命周期泄漏。

## 测试

`npx vitest run packages/hooks/hooks-claude-code/tests/bridge.spec.ts packages/hooks/hooks-codex/tests/bridge.spec.ts` 在两侧覆盖四种行为：

- `UserPromptSubmit` hook 返回 `{"continue": false}` 会取消运行。
- 从不自我限制的阻塞式 `Stop` hook 在 `maxStopContinuations` 次强制 continuation 后被取消。
- 慢 `SessionStart` hook 仍会把上下文交付给第一个请求。
- 在首个提示词之前就已 resolve 的 `SessionStart` hook 仍会交付其上下文，证明 gate 会保留到某个 step 消费它。

现有测试 harness helper 接受可选的 `pluginConfig` partial，使 stop-loop 测试能在不改动 shipped 默认值的前提下调低 `maxStopContinuations`。

## 相关

- [Claude Code hook bridge](../../../../packages/hooks/hooks-claude-code/README.zh.md)——受影响桥接的用户级合约。
- [Codex hook bridge](../../../../packages/hooks/hooks-codex/README.zh.md)——受影响桥接的用户级合约。
- [拦截扩展点](../feature/2026-06-30-interception-extension-points.zh.md)——桥接所映射的类型化 Decision 表面。
