# Agent Note: Conversation View target 只在被认领期间保持组装

Status: implemented

[English](2026-09-16-conversation-target-claim-lifetime.md) | 中文

## Problem

每次 `ConversationNodeAssembler.flush()` 都会对每个 **active** target 的脏 Context 执行 `apply`，而在本次改动之前，target 一旦激活就永久 active：选中它一次、或订阅它的 source 一次，就会把它加入一个没有删除路径的单调集合。因此用户离开 Trajectory 标签页后，trajectory target 仍在接收工作。它的 builder 每次调用都会遍历完整已加载窗口——`TrajectorySnapshotBuilder.apply` 会重新推导整份快照，分配 `eventNodes`、`eventLocations`、`requests` 与 `callSchemas`，并对 requests 与最终节点排序——所以每帧成本跟随已加载窗口，而不是跟随用户能看到的内容。

其量级比促成这项工作的那次审计所估计的小。那次审计声称每帧 1–3 ms，但并未实测；直接用真实 `TrajectorySnapshotBuilder` 驱动一个合成窗口测得的结果要小得多，且与已加载窗口成线性：

| 已加载 contribution 数 | `apply` 中位数 | `apply` 最大值 | 40 次 flush |
|---|---:|---:|---:|
| 3,000（240 轮窗口） | 0.13 ms | 0.72 ms | 7.0 ms |
| 10,000 | 0.59 ms | 2.55 ms | 28.6 ms |

另一组携带节点载荷与 partial 状态的 Assistant contribution 语料在同样两个规模下测得每次 `apply` 为 0.08 ms 与 0.28 ms，可见成本来自遍历与两次排序，而非载荷本身。

端到端 case 给出同样的结论。[`benchmarks/long-session-browser`](../../../../benchmarks/long-session-browser/long-session.bench.ts) 已经走过被报告的路径——打开 240 轮 Session、加载全部更早分页、访问 Trajectory 标签页、回到 Chat、再以固定节奏流式接收回复——并报告流式阶段 Chromium 主线程 `TaskDuration`。恢复单调激活并重新构建后，该中位数从 1338 ms 变为 1377 ms，落在该 case 自身 1314–1431 ms 的样本区间内：在 240 轮窗口下，被释放的 target 只值流式阶段约半个百分点，门禁无法分辨。

因此本次改动修复的是不变量而非某个已测出的瓶颈：主线程组装工作应跟随 shell 所显示的内容，而单调集合会让它在 Session 余下时间里、在每次 flush 上累积用户曾打开过的每个 View 的成本。

## Decision

**只要 shell 选中某个 target，或它的 source 至少有一个 subscriber 认领，该 target 就保持组装；最后一个认领离开时释放它，但不丢弃它已构建的内容。**

- `packages/client/ui-conversation/src/client/conversation/assembler.ts` 改为派生而不是存储 active 状态：`selectedTarget` 保存 shell 当前的 View，`subscribers` 统计每个 target 的 source 订阅者，`isActive(target)` 是两者的并集。`flush()` 的 replace 与增量两个循环以及 `markDirty` 都读这个谓词，而不再读单调集合。
- `selectTarget(target)` 替换先前的选择。shell 一次只显示一个 View，因此选择另一个 View 会释放它背后的 target；`retainTarget(target)` 增加一个订阅者认领，`releaseTarget(target)` 移除一个。
- `ConversationBinding.target(target).subscribe` 现在返回的退订函数会释放自己取得的认领，`ConversationBinding.activate` 改名为 `select`，因为它的契约已从“加入一个永久 active target”变为“指定 shell 的 View”。
- 释放时保留 `view.builder` 与 `view.snapshot`：不丢弃任何已构建内容，下一次认领走既有的 `replaceView` 路径，因此重新进入与首次激活逐字节等价，只是代价从每帧一次全量重建变成一次全量重建。
- 订阅者认领 target 但不必选中它，因此有屏幕外读者读取的 target（Trajectory 标签页打开时，composer 里的审批卡读取 Chat 快照）保持组装。
- `activityTargets()` 仍然只读 shell 选择。订阅者让 target 保持存活但不报告 shell 活动，因此 `conversationPhase` 依旧跟随 shell 所显示的内容。

## Alternatives considered

- **保留单调集合，只释放订阅者认领。** 已否决，因为这是空操作：shell 通过 `activateView` 选择 View，而打开 Trajectory 的两条路径——View 环的 `selectView` 与 Chat 工具卡片的 `openView`——都会先选中它，因此用户切回 Chat 后 Trajectory 仍然 active，正是被报告的那份成本。
- **释放时丢弃 assembler 的 snapshot 与 builder。** 已否决：被释放的 target 会在每次重新进入时从头重建，而一个同时被选中又被订阅的 target，会在最后一个订阅者离开时重建，尽管 shell 仍在显示它。
- **让订阅者也算作 shell 活动。** 已否决：那样 `conversationPhase` 会取决于恰好挂载了哪些组件，而一个空白 Session 可能因为某个屏幕外读者认领了 Chat 而被读成 active。
- **卸载被释放 target 的 React 树而不是冻结其快照。** 已否决：这会改变用户返回时所看到的内容——滚动位置与折叠状态是组件局部的——而冻结快照保留既有的重建路径。
- **在切换 Session 时释放，而不是在切换 View 时释放。** 已否决，因为不够：被报告的成本由用户正在看的那个 Session 支付，发生在用户离开 Trajectory 标签页而没有切换 Session 之后。

## Consequences

用户离开的 View 不再在后续每次 flush 上消耗主线程时间，因此长 Session 的成本不再取决于此前访问过哪些 View。在本次改动据以立论的路径上，这份节省的实测量级很小——240 轮窗口下约每帧 0.13 ms——而下面的公开 API 改名的代价正是为它付出的。引擎内部的代价是每次重新进入都要做一次完整 `replace`：被释放 target 的快照可能任意陈旧，因此认领后的首次 flush 会从完整 Context 集合重建它，而不是增量更新。释放后保留的快照仍可读，所以 `target().getSnapshot()` 会返回最后一次组装的值，直到某次认领触发重建。

`ConversationBinding` 去掉 `activate` 并新增 `select`；assembler 的 `activateTarget` 变成 `selectTarget`，并新增 `retainTarget` 与 `releaseTarget`。只为了让 target 物化以便读取的测试夹具改为用 `retainTarget` 声明自己的认领，这也如实说明它们扮演的是订阅者。

仍有两处边界。用户切换到另一个 Session 时不会释放 shell 的选择，因此打开了 View 的 Session 在后台期间仍保持组装；这是既有行为，仍由 Session binding 生命周期负责。另外，通过 `ctx.conversation.setActiveView` 切换视图的插件只写入 store 而未选中 target，因此 shell 的选择会在下一次选择事件时跟上持久化偏好，而被切到的 View 在此期间由其自身已挂载的订阅者组装。

## Testing

- `packages/client/ui-conversation/tests/conversation-assembler.client.spec.ts` 钉住认领生命周期：首次认领会物化、后续认领不会；两个认领中一个离开后仍收到 `apply`；最后一个认领离开后不再 `apply` 且保持快照的对象身份；下一次认领恰好重建一次，并落到与持续组装相同的快照内容。它还钉住选择语义：选择另一个 target 会停止先前 target 的 `apply`，已选中的 target 不会被重建，重新选中被释放的 target 会依据当前 Context 重建一次。
- `packages/client/ui-conversation/tests/conversation-registry.client.spec.ts` 驱动 binding：首个订阅者会物化未被选中的 target 并观察到重建；来去的第二个订阅者既不重建也不释放；最后一个订阅者离开后保留快照；下一次认领重建一次并通知所有 Session 快照订阅者；选中已认领的 target 不会重建它。
- `pnpm exec vitest run packages/client/ui-conversation` —— 32 个文件 419 项通过。`packages/client/ui-conversation/src/client/*` 处于 `vitest.config.ts` 既有的 GUI 债务覆盖率豁免范围内，因此 per-file 门禁在此不适用；新增分支由上述用例直接覆盖。
- `pnpm exec vitest run packages/client apps/web` —— 7328 项通过、5 项跳过。唯一失败项位于未改动过的 `ui-sidebar-documentpreview`（`keeps every bundled license in the packed client artifact`），它在自己解析 `pnpm pack --json` 时抛错，尚未进入任何断言；把本次改动的文件 stash 之后它以完全相同的方式失败。
- 负向控制（已运行并回退）：恢复单调激活（`isActive` 对任何曾被认领过的 target 返回 true）会让 `conversation-assembler.client.spec.ts` 与 `conversation-registry.client.spec.ts` 中的释放断言失败。
- `pnpm exec vitest run --config vitest.bench.config.ts benchmarks/long-session-browser` 在同一台机器上分别于改动前后运行，报告下方的流式阶段 `TaskDuration`。

## Browser measurement

该 case 受门禁的预算仍然只有打开、分页与首次 Trajectory 使用，因此本次改动既不需要新预算也不需要新 case。每个阶段三个样本取中位数，同一台机器与同一个合成 Session，对照运行恢复了单调激活并重新构建了 Client bundle：

| | 流式 `TaskDuration` | 流式墙钟时间 | 首帧回复可见 |
|---|---:|---:|---:|
| 单调激活 | 1338 ms | 2256 ms | 342 ms |
| 本次改动 | 1377 ms | 2273 ms | 347 ms |

两次运行在该 case 的样本区间内无法区分（流式 `TaskDuration` 样本为 1314–1431 ms），这与上面的探针一致：240 轮窗口下被释放的 target 只值 1.3 秒流式阶段中的约 7 ms。两次运行中该 case 对文本记录状态、回复重叠与页面错误的断言都通过，且每个样本的文本记录都到达了定稿回复。

## Related

- [Client Conversation 业务节点组装](../../../../packages/client/ui-conversation/README.zh.md) —— 本包 README 中关于 View 选择与 target 组装的描述，本次改动对其做了修订。
- [Client Conversation 组装决策](2026-08-09-client-conversation-node-assembly.zh.md) —— 本次认领生命周期所属的引擎。
