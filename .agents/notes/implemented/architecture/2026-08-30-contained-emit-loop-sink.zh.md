# Agent Note: H7 收敛——受控派发循环（`dsh-contained-emit`）

Status: implemented

[English](2026-08-30-contained-emit-loop-sink.md) | 中文

## 问题

九个包里的十个通知点手写了同一个循环：在 Cordis 派发之外解析监听器快照、逐个调用回调、捕获同步抛出、观察返回的 promise——三种漂移的日志风格（`listener rejected/threw`、tools 的 `observer failed`、session 的 `dispatch threw`）与两种错误渲染器（`String`、`errorMessage`）。这个模式的全部意义在于监听器失败绝不能让后续监听器失去执行机会、也绝不能以未处理 rejection 的形式到达进程，因此每一份分歧的副本都是一次独立犯错的机会；jobs-local 的 `onJobsChanged` 已经丢掉了异步分支。另有两处（agent 与 session 的 created 公告）使用另一种有意契约：同步抛出传播以否决发布，只有返回的 promise 被受控。

## 决策

- 新建零依赖包 `@deepseek-ai/dsh-contained-emit`，提供 `invokeContained(ctx, label, callbacks, args, render)`（循环本体）与 `emitContained(ctx, label, args, render)`（cordis `events.dispatch('emit', args)` 加循环本体，接受与 `ctx.emit` 相同的参数形态——dispatch 对 carrier 与事件名的 shift 即完成 payload 提取）。
- 渲染器是注入参数，而非固定格式：多数调用方传 `errorMessage`；agent-loop 注入 `errorChain` 以在 config 启动失败告警中保留 cause 链；subagent 注入带类名的 `renderThrown`。日志标签同样由调用方持有，因此 `agent "${id}": agent/disposed` 这类既有前缀逐字保留。
- 收敛十个循环：core agent（事件派发、`agent/disposed`）、core session（共享的 observe/dispose 快照调用器）、agent-loop（config-start-failed）、tools（`tools/result`）、skill（`skills/change`）、workflow（`emitWorkflowEvent`）、interaction commands（`commands/change`）、subagent lifecycle、jobs-local（`onJobsChanged`、`onJobDone`——后者获得了它原先泄漏的受控异步拒绝）。jobs-local 用 `Iterable<ContainedListener>` 断言传递自有注册表的监听器迭代器；循环从不要求事件总线。
- 按契约保留本地：两处 created 公告（veto 语义）、schedule 的 durable-change 通知（单回调非列表）、以及没有 `ctx.logger` 的客户端侧 `console.error` 循环（gateway remote-events、client connection、webworker vfs）。
- 可观察文本变化：`String(error)` → `errorMessage(error)` 对 Error 值去掉 `Error: ` 前缀（九处钉点断言更新）；tools 的单句式 `observer failed` 变为双句式 `listener rejected`/`listener threw`；jobs 的 `onJobDone listener rejected for ${id}` 变为 `onJobDone for ${id} listener rejected`。

## 后果

H7 关闭，containment 要求活在一个经过评审的循环里。台账的共享原语清单已落地五分之三（util 值原语、abort 竞速、containment）；recovery-vocabulary（H6）与 ResolvedConfig（M2）仍在。

## 已论证的备选方案

**给 vendored cordis 加 `emitContained`。** 否决：vendored 树是钉住的上游副本，harness 专属的 containment API 会扩大每次 sync 都要重新应用的本地修改面，而这个工具只有 harness 包消费。

**把 `errorMessage` 烤进循环。** 两层否决：`util/` 组的零运行时依赖规则禁止依赖 `dsh-value`；且渲染器是真实契约——config 启动失败告警需要 `errorChain` 的 cause 链、subagent 的告警携带类名——固定渲染器要么降级这些日志，要么逼那两个循环留在本地。

**给循环加 veto 旗标并折入 created 公告。** 否决：veto 路径的本质是同步抛出要传播，而这恰恰是受控循环要阻止的行为。旗标会让两种契约之间这个安全攸关的差异在调用点不可见。
