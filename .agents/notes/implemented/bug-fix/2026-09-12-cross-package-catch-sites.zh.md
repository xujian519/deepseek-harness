# Agent Note: 为其余空 catch 站点指名被吞掉的失败

Status: implemented

[English](2026-09-12-cross-package-catch-sites.md) | 中文

## Problem

`AGENTS.md` 要求空 catch 指名它吞掉了什么、以及为什么别的路径到不了。第一批覆盖了 `core/agent-loop` 与 `subprocess/subprocess-local`,留下 20 个包里的 47 处 `catch(() => {})`,并点名 `subagent/subagent-codex`、`memory/openviking`、`lsp/lsp-stdio` 为接下来优先判定的三个包。

逐处读完这 15 处后可见,`lsp/lsp-stdio` 已经收敛:五处全都带有紧邻的理由(`connection.ts` 写明 `write()` 已记录该失败并拒绝所有待决请求;`instance.ts` 写明握手拒绝不得在第一个查询等待它之前浮出)。这 15 处中十处已有说明、五处没有。把同一条规则——理由须紧邻吞掉失败的语句——套用到扫描其余部分,又找出八个包里的九处,而它们的形态本批已经覆盖。

## Decision

13 个包、17 个文件里的 21 处现在都就地写明了被丢弃的失败。扫描 `src` 口径下的每一处都得到了判定,且没有一处需要改行为:这些被丢弃的拒绝都是没有调用方能据以行动的失败。站点分六种形态。

- **自身仍有消费方的 promise 上的未处理拒绝防护**(`subprocess-e2b` 的 `readyState`、`done` 与 `completion`;`subprocess-e2b` terminal 的 `completion`;`llm-deepseek` 与 `attachment-local` 的 in-flight 清理;`subagent-claude-code` 的 `childProcessFailure`):失败仍会到达等待原 promise 或派生 promise 的一方,因此这层防护只覆盖那些消费方尚未挂上处理器的窗口——或在其挂上之前就抛出的启动路径。
- **没有观察者的 best-effort 工作**(`openviking` 的隔离改名,其解析问题才是上报给调用方的缺陷;它的 cadence 刷新,失败时保留上一份 map;`synapse` 的浏览器会话同步,下一次防抖轮次会重发完整列表;`synapse` 的过期锁 unlink,其结果由 `tryAcquire()` 上报):效果的缺失已由别的机制兜住。
- **不得顶替主错误的清理**(`better-sidebar` 的临时文件、`patent-document` 的 tmp 文件、`patent-tools` 的临时 PDF、`plugin-market` 的流取消):失败步骤的错误才是调用方收到的那个。
- **被弃置的请求或响应**(`subagent-codex` 的 `raceAbort` 预中止分支,调用方收到的是自己的中止;它的 `interrupt()`,没有调用方等待该响应):终局 turn 或进程结局才是权威。
- **teardown 对自己正在终结的进程做 join**(`subagent-codex` 与 `subagent-claude-code` 的 `dispose*Child`):`waitForExit()` 是 teardown 自己的证据,而句柄自身的失败已有其消费方。
- **没有上报面的 dispose**(`better-sidebar` 的关闭标签页):标签页已经消失,而 Session 仍然持久化。

扫描的计数是 `src` 内 62 处,而非 issue 记录的 63 处;差异是第一批就已记录的同一测量口径问题。

## Alternatives considered

- **抽出具名 helper,例如 `settleQuietly(handle)`。** 再次否决,理由更明确:防护形态要保留该 promise 的消费方,而弃置请求形态根本没有消费方,同一个 helper 必须猜自己拿的是哪一种;何况理由只有写在丢弃处才可读。
- **为每一处被丢弃的拒绝落日志。** 与第一批同理否决:这会与调用方已看到的失败重复;对防护类站点,拒绝仍会到达它的等待者。
- **把九处无紧邻说明的站点留给第三批。** 否决:它们的形态与本批站点相同,判定它们需要的阅读量也相同,再开一批只会让 issue 仅因散文而继续开放。
- **改站点而不是加注释。** 否决:把失败的临时文件清理或流取消传播出去,会顶替调用方收到的错误,而这些丢弃拒绝的位置本就没有上报面。

## Consequences

Issue #85 关闭,`src` 内每一处 `catch(() => {})` 都能自述,这六种形态就是判定新站点的词汇。行为未变:本次只有注释,因此没有可观测结果依赖它。代价依旧:这些理由属于编译器无法校验的散文——后续重构若移动这些调用之一,必须把注释一并带走;而同形态新增的、真正丢失的失败会看起来像已被批准,除非评审者去读注释里写明的属主。

## Testing

对十三个受改动包跑 `pnpm exec vitest run`,并跑 `pnpm run typecheck`、`pnpm run lint` 与 `pnpm run duplication`。注释无法改变运行期行为,因此不欠快照。

## Related

- [为生命周期空 catch 站点指名被吞掉的失败](2026-09-12-lifecycle-catch-sites.zh.md)——第一批,以及本批扩展的形态词汇。
- [在仓内 Issue 中跟踪技术债](../process/2026-09-11-tech-debt-issue-tracking.zh.md)——产出该发现的扫描,记录在 Issue #85。
