# Agent Note: Latch a waking send that lands after the driver's last inbox claim

Status: implemented

[English](2026-10-16-agent-loop-last-claim-wake-latch.md) | 中文

## Problem

`node 24 / snapshots` 车道上，`replays subagent-list-agents through dsh --profile sdk` 一次失败：该用例耗尽完整 120 s 预算，以 `Test timed out in 120000ms` 失败，而同一车道其余 224 个用例正常完成。同一提交重跑即通过；在该分支谱系的每一次 CI 记录中，这个场景都在 1–3 s 内完成；本地 60 次单用例运行加 24 次并行负载下的整文件运行也从未复现。因此这是时间相关的失败，不是合并后代码树的属性。

排查发现驱动退出路径上一个确定性缺陷。在一次活动中，驱动完成最后一次 inbox 认领之后、进入 idle 之前落地的唤醒投递（`followup` 或 `steer`）永远不会被认领，也不会再次唤醒驱动：消息滞留在待处理状态，agent 停在 idle，等待该输入对应 turn 的调用方一直等到自己的期限。`send` 依据 `this.phase` 判断唤醒，而此时它仍是 `running`；`wakeDriver` 直接返回而不设 latch（此前只有维护中和中止后的投递会设 latch），并且已无 step 边界可以认领该消息。

该场景的唤醒正是这一形状：continuation manager 把后台可续子会话的结算通知投递给它的父会话，而子会话的进程内调用链可能在父会话 turn 结束旁边解析完成。通知落进这个窗口时，父会话永远不会跑第二个 turn，于是 SDK 快照测试框架一直等该 turn 的 `turn/end`，直到测试预算耗尽。投递目标也解释了不幸运行可能呈现的两种形态：当 step 边界仍然敞开时落地的通知会按 steering 被认领并改变录制日志，而落进退出窗口的那一种此前会挂起。

`packages/core/agent-loop/src/agent.ts` 与 upstream 在 `dsh-v0.2.1-alpha.5` 时完全一致，因此本 fork 的车道是继承了该缺陷，而不是引入它。

## Decision

running 阶段携带 `claimsClosed`：驱动取到那次发现 inbox 为空的认领时置位，同一驱动继续进入下一个 turn 时清零。`wakeDriver` 在三种情况下设 latch：阶段为维护中、投递发生在中止之后、或阶段为 running 且 `claimsClosed`；收敛时既有的重放随后启动驱动，其第一个 pre-step 认领该消息。

`inject` 保持其既有边界：它从不唤醒驱动，因此落进该窗口的上下文保持待处理、等待下一次唤醒，而不会开启 turn。因决策而非空队列而停止驱动的两个出口同样保持行为不变——首次认领被拒绝、以及唤醒消息在认领前被清空，都让已暂存输入保持待处理，`packages/core/agent-loop/tests/interception.spec.ts` 已把它们钉为有意行为。

## Consequences

唤醒投递不再可能因驱动退出而丢失，因此投递时机不再决定消息是否会被执行。本 fork 由此在一个核心循环文件中与 upstream 分叉；该分叉是一个阶段字段、一个 latch 条件、以及一组赋值，每次 upstream 同步都必须重新核对，并在 upstream 发布等价修复后将其退役。

暴露该缺陷的场景仍在更窄的范围内对时机敏感：manager 为结算通知选择哪个 inbox 边界（父会话 idle 时为 `queue`，running 时为 `steer`）决定录制中所含的 splice，因此一次不走运的重放仍可能失败于日志比对。但它不再可能永久等待，因为被 latch 的唤醒总会启动认领它的那个 turn。

## Alternatives considered

**在 idle 转换时对每条待处理消息设 latch。** 否决：`inject` 有意让上下文保持待处理而不唤醒驱动，为注入上下文启动 turn 会破坏该边界；一个在每轮 turn 都注入的 pre-step 监听器甚至可能让驱动永不收敛。

**在 `kick()` 的 finally 中只要 inbox 非空就重启驱动。** 同样否决，理由相同；而且它会丢掉重放的抑制规则——消息在 idle 转换前已被移除的 latch 唤醒不得启动 turn。

**由本 fork 的 subagent manager 在父会话持续滞留时重新投递通知。** 否决：manager 观察到的是 `Agent.status`，它无法区分“活跃驱动将在下一个 step 认领该消息”和“驱动已取走最后一次认领”，于是会在本应正常的投递上重复投递。

**只报告缺陷、不加改动。** 否决：本 fork 自己的合并门禁会因此偶发失败，upstream 的 issue 跟踪器在本仓库的 remote 上不可达，而该修复足够小，可以附带明确的退役条件承载。

## Testing

`packages/core/agent-loop/tests/loop.spec.ts` 新增两个用例。`runs a waking send that lands after the driver took its last inbox claim` 在最后一条 `turn/end` 追加期间排入一个微任务来发送消息——这是该窗口的确定性形式——断言消息落地时阶段仍为 running，并要求该消息作为自己的 turn 执行；去掉该阶段字段时它会失败。`leaves injected context in the same window pending for the next wake` 钉住第一个用例不得越过的边界。

`pnpm exec vitest run --coverage --coverage.include='packages/core/agent-loop/src/agent.ts' packages/core/agent-loop/tests/` 通过 453 个用例，该文件的语句、分支、函数、行覆盖率均为 100%。

## Related

- [Name the awaited state when a snapshot-harness wait times out](../../implemented/testing/2026-09-12-snapshot-wait-diagnostic.zh.md) —— 同一失败族此前的改动：让无界等待报出它等待的状态，而不是库的消息。
