# Agent Note: 存储会话按 id 定位，不再列举整个语料库

Status: implemented

[English](2026-09-16-session-query-resolves-stored-sessions-by-id.md) | 中文

## Problem

解析一次存储会话读取的目标，会先列举整个语料库：`SessionCorpus.borrow` 调用 `persistence.list()`，再在返回的 header 中查找请求的 id。JSONL 的列举会遍历存储根下的每个项目目录、对每个会话的产物做 stat，并解码每一代的 header，因此每次读取在真正开始之前，就要先付一次与存储会话数量成正比的扫描。这次读取完全用不到其他会话：存在性加上一次 header 观察就是全部所需。

在 JSONL 后端上实测（macOS arm64、Node 22.22、源码解析诊断脚本、每个根取九次中位数）：

| 存储会话数 | `list()` | `stat(id)` |
|---:|---:|---:|
| 1 | 0.65 ms | 0.37 ms |
| 8 | 2.14 ms | 0.31 ms |
| 64 | 11.48 ms | 0.26 ms |
| 256 | 43.60 ms | 0.26 ms |
| 512 | 79.52 ms | 0.25 ms |

列举约每个存储会话 0.16 ms，而单会话观察是常数，因此这次预检就是小型会话读取的全部成本：在[恢复选择器笔记](../../archived/bug-fix/2026-07-31-resume-selector-batch-projection.md)记录的 185 会话存储上，每次点读在碰自己的日志之前先花掉约 29 ms 做列举。

## Decision

**冷路径的 `borrow` 用 `persistence.stat(id, options)` 定位目标。**

- `statPersisted` 把这次观察映射到查询错误分类：不存在（`undefined`）变为 `SESSION_QUERY_SESSION_NOT_FOUND`，后端失败变为 `SESSION_QUERY_PERSISTENCE_FAILED` 并保留 cause。
- 日志读取之前那次观察到的 header 与日志内 header 之间的校验保留，即 `assertSessionHeadersCompatible(loaded.header, observed.header)`。对同一个 id 的两次观察提供了与列举比较相同的保证：校验比较的是同一个逻辑源在观察与读取两处的 header。
- `listSessions`、`filterSessions`、`traceSession` 与 `readTitleSnapshots` 继续列举。它们回答的是全库问题，而 `projectMany` 用一次列举解析整批，而不是每个 id 一次。
- 已知实时目标仍然在查询持久化之前短路返回。

[`benchmarks/session-history-read`](../../../../benchmarks/session-history-read/session-history-read.bench.ts) 的 90,000 事件合成日志上的实测端点不受本决策影响，因为该语料库只有一个会话；该门禁针对"移除的逐事件复制"给出的证据属于[另一项决策](2026-09-16-session-query-borrowed-source-reads.zh.md)。

## Alternatives considered

- **在 corpus 内缓存列举结果。** 拒绝：缓存需要为每个写入方和进程拥有失效归属者，而且缓存一冷，读取仍要付一次扫描。在任何语料库规模下，单会话观察在构造上都比列举便宜。
- **让列举按 id 过滤。** 不可得：后端在返回前会解码每个列出的 header，过滤后的列举仍会遍历同样的目录。
- **保留列举，并用它的 header 做比较。** 拒绝：这正是要移除的成本，而为存在性已经拿到的那次观察就足以承担该比较。
- **去掉 header 校验。** 拒绝：若某个存储日志的 header 在观察与日志读取之间发生变化，必须显式失败，而不是把一个 header 与内容不符的日志交给调用方。

## Consequences

一次存储会话读取现在的成本是它自身的工作加上一次常数级观察，因此读取延迟不再随用户积累的会话数量增长。以一次一个会话方式读取历史的工具与上下文插件——`session_event_read`、交付物打开器、以及 session-reference 上下文源——都去掉了随用户全部历史增长的每次调用成本。

会话不存在、后端不可读、日志损坏、header 冲突的失败分类不变。有一类确实变了：当存储日志的 header 对本构建而言在结构上属于外来格式时——后端列举会略过它、单 id 观察会拒绝它——现在报 `SESSION_QUERY_PERSISTENCE_FAILED`，并以该版本拒绝为 cause，而列举预检当时报的是 `SESSION_QUERY_SESSION_NOT_FOUND`。该拒绝会给出后端期望的升级方向，而全库列举仍然略过该会话。`SESSION_QUERY_SOURCE_CONFLICT` 检测到的分歧，现在是在 `stat` 与日志读取之间观察到，而不是在列举与日志读取之间。

## Testing

- `pnpm exec vitest run packages/session-query/session-query/tests` — 101 通过。
- `pnpm exec vitest run packages/session-query/tool-session-query/tests packages/context/session-reference/tests packages/session-query/session-query-sqlite/tests` — 221 通过，覆盖面向模型的工具、session-reference 上下文插件与 SQLite 后端。
- 新增用例 `observes one stored session per cold read instead of listing the corpus`：断言冷点读执行零次列举、一次 `stat`；信号到达该观察；不存在的 id 仍报 `SESSION_QUERY_SESSION_NOT_FOUND`。
- 新增用例 `refuses a stored log this build cannot read instead of reporting it absent`：复现后端自身的不对称（列举略过结构上外来的 header、单 id 观察拒绝它），断言该拒绝以 `SESSION_QUERY_PERSISTENCE_FAILED` 为码、并以该拒绝为 cause 到达调用方，且全库列举仍把该会话报告为不存在。
- 负向控制：把列举预检放回 `borrow`，该用例（连同套件中另外十个用例）以 `expected [AbortSignal] to deeply equal []` 失败；保留预检、但其后仍执行该 id 的观察，则该用例以期望 `{ code: 'SESSION_QUERY_PERSISTENCE_FAILED' }`、实收 `SESSION_QUERY_SESSION_NOT_FOUND` 失败。
- `cancellableExactReads` 现在为每个读取声明它实际执行的预检（`list` 或 `stat`），而不是一个布尔值，因此取消用例把信号断言在该读取真正发起的持久化调用上；全库列举保留各自的信号断言。
- `benchmarks/session-open` 与 `benchmarks/session-history-read` 在 required 门禁中均通过。

## Related

- [会话查询改为借用源，不再克隆整份日志](2026-09-16-session-query-borrowed-source-reads.zh.md) — 与之配套、移除了每次读取拷贝整份日志的决策。
- [恢复选择器批量投影](../../archived/bug-fix/2026-07-31-resume-selector-batch-projection.md) — 把 `load()` 中的预列举记录为涉及错误语义的清理候选。
- [统一会话查询服务](../../archived/architecture/2026-07-23-unified-session-query-service.md) — 本次改动保留的语料库设计由它归属。
