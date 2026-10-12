# Agent Note: Bound the retained Synapse canvas and its persistence write

Status: implemented

[English](2026-10-10-synapse-canvas-retention-window.md) | 中文

## Problem

桌面 Host 是一个长期存活的 Node 进程，承载所有插件，而 Synapse 画布存储对它保存的内容没有任何上限。`WorkspaceStore` 会保留每个会话曾产生过的全部卡片、每次工具调用的完整 `arguments` 与工具结果的完整文本，而 `save()` 在每次防抖写入时用一次 `JSON.stringify` 把这一切整体序列化。

一个真实安装在两个月专利工作后把 `workspaces.json` 撑到 470 MB：854 个投影线程、74,761 张卡片、87,616 条工具过程记录，其中参数与结果占 213 MB（`packages/web/synapse`）。加载该文件要 1.2 GB 堆，写入时进程同时持有状态、3.34 亿字符的 JSON 字符串和它 493 MB 的 UTF-8 缓冲。两个桌面会话都死于 `FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed - JavaScript heap out of memory`，且都发生在该写入路径内；崩溃报告里的 Python 子进程（stdio MCP 服务的 `BrokenPipeError`）是 Host 在回合中途死掉的下游症状，而非病因。

两个放大器加剧了它。地图文档每秒轮询一次 `/synapse/api/workspaces`，只要任一摘要变化就重开整个画布，于是活跃会话每秒拉取全部 37 个工作区投影（320 MB JSON，每个都在 Host 内被 `structuredClone` 并重新序列化）；同时 `apply()` 中的持久化基线在每次浏览器同步时无保护地运行，反复读取并重投影那个正被 live 事件流投影的会话日志。

## Decision

画布是保留视图，不是归档，管线的每一部分现在都按这个前提行事。

**保留窗口**（`packages/web/synapse/src/projection.ts`，由 `store.ts` 在每次投影结束时应用，并对从磁盘加载的文件应用一次）：

- `MAX_THREAD_MESSAGES = 200`：每个投影线程保留 200 张卡片，更旧的卡片退出。
- `MAX_THREAD_PROCESS_MESSAGES = 20`：只有最新 20 张卡片保留折叠的工具过程，更旧的卡片保留文本、失去折叠。
- `MAX_PROCESS_FIELD_LENGTH = 1,000` 字符：留存的 `arguments`/`result` 各自截断，并沿用指向详情视图的 `（详情查看全文）` 标记。
- 手动画板永不裁剪：其便签由用户撰写；而投影卡片是会话日志的派生物，`GET /synapse/api/sessions/<id>/history` 仍完整提供该日志。

`retainCanvasCards` 在重放下幂等，因为 `projectEventInto` 会丢弃低于 `canvasFloorSeq`（最旧保留卡片的 `seq`）的事件。没有这个下界，重放会把被丢弃的前缀重新加回，并在每一轮把窗口向前推。由于实时投影与加载期裁剪调用同一函数，窗口出现之前写入的画布会在下次启动时回到窗口内。

**分块持久化。** `writeState` 打开临时文件后先写入 `{"version":…,"hiddenSessionIds":…,"workspaces":[`，再逐工作区写入 `JSON.stringify(workspace)`，最后写 `]}`。字节与一次 `JSON.stringify(state)` 完全一致，但最大临时对象是单个工作区，而不是整份文档及其 UTF-8 缓冲。

**基线边界。** `replayPersistedBaseline` 把重叠的运行合并为一次，并跳过 live `ctx.sessions.list()` 仍持有的会话——该会话的回合属于 `session/created`/`session/event` 流，而它的日志正是浏览器同步期间不断增长的那一个。

**地图中的有界拉取。** `threadsForDshWorkspace` 维护以每个工作区摘要的 `updatedAt|threadCount` 为键的 会话→线程 缓存：revision 未变的摘要不再拉取，`openDshWorkspace` 只重载线程 revision 变化的历史。五路批量上限保留。

在同一个真实fixture 上，画布从 470 MB 降到 127 MB（59,906 张卡片、14,160 条工具记录），加载后的稳态堆从 1,214 MB 降到 180 MB，保存也不再分配整份文档。

## Alternatives considered

**提高 Host 堆上限（`--max-old-space-size`）。** 只是推迟崩溃而非消除它，并掩盖真正的缺陷：一个无界增长又被整体重新序列化的派生视图。

**只给工具负载设上限、保留全部卡片。** 在同一真实 fixture 上实测：把 `arguments`/`result` 截到 2,000 字符而保留全部 74,761 张卡片，仍有 151 MB；这里增长的是卡片数量而非单条体积（87,616 条记录的中位数约 400 字符，任何上限都触不到它们）。真正有效的杠杆是窗口。

**只在首次加载时截断，实时路径不加窗口。** 画布数周内会重新长回同样大小，而两条路径会对“画布包含什么”产生分歧。

**连手动画板一起裁剪。** 其便签由用户撰写，与投影卡片不同，无法重建。

**为加载引入流式 JSON 解析器。** 首次遗留加载在解析超大文件时仍会峰值约 1.5 GB，但这次解析是单次分配，且此时 Host 其余部分仍在组装；此后每次启动都只读压缩后的 127 MB。为一次性迁移引入大依赖不划算。

**保留存储的 `JSON.stringify`，只依赖状态变小。** 文档就是整份画布，而这个安装已经证明字符串加其缓冲正是压垮进程的东西。分块只有十几行，却永久消除了这个分配。

**用批量端点替代按 id 拉取工作区。** 为视图局部问题改动 Host API，且[拉取上界笔记](2026-08-27-bounding-synapse-workspace-fetch.zh.md)已否决过；revision 缓存无需触碰线协议就解决了它。

## Consequences

持久画布现在与“每个会话近期的工作量”成正比，而不是与每个会话曾产生的全部内容成正比。可见的损失是画布卡片层：超过 200 张卡片的线程只显示最新 200 张，工具折叠只保留在最新 20 张上。直接读取会话日志、每次分页 200 条消息的详情视图不受影响，仍是完整记录。

本变更后的第一次启动仍需付出遗留解析的代价（在实测 fixture 上峰值 1.5 GB）并重写压缩后的文件；之后的启动读取 127 MB。对画布**总量**（会话数量，而非每个会话的大小）仍无上限：854 个线程各 200 张卡片是使用量继续增长后的下一个天花板，而整会话淘汰属于产品决策，本次变更不做。

地图现在把每个已拉取的工作区投影留在渲染进程内，而不是反复重取：稳态下是一个工作区的卡片，其余已拉取工作区会保留到存储不再列出它们为止。
