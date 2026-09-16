# Agent Note: 会话查询改为借用源，不再克隆整份日志

Status: implemented

[English](2026-09-16-session-query-borrowed-source-reads.md) | 中文

## Problem

`SessionCorpus.load` 解析出一个"实时优先"的源之后，返回的是它的完整克隆：实时会话那份深度冻结的日志被逐事件克隆，从存储日志读出的每个事件同样被克隆。每一次精确读取都要先付掉这份成本，才开始做自己真正的工作，于是付出的代价由日志规模决定，而不是由调用方想要什么决定。单事件读取（`readEvent` 不带上下文窗口）会克隆整份日志；`readSession` 会克隆两遍——`load` 克隆每个事件一次，端点再把每个事件分离一次。

在一个实时会话上实测（50,000 个 `user/message` 事件、约 50 MB 文本）：解析一次源要 106 ms 和瞬时 86 MB 堆。`readSession` 约 493 ms（106 ms 解析克隆 + 250 ms `Session.create` 校验 + 137 ms 输出分离）。

## Decision

**`SessionCorpus.borrow` 取代 `load`，每个端点只克隆自己返回的值。**

- `borrow(sessionId, signal)` 返回 `BorrowedSession`——header、继承事件数、日志——不复制任何事件。实时持有方提供自己已冻结的快照（`session.snapshotEvents()`）；存储日志提供冷读取自己那个外层数组，其事件要么已由后端冻结（`shared-frozen`），要么作为独立持有的事件交出（`detached`）。两种情况都属于 `SessionObservationReader` 已在使用的 `ColdSessionLog` 采纳契约。
- `load` 及其 `snapshotLive` 辅助函数被删除；`borrowLive` 与批量投影器共用——后者本来就用同一套"借用再投影"的形状。
- 点读只分离自己返回的内容：`readEvent` 克隆 header 加请求窗口，`readSession` 克隆 header 加每个事件一次快照，`readSurface` 克隆 header，`currentSurfaceEvents` 继续对每个 surface 事件做快照，`traceEvent` 克隆 header。`listEvents` 与 `filterEvents` 构造的是全新的记录与文档，因此不克隆任何东西。
- `readSession` 保留其经由 `Session.create` 的回放校验，但每个事件现在只分离一次，而不是两次。

同一个 50,000 事件实时会话上的实测：

| 端点 | 改动前 | 改动后 |
|---|---:|---:|
| `readEvent`（seq N-1，无窗口） | 106 ms，瞬时 +86 MB | 0.2 ms，无瞬时复制 |
| `listEvents` | 约 114 ms，瞬时 +86 MB | 7.9 ms，+22 MB |
| `readSurface`（每个事件都是 surface 节点） | 约 250 ms，+175 MB | 142 ms，+89 MB |
| `readSession` | 约 493 ms | 389 ms |

## Benchmark

`benchmarks/session-history-read` 是本次改动对应的 required 门禁。它通过生产写入路径写入一份合成会话，按样本复制该根目录，再经与 JSONL 后端组合的真实 `ctx.sessionQuery` 服务读回。

| 字段 | 决定 |
|---|---|
| 用户操作 | 对一份存储会话执行"读取某个事件的上下文窗口"与"读取当前模型表层"；各自在调用方拿到返回快照时完成 |
| 负载 | 45,000 轮 `turn/start` 加一条 745 字节的 `user/message`（`HISTORY_READ_TEXT_BYTES`，门禁会断言每一轮都是这一尺寸）：90,000 个事件、33.5 MB 各不相同的用户文本。每轮文本都不同，因此存储日志占用真实内存，而不是共享同一个字符串 |
| 入口 | 在保存 fixture durable 日志的私有根目录上调用 `readEvent` 与 `readSurface`。SQLite 查询引擎作为 `ctx.sessionQuery` 的生产组合被挂载但从不查询，测量中不包含任何搜索结果 |
| 时钟 | 只测量端点调用本身的墙钟时间。子进程挂载 Host、父进程把 fixture 复制进样本根目录，均发生在计时开始之前；每个端点五个全新进程样本，按中位数执行预算 |
| 内存 | 调用后立即（回收前）的 `heapUsed` 用于瞬时增长；GC 后的 `heapUsed` 与 `resourceUsage().maxRSS` 用于常驻与峰值。另一个子进程在固定 128 MB old-space 上限下运行同一读取 |
| 判定 | 见下表。时间预算为记录的参考机中位数乘以共享的 CI 时间倍率与波动余量，瞬时堆预算只使用波动余量 |
| 行为 | 输出、顺序、错误与取消由归属测试钉住；本门禁不重复任何语义断言，只要求读取完成并到达其端点 |

| 测量项 | 改动前（逐事件复制） | 改动后 |
|---|---:|---:|
| `readEvent` 中位数 | 313.3 ms | 174.9 ms |
| `readSurface` 中位数 | 458.5 ms | 308.7 ms |
| `readEvent` 瞬时堆 | +128.6 MB | +71.9 MB |
| `readSurface` 瞬时堆 | +190.8 MB | +127.6 MB |
| 128 MB old space | 两个端点都耗尽堆 | 两者均完成 |

负向控制：把被移除的复制放回 `borrow` 即恢复改动前的分配量，门禁在所有非时间用例上都会拒绝它——两个瞬时堆预算，以及两个受限堆完成检查（`SIGABRT`、`Reached heap limit ... JavaScript heap out of memory`）。两个时间预算是 CI 信号：在参考机上记录的中位数乘以共享时间倍率（313.3 ms → 627 ms）超过 438 ms 预算，这一点由门禁自身的校准用例断言，而不是靠参考机上的一次运行。本门禁不覆盖：Gateway 网络传输、Client fold、浏览器 paint、模型时延。负载也只含一个存储会话，因此门禁不测量读取此前执行的整库遍历；该移除由本包测试与它自身实测的列举成本钉住。

## Alternatives considered

- **保留 `load`，另加一个窗口版变体。** 拒绝：同一个源存在两条解析路径，而且"克隆一切"那条路径依然可达——这正是本次要修掉的错误。
- **把借来的对象直接交给调用方。** 拒绝：这会破坏本包"结果脱离存储"的承诺。调用方将收到实时持有方的冻结对象（或冷读取自己的数组），当前落在隔离副本上的写入会变成抛错，或者变成修改共享状态。
- **把点读改走 `SessionObservationReader`。** 未采用。点读是一次性的，而该读取器的有界 prepared-Session 缓存是它永远用不上的常驻状态。去掉全库 listing 预检只需要一次单会话 `stat` 观察，那是[另一项决策](2026-09-16-session-query-resolves-stored-sessions-by-id.zh.md)。
- **在 corpus 内按 revision 缓存已解析的日志。** 拒绝：按 revision 复用已在 `SessionObservationReader` 中存在；在 corpus 里再加一份缓存需要自己的失效归属者，却没有带来新的行为。

## Consequences

一次读取现在的代价取决于它返回的内容，而不是它读过的内容：被移除的工作与日志规模成正比，剩下的工作与返回的窗口、记录或 surface 成正比。点读的常驻内存不再携带一份瞬时全量日志副本——那正是大会话读取逼近进程堆上限的原因。

借用来的事件是严格只读的：实时持有方的对象被深度冻结，后端也可能共享自己的对象。此后新增的任何端点都必须克隆自己要返回的内容，且不得修改借来的内容。

`readSession` 仍然由其校验阶段主导——`Session.create` 占其 389 ms 中的约 250 ms——因为该端点承诺返回一份经回放校验的完整日志。对后端已经冻结的 seed 采用 `Session.fromRestore` 可以去掉这一阶段，留给一次能够说明它放弃了哪些校验的改动。

## Testing

- `pnpm exec vitest run packages/session-query/session-query/tests` — 101 通过。
- `pnpm exec vitest run packages/session-query/tool-session-query/tests packages/context/session-reference/tests packages/session-query/session-query-sqlite/tests` — 221 通过，覆盖面向模型的工具、消费 `readSurface` 的 session-reference 上下文插件，以及 SQLite 后端。
- 新增用例 `copies only the returned window instead of the whole log`：用 `structuredClone` 上的 spy 断言每个端点的克隆次数——每个返回事件至多一次分离加 header，`readSession` 少于 1.5 遍分离。同时断言返回的窗口仍是分离副本，不会触动会话本身。
- 负向控制：把被移除的全量克隆重新放回 `borrowLive`，该用例以 `expected 203 to be less than or equal to 3` 失败。
- `packages/session-query/session-query/src/corpus.ts` 与 `src/index.ts` 在本包测试下覆盖率为 100%。

## Related

- [统一会话查询服务](../../archived/architecture/2026-07-23-unified-session-query-service.md) — 本次改动保留的语料库设计由它归属。
- [观察缓存](../../../../packages/session-query/session-query/README.zh.md) — 按 revision 键控、端点按需可选的点观察路径。
