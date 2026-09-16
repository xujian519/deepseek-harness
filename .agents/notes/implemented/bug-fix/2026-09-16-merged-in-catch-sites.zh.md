# Agent Note: 为合并带入的空 catch 站点指名被吞掉的失败

Status: implemented

[English](2026-09-16-merged-in-catch-sites.md) | 中文

## 问题

`AGENTS.md` 要求空 catch 指名它吞掉了什么、以及为什么别的路径到不了。Issue #85 关闭时，`src` 内每一处 `catch(() => {})` 站点都已按两批确立的六种形态判定完毕（[生命周期批](2026-09-12-lifecycle-catch-sites.zh.md)与[跨包批](2026-09-12-cross-package-catch-sites.zh.md)）。

此后上游 v0.1.6-alpha.1 合并带入了从未被扫描过的包组——`ssh/`（首次提交 2026-09-11）、`ptc-runtime/`（09-12）与 `experimental/browser-use-stagehand-native`（09-12）——其中的站点正是按同样形态写的，却没有附任何理由。24 处 `src` 站点丢弃了拒绝，而站点处没有任何文字说明丢的是哪一个、以及为何该丢弃是可收敛的。

## 决策

7 个文件、5 个包内的 24 处站点现在紧邻丢弃语句指名被丢弃的失败：`ssh/ssh`（15）、`ssh/subprocess-ssh`（6）、`ssh/fs-ssh`（1）、`ptc-runtime/ptc-runtime-node`（1）、`experimental/browser-use-stagehand-native`（1）。

这些站点落入既有六种形态中的五种，本批没有新造形态或措辞。

- **自身仍有消费方的 promise 上的未处理拒绝防护**（6 处：`ssh` 的 `track()`、`helper-processes` 的两条完成链与其 `connected.promise`、`subprocess-ssh` 的进程 `done` 与终端 `done`）：该防护只覆盖消费方挂载之前的窗口，而 `dispose()`/`done()` 本就会收到该结果。
- **没有观察者的 best-effort 工作**（5 处：`ssh` 中套接字关闭后的转发取消；`helper-processes` 的预备超时释放、转发的终端输出与 stdin 转发；`subprocess-ssh` 的 `live` 记账）：该效果缺失不改变调用方能据以行动的任何东西——进程结果或下一轮清理才是权威。
- **不得顶替主错误的清理**（9 处：`ssh` 中 `disposeOnce` 的 `ready`；`helper-processes` 的缺控制通道丢弃、两条被 join 的转发流，以及 `preparing`/`start` 的 join；`subprocess-ssh` 的终止 join 与两处 helper 租约释放；`fs-ssh` 的流关闭）：调用方收到的是那个已上报的错误。
- **被弃置的请求或响应**（2 处：`subprocess-ssh` 的 abort 处理与 `browser-use-stagehand-native` 的 abort 清理）：调用方自己的 abort 是权威，且被中止的工作已无观察者。
- **teardown 对正在终结的进程做 join**（1 处：`ptc-runtime-node` 的 `handle.done`）：`waitForExit()` 是本次 teardown 的证据，而该次运行自身的失败或值已结算。

无行为改动：只有注释，因此没有任何可观察行为依赖本批。

## 考虑过的替代方案

**为每处被丢弃的拒绝记日志。** 沿用前两批的否决理由，并结合本批站点说得更利落：防护型站点的拒绝仍会到达其等待者，记日志等于重复调用方已经处理的失败；而定时器驱动的超时释放与各 abort 处理，根本没有用户或调用方会去读的落点。

**抽取诸如 `settleQuietly(handle)` 的具名辅助函数。** 否决：防护形态保留了 promise 的消费方，而被弃置请求形态一个消费方都没有，同一个辅助函数必须猜它手里拿的是哪种 promise；理由也只在丢弃发生处才读得通。

**加一道机械门禁来强制该规则。** 否决：唯一可机械判定的信号是「catch 附近有一行注释」，而本批站点表明这个代理会误判——`client/synapse/src/client/index.ts:185` 的理由紧邻拥有该 `catch` 的语句，因该语句跨了一个多行对象字面量而位于 `catch` 上方六行，所有按行窗口扫描都会把它报成缺理由。以代理为门禁会促使作者为检查器写注释，而不是为读者写，因此本议题仍为手动批次。

**改站点本身，而不是给站点加注释。** 否决：传播一次失败的转发、超时释放或 abort 侧终止，会顶替调用方收到的结果，而这些丢弃拒绝的界面本来就没有上报的地方。

## 结果

合并后 `src` 总体重新做到自描述，六种形态仍是新站点据以判定的词汇。

理由仍是编译器无法检查的散文：重构一旦移动这些调用之一就必须带上它的注释；而以已知形态新引入的真正被吞掉的失败，在评审者读到所记责任方之前看起来像是已被预先批准。

议题清单记的是 23 处；按同一规则判定当前树得到 24 处，多出的是 `helper-processes.ts` 的预备超时释放，其证据清单遗漏了它。

## 测试

对五个包执行 `pnpm exec vitest run`（47 个文件，470 通过、1 跳过）。注释不可能改变运行期行为，故不欠快照。

## 相关

- [为其余 catch 站点指名被吞掉的失败](2026-09-12-cross-package-catch-sites.zh.md)——确立形态词汇并关闭 Issue #85 的那一批。
- [为生命周期空 catch 站点指名被吞掉的失败](2026-09-12-lifecycle-catch-sites.zh.md)——第一批，以及本批复用的词汇。
- [在仓内 Issue 中跟踪技术债](../process/2026-09-11-tech-debt-issue-tracking.zh.md)——产出该发现的扫描实践。
