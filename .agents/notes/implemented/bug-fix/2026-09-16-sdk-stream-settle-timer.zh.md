# Agent Note: SDK 客户端的流结算窗口会清理自己的定时器

Status: implemented

[English](2026-09-16-sdk-stream-settle-timer.md) | 中文

## 问题

`HarnessClient.settleStreams()` 用 `Promise.race` 让 `streamsSettled` 与 `setTimeout(resolve, STREAM_SETTLE_MS)` 赛跑。race 会丢弃负方，因此每当 `streamsSettled` 获胜，那个 100 毫秒定时器就留在调度表里，既未清理也未 unref。针对已退出或启动失败的 runtime 的每次请求，都会在抛 `TransportClosedError` 之前执行该方法，于是每次调用都挂上一个悬空定时器。批量关闭大量会话会按会话各发一次这样的请求，累积的定时器让 Node 事件循环在最后一个客户端结果之后仍活跃最多 100 毫秒。

## 决策

`settleStreams()` 直接构造 promise：它调度定时器，并在 `streamsSettled` 先结算时清理该定时器再 resolve。

可观察的等待时长不变——调用方仍最多等待 `STREAM_SETTLE_MS`，`streamsSettled` 仍会缩短该等待。变化在于定时器不再比发起它的调用活得更久，因此一次死 runtime 请求不会给事件循环留下残留。若定时器先赢得等待，runtime 的 stdio 最终结算时，挂在 `streamsSettled` 上的处理会清理一个已经触发过的定时器。

## 考虑过的替代方案

**只给定时器加 `unref()`。** 否决：句柄仍会占满整个窗口并在请求间累积；unref 只是让定时器不阻止进程退出，这比「根本不产生这份待办」弱得多，也回避了泄漏报告的要点——按调用累积。

**去掉定时器，只 await `streamsSettled`。** 否决：该窗口的存在正是因为 runtime 死亡时 stdio 未必结算——存活的后代进程占着管道会让 `stderr` 与退出边沿分离——去掉上界就把「死 runtime 失败」变成永不返回的请求。

**把定时器从按调用改为按 runtime 复用。** 否决：该窗口界定的是调用方的等待，同一死 runtime 上的并发请求各自需要自己的截止时间。

**保留定时器并把代价写进文档。** 否决：它不是 `STDERR_TAIL_LIMIT` 那种配置化保留量；它只服务一个调用方的等待，没有理由比该等待活得更久。

## 结果

死 runtime 请求如今仍与之前一样，在 `streamsSettled` 与 100 毫秒上界之间等待，且不再留下已调度的定时器。

客户端依旧无法取消结算等待：需要比 `STREAM_SETTLE_MS` 更短上界的调用方没有可用的手段，这一点不因本决策而改变。

## 测试

`packages/sdk/client/tests/sdk-client.spec.ts` 钉住验收路径：在观察到 runtime 死亡后装载假定时器，此时针对该死 runtime 的请求以 `TransportClosedError` 拒绝，且 `vi.getTimerCount()` 为 `0`。对原先的 race 实现，同一断言会报出那一个悬空定时器。
