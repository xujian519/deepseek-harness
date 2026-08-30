# Agent Note: M1 最后一个收敛点——abort-race 原语（`abortable`）

Status: implemented

[English](2026-08-30-abortable-abort-race-sink.md) | 中文

## 问题

台账的 abort-race 行记录了横跨三种取消语义的五份包装器。本次改动前的重新扫描发现该行已过时：e2b 的两份副本（`withinMs`、`waitWithSignal`——哨兵结果）已随上游更新删除，不复存在。剩下三份：skill 的 `waitWithAbort`（拒绝 `toError(signal.reason)`，并按 skill 公开契约「它逃逸的一切都以 `Error` 结算」同时强转 provider rejection）、terminal-bash `startupSession` 的手写竞速（注册 `once` 中止监听器拒绝 `signal.reason`，外加一个内联的 pwsh deadline 负责取消未完成的发送），以及 subprocess-local 的 `waitForExit`（中止时 resolve `false`——是查询，不是取消）。每一份都在重复 `dsh-timeout` 包本应拥有的监听器注册样板。

## 决策

- `dsh-timeout` 新增 `abortable<T>(promise, signal): Promise<T>`，采用标准取消语义：signal 缺省时原样返回 promise；已中止或中途中止时以 `signal.reason` 原样拒绝——与 `throwIfAborted` 抛出的值完全相同；被包装 promise 的 rejection 总是通过配对的处理器被消费，因此迟到的 rejection 与中止时的 rejection 都不会以未处理形式浮现；任一方先结算即移除监听器。
- skill 的 `waitWithAbort` 折叠为四行适配器，保留 `Error` 契约（`signal === undefined` 原样直通，与旧快速路径一致；rejection 路径用 `toError` 强转）。skill 全部既有中止测试——`rejects.toBe(reason)`、hostile-reason 占位钉点——原样通过。
- terminal-bash 的 `startupSession` 用 `abortable` 删除了监听器样板；pwsh deadline（timer + `startupOperation.cancel()`）保持内联，因为它是超时语义而非取消。`TODO(pty-initialize-race-home)` 维持不变：把竞速折进 `LocalPtySession.initialize` 仍是 send-state consolidation 的工作。
- subprocess-local 的 `waitForExit` 保留本地：中止时 resolve `false` 回答的是「进程树退出了，还是我们放弃等待了」——压缩进布尔值的三态查询，不是取消竞速。

## 后果

M1 每一行都记录了关闭；台账的原语清单全部落地。abort-race 语义有了唯一归属：只发通知的取消加信号自身的原因，与 `dsh-timeout` 声明的边界一致——库负责通知，能力自己停止自己的工作。

## 已论证的备选方案

**让 canonical 的 rejection 是 `Error`（在 `abortable` 内做 `toError(signal.reason)`）。** 两层否决：`util/` 组的成文约束是「no runtime dependencies, invariant-companion peer only」，`dsh-timeout` 不能依赖 `dsh-value`；且原样转发原因使该 rejection 与同一信号上 `throwIfAborted` 抛出的值完全一致。需要 `Error` 形态逃逸的调用方——skill——保留带钉点测试的本地适配器。

**用 catch 把中止 rejection 映射为 `false`，把 `waitForExit` 折到 `abortable` 上。** 否决：这个转换要从捕获值里重新推断「这是不是那次中止」，恰恰是 resolve-false 形态刻意避开的歧义，且结果并不比现在的监听器块更简单。

**在 send-state consolidation 把竞速折叠掉之前不动 terminal-bash。** 否决「以此为理由跳过收敛」：把样板换成 `abortable` 今天就是机械动作，并让后续折叠变成纯删除。
