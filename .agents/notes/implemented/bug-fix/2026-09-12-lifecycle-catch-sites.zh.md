# Agent Note: 为生命周期空 catch 站点指名被吞掉的失败

Status: implemented

[English](2026-09-12-lifecycle-catch-sites.md) | 中文

## Problem

`AGENTS.md` 要求空 catch 指名它吞掉了什么、以及为什么别的路径到不了。2026-09-11 的扫描发现 `src/` 下有 62 处 `catch(() => {})` 没有任何说明,且集中在进程与会话生命周期路径上,于是读者无法区分「刻意的 best-effort 清理」与「真正的失败被丢掉」。扫描点名两个包应优先判定,因为它们拥有这些生命周期:`core/agent-loop`(7 处)与 `subprocess/subprocess-local`(8 处)。

逐处读完这 15 处后可见,扫描「全都没有说明」的说法过宽:四处已经写明了理由。`agent-loop` 在其回滚的 dispose 与 close 上方写着「Rollback swallows a disposal rejection: the setup failure is primary」,`spawn.ts` 写明 `terminate()` 让共享的 range 观测拒绝仍可交给 `waitForExit()`、同时不泄漏未处理拒绝。剩下十一处没有说明。

## Decision

这十一处被丢弃的拒绝都是无人能据以行动的失败,现在每一处都就地写明了这一点。站点分五种形态:

- **setup 失败后的回滚**(`agent-loop/src/index.ts` 的 `create` 与 `setupAndPublish`):setup 失败是调用方必须看到的主错误,因此 close 的拒绝被丢弃,而不是让它顶替主错误。措辞与该文件中已说明的两个回滚站点一致。
- **句柄因取消而失去属主**(`createAgent` 的 `raceAbortCall` 弃置回调):调用方收到的是自己的中止,而该句柄是在中止之后才创建完成的,因此这次 close 没有观察者。
- **`finally` 中的 close**(`resumeWith`):该块的结局——已发布的 agent,或让块解开的那个错误——已经确定。
- **teardown 对自己正在终结的进程做 join**(`disposeManagedProcesses`,以及把普通句柄与 terminal 句柄注销的 `release` 回调):直接结果属于启动该进程的调用方,`waitForExit()` 才是 teardown 自己的证据并经 `Promise.allSettled` 上报(或被抛出),而 range 等待失败时句柄仍留在集合里,teardown 依旧会强制结束它。
- **自身仍有消费方的 promise 上的未处理拒绝防护**(`WindowsJobOwner` 构造函数、`terminal.ts` 结算后的属主清理、`spawn.ts` 的延后属主清理、`managed-owner.ts` 的 `waitWithAbort` 预中止分支):失败仍会到达等待原 promise 的一方,或者调用方已经被告知等待未完成,因此这层防护只是避免浏览器/Node 噪声。

## Alternatives considered

- **抽出 `settleQuietly(handle)` 供所有站点调用**,如该发现所建议。否决:这五种形态丢弃失败的理由各不相同,而理由只有写在丢弃处才可读;helper 还需要一个包作为归宿,而 `dsh-value` 收纳的是未知输入原语,不是生命周期策略。
- **为每一处被丢弃的拒绝落日志。** 对「失败已由别的路径上报」的站点否决(回滚的 setup 错误、调用方的中止、teardown 的聚合):日志会与调用方已看到的失败重复。对防护类站点,该 promise 的拒绝仍会到达它的等待者,日志只会增加噪声而不增加信息。
- **把 62 处的发现当作一个改动处理。** 否决:其余 47 处分布在 20 个包里,各自有自己的生命周期(subagent 桥、LSP stdio、OpenViking、e2b、浏览器 UI),逐处判定需要与本次相同的阅读量。Issue #85 为它们保持开放。
- **修正发现里的计数,而不是修站点。** 否决:计数不是缺陷,缺失的理由才是。

## Consequences

两个生命周期包里的静默站点现在都能自述,这五种形态也为其余 47 处提供了判定词汇。行为未变:本次只有注释,因此没有可观测结果依赖它。代价是这些理由属于编译器无法校验的散文——后续重构若移动这些调用之一,必须把注释一并带走;而同形态新增的、真正丢失的失败会看起来像已被批准,除非评审者去读注释里写明的属主。

## Testing

`pnpm exec vitest run packages/core/agent-loop packages/subprocess/subprocess-local`——685 passed、13 skipped。改动上还跑了 `pnpm run typecheck`、`pnpm run lint` 与 `pnpm run duplication`;注释无法改变运行期行为,因此不欠快照。

## Related

- [在仓内 Issue 中跟踪技术债](../process/2026-09-11-tech-debt-issue-tracking.zh.md)——产出该发现的扫描,记录在 Issue #85。
- [abort 与键集下沉](../architecture/2026-09-12-abort-and-keyset-sink.zh.md)——同一扫描的原语收敛批次。
