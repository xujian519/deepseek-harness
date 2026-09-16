# Agent Note: 实测后不值得加缓存的请求路径与转发成本

Status: implemented

[English](2026-09-16-unjustified-cache-costs.md) | 中文

## Problem

一次对本仓库的审计仅凭阅读代码就把六处逐步或逐请求的成本标为 P1/P2，并各自给出缓存或增量缓冲的改法：

- `system-prompt` 每次装配都克隆每个工具的 `parameters`，`headerEquals` 每次调用对每个工具 schema 序列化两次（每步两次调用）。
- `token-meter` 的 `measure()` 每次调用都深克隆并冻结整个计价 surface，每步一次，溢出的压缩步骤里最多四次。
- DeepSeek `messages` 协议每个请求都重新解析全部历史工具调用的参数。
- `OutputCollector.snapshot()` 在每次 SSH helper 的刷新往返里拼接整个保留 tail，而该往返本身就重发这整个 tail。
- `ptc-runtime-node` 对每个 stderr 分片用 `(stderr + text).slice(-maxOutputBytes)` 重建 stderr 累积串。
- 会话列表每次 `SessionPersistence.list()` 都从磁盘读取每个会话的 header。

这六项都没有被测量过。在决定之前，每一项都用真实代码与真实录制形状做了测量，没有一项能站住。

## Decision

六项全部保持原状。下面记录每一项的测量值，使后续审计在没有新证据时不会重新提出它，并记录会使它重新成立的条件。

同一次审计中有三项因为确实测出收益而被改动：[会话日志水位](../simplification/2026-09-16-session-log-watermark-from-log-length.zh.md)、[grep 预览范围](../simplification/2026-09-16-grep-preview-scope.zh.md)、[目录列出的子批次并发](2026-09-16-listing-child-batches.zh.md)。

## Alternatives considered

每条被否决的备选方案就是审计提出的改法，并以它实际能省下什么来衡量。

- **为工具 schema 克隆与 canonical JSON 加按身份索引的 `WeakMap` 缓存**（C1）。在本仓库录制的最大工具集上（33 个工具，`snapshots/web/cordis-tool-round`，33 KiB schema JSON），克隆每次装配 0.071 ms，99 个工具时 0.205 ms；两次 `headerEquals` 在 33 个工具时各 0.093 ms。已否决：一个步骤以秒计，这些都在其 0.05% 以下，而缓存会引入「提供方绝不就地修改工具 `parameters` 对象」的假设——当前的克隆并不需要这个假设。
- **为 `token-meter.measure()` 加按 revision 索引的缓存**（C2）。克隆并冻结计价 surface 在 200 节点时 0.14 ms、1,000 节点时 0.37 ms、5,000 节点时 1.8 ms。已否决：surface 受上下文窗口约束（数百节点），而这里一旦命中过期缓存就会改变 token 压力进而改变压缩决策——该风险与亚毫秒收益不成比例。
- **为历史工具参数解析加有界 `Map`**（C3）。每次解析 0.2 µs，即携带 500 条历史调用时每请求 0.10 ms。已否决：缓存需要自带上限，否则会长期保留长会话的参数。
- **给 `OutputCollector` 加增量维护的 tail 缓冲**（D1）。在 20 MiB tail 上限下，拼接占一次刷新 1.27 ms 中的 0.21 ms；同一 tail 的 base64 占 1.06 ms，而网络侧每个往返都发送这整个 tail。以 5 ms 往返回放 helper 的刷新循环、输出 20 MiB 时，拼接 104 ms、base64 304 ms。已否决：它移除的是一个以「两侧全量 base64 + 传输字节」为主的成本中约 25% 的部分，却要把收集器的分片列表换成环形缓冲，重做由逐字节测试守护的落盘路径。真正划算的修法是增量帧（发送方只流式发送上次已确认偏移之后的字节），而被批准的方案已将其作为协议改动推迟。
- **给 PTC stderr tail 加分块累积与 head 游标**（D3）。向 4 MiB 上限之外再喂 4 MiB 花费 303 ms，即每个超限分片一次整上限拷贝；而上限之内的每个分片都是免费的（拼接仍是 rope，全范围切片不触发扁平化）。已否决：累积串的上限与输出账本的上限同为 64 MiB，因此超限区间只在「该次运行已因超出同一预算而被终止」时才开始。
- **为会话 header 加以 `(path, size, mtimeNs)` 为键的缓存**（D5）。在 2,000 个真实会话上 `list()` 耗时 284 ms：逐会话目录读取 45 ms、逐会话 `stat` 25 ms、打开并读取每个 300 字节日志文件 81 ms、zstd 解压 18 ms、`JSON.parse` 0.6 ms。已否决：header 缓存能省下的解压与解析只占 6.5%，而构造缓存键仍需那次 `stat`。在这一规模上划算的是「完全不读每个 header」的索引，而不是挡在这些读取前面的缓存。

## Consequences

上述测量即为记录；这六项的运行时行为未做任何改动。与它们对照的既有标定是：本 harness 中一个步骤以秒为单位的量级，而请求路径三项（C1–C3）每步不足 0.3 ms，因此在会话的墙钟时间里都不可观测。

## Testing

测量使用已发布源码而非复刻实现：

- C1：`snapshots/` 下录制的工具 schema 集（24–33 个工具；最大一份为 33 KiB schema JSON）。
- C2：`priceSurface` 的节点形状，每个表层事件一个节点，取 200 / 1,000 / 5,000 节点。
- C3：真实工具参数串（`bash`、`read`、`grep`），取 50 / 200 / 500 条历史调用。
- D1：各调用点使用的 `OutputCollector` tail 上限（`bash` 64 KiB、`grep` 20 MiB），按 1 / 5 / 30 ms 往返回放 SSH 转发器的刷新循环。
- D3：`stderr` 累积表达式，以及 `ptc-runtime-node` 的 `Config` 中 64 MiB 默认上限。
- D5：经已发布 JSONL 持久化写入 2,000 个会话，随后测 `list()`、逐会话一次 `stat()`，并在同一批文件上做逐阶段分解。

## Related

- [会话日志水位](../simplification/2026-09-16-session-log-watermark-from-log-length.zh.md) —— 同批审计中确实成立的请求路径成本：每次请求整份日志数组的复制。
- [grep 预览范围](../simplification/2026-09-16-grep-preview-scope.zh.md) —— 该次审计中最大的实测收益：一次宽泛搜索的保留工作从 131 ms 降到 1.7 ms。
- [目录列出的子批次并发](2026-09-16-listing-child-batches.zh.md) —— 另一处实测收益：3,200 条目目录从 83.6 ms 降到 20.9 ms。
