# Agent Note: projection-cache 的落盘断言改为轮询而非固定睡眠

Status: implemented

[English](2026-08-30-projcache-durable-write-poll.md) | 中文

## 问题

`session-projection-cache` 的测试在断言落盘结果前固定等待 40 毫秒。这些断言背后的写入链包含两次 fsync（记录文件与其父目录），在全量测试并行 worker 的负载下尾延迟超过任何固定时长：同一 spec 在最近两次本地全量与一次 CI 中各失败一次，且都失败在正断言上——行仍停在 creation cut，或 `fresh` 的记录文件尚未出现（`storedRows` 把「不可读」折叠为 `undefined`，rename 中间窗口不可见）。负断言从来不是失败点。

## 决策

正的落盘断言改为经本地 `eventuallyDurable` helper 用 `vi.waitFor` 轮询（10 秒预算、10 毫秒间隔），与 session-persistence 测试已用的 `vi.waitFor` 惯例一致。40 毫秒的 `settle` 睡眠只保留给负断言（「该窗口内未写」）——负断言处等得越久越严格；其注释现在说明了这一点。

## 后果

该 spec 不再依赖墙钟运气：两个曾经 flaky 的断言会重试到原子 rename 发布该行为止，而真实回归在 10 秒预算后仍以断言自身的消息响亮失败。

## 落选方案

**像 interval 测试那样用 fake timers 驱动写链。** 拒绝：fake timers 推进时钟但无法给出真实 IO 完成的信号——断言观察的是 fsync-and-rename 链，不是计时器。interval 测试之所以确定，是因为它把 `write` spy 成了已解决的 mock；这些测试断言的是真实耐久协议，而这正是被测对象。

**手写对 `storedRows` 的轮询循环而非用 `vi.waitFor`。** 效果等价；选 `vi.waitFor` 因为它是内置的、且是相邻 session-persistence 测试的既有惯例，spec 除薄薄的预算包装外不新增 helper。
