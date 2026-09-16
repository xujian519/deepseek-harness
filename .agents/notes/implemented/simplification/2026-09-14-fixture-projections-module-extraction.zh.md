# Agent Note: 提取 fixture provider 的投影 fold 家族（Issue #86）

Status: implemented

[English](2026-09-14-fixture-projections-module-extraction.md) | 中文

## Problem

[历史脚本那一刀](2026-09-14-fixture-history-module-extraction.zh.md)之后，`packages/client/connection` 的 `src/client/fixture.ts` 为 3475 行。三类内容共用这个文件：浏览器模式 provider 应答用的 wire 类型、据以推导它们的 session 查询镜像，以及同时服务两者的 1596 行主体 `createFixtureWorld`。

第四类夹在中间。`sid`（443 行）到 `backscanGoal`（1170 行）之间的 737 行，读整份 session log 并返回某一个投影单元的当前值：plan 模式、在 fixture 预设上的 permission select、最近一次 request context、token 与 context 统计、`model/selection` 值、控制事件推进的逐 key frame，以及 goal 回扫。

这 737 行并不连续。`pageOf`、`logReferencesAttachment` 和 search 家族——`searchBlockText`、`searchEventText`、`searchTokenSpans`、`phraseMatch`、`searchSnippet`、`compareSearchCandidates`——占据了 953–1123 行，正卡在 `projectionFramesOf` 与 `backscanTodos` 之间。跟着 fold 读的人会穿过查询镜像，跟着查询镜像读的人会穿过 500 行 fold。goal 回扫接在其后，于是 fold 家族成了被一段无关区域楔开的两截。

没有一个 fold 读世界状态。每个都取一份 log、返回一个值，且每一个都被 `createFixtureWorld` 调用——从 1055 行的 `projectionFramesOf(id, log, event)` 到 2457 行的 `projectionValuesOf(snapshot)`。依赖只有一个方向，因此这块区域有一条读者能说出口的边界。

[拆分计划](../../implemented/simplification/2026-09-14-god-file-split-plan.zh.md)把这一刀列为批次 2 `fixture.ts` 条目的第二项（在历史脚本之后）。本 note 记录这一刀产出了什么。

## Decision

`src/client/fixture-projections.ts` 现在持有这些 fold。入口保留 wire 类型、查询镜像与世界。

| 模块 | 行数 | 持有 |
| --- | --- | --- |
| `src/client/fixture.ts` | 2897（原 3475） | wire 词汇（`FixtureSessionApi`、`FixtureControlFrame`、`FixtureWorkspaceApi`）、session 查询镜像（`pageOf`、search 家族）、`FixtureOptions`、`FxInbox`，以及世界（`createFixtureFaces`、`createFixtureWorld`、`createFixtureConnectionRpc`） |
| `src/client/fixture-projections.ts` | 631 | 十二个导出——`ModelSelection`、`FixtureProjectionFrame`、`FxGoalProjection`、`FxGoalChange`、`foldPlan`、`PERMISSION_PRESETS`、`permissionSelectOf`、`lastRequestContext`、`projectionValuesOf`、`sameModelSelection`、`projectionFramesOf`、`backscanGoal`——以及十七个模块私有名字 |

模块头部写明了它的边界：

```ts
// The fixture's mirrors of the host projection units. Each fold reads the whole
// session log and returns one unit's current value; `projectionFramesOf` says
// which units an appended event advances. Nothing here reads world state.
```

入口的五个导出同名保留，其消费者导入路径不变：`tests/fixture.client.spec.ts` 与 `tests/fixture-commands.client.spec.ts` 仍导入 `../src/client/fixture.ts`，`src/client/index.ts` 未改动。这三个文件之外没有任何地方导入新模块。

### 每个导出名在世界里都有读者

十二个导出由入口自身的调用点决定，不是为对称凑出来的。八个是世界调用的运行时值，四个是它标注的类型。`FixtureProjectionFrame` 是入口 `FixtureControlFrame` 联合（261 行）的成员，`ModelSelection` 标注 model bar 的映射（713 行）与 bar 提交的选值（2139 行），`FxGoalProjection`/`FxGoalChange` 塑造 goal 处理链（1065、1092、1226、1552、1566 行）。没有任何名字是因为「看着像一伙的」而被导出。

### 私有名字随其唯一读者迁走

十七个名字保持模块私有：十个辅助函数、四个投影 interface、三个 token 估算常量。十七个都只在新模块内被读——入口一个都没提到。

`isFixtureTokenDelta` 值得单独点名，因为它在旧文件里位于 fold 家族首个函数上方 180 行，读起来像传输层代码。它仅有的两个读者（205、212 行）在 `sessionStatsOf` 内部，于是跟着走了。它保留了旧文件裹在它外面的 `jscpd:ignore-start`/`end` 对：该块记录的是「独立 fixture 在不导入目标实现的前提下镜像 host 计时」，这个配对不因搬迁而改变。

### 这次搬迁是切片，用字节账目核验

新模块由从 `fixture.ts` 切出的连续区间构成，所以核验方式是算术而非通读：

| 量 | 值 |
| --- | --- |
| 模块行数 | 631 |
| 头部注释与 import | 10 |
| 代码行 | 621 |
| ——与 `HEAD` 的 `fixture.ts` 逐字节相同 | 582 |
| ——新增 | 39 |
| 入口删除行 | 593 |
| 入口新增行（全部为 import 接线） | 15 |
| 声明顺序 | 与旧文件一致，仅一处倒置 |
| `HEAD` 的 fold 家族行中，在两个文件里都不再以原文存在的 | 16 |

39 个新行是：十二处声明加了 `export ` 前缀；两个导出 interface 各加一行描述（原本都没有）；以及为文档注释补 `@param`/`@returns` 的 25 行。

16 个行是那十二处仅因 `export ` 前缀而文本不同的声明，加上四条被改写为块的单行注释。四条中有三条原地留下并变长；第四条 `/** Fixture parallel of the host's projection units: whole current values per key over the full log. */` 被换行重排并挂到 `projectionValuesOf` 上——它描述的正是在这个函数。在旧文件里它位于 `PERMISSION_PRESETS` 上方，距其主语 290 行，且紧挨着该常量自己的注释。这处改挂是本刀唯一的内容改动，属文档修正而非行为改动。

唯一的顺序倒置是有意为之：`FixtureProjectionFrame`（旧 250 行）现在跟在 `ModelSelection`（旧 52 行）之后，让模块以其两个导出 wire interface 开篇，随后才是 `isFixtureTokenDelta` 块（旧 72 行）。其余一切保持旧文件顺序，校验方式是把复制来的行当作 `HEAD` 的有序子序列走一遍。

### `pageOf` 与 search 家族为何留下

它们是另一条接缝的镜像。fold 回答的是「这个单元的当前值是什么」；`pageOf` 与 search 家族回答的是「这条查询看到的是 log 的哪一片」，这也是为什么 `pageOf` 读 `FIXTURE_SESSION_SEARCH_RESULT_LIMIT`、search 家族读 `ContentBlock` 文本。它们服务的是世界在 `session/search` 与 `session/page` 上应答的查询，而不是世界发布的某个投影。

拥有它们的那一刀是入口的下一刀，它需要做一个本刀不必做的决定：查询镜像该待在它们推导的 wire 类型旁边，还是待在世界的查询处理链旁边。

## Verification

| 检查 | 结果 |
| --- | --- |
| `pnpm run typecheck`（pre-push 门禁） | exit 0，构建本包两个编译面 |
| `pnpm exec vitest run packages/client/connection` | exit 0，14 文件 / 164 通过——与切割前相同 |
| `pnpm exec tsx scripts/run-oxlint.ts packages/client/connection/src` | exit 0 |
| `pnpm exec tsx scripts/verify-export-jsdoc.ts` | exit 0 |
| `pnpm run duplication` | exit 0，2204 个文件 0 处克隆 |
| `pnpm run test:docs` | exit 0，18 通过、0 失败、0 跳过 |
| 字节账目 | 模块 621 行代码中 582 行与 `HEAD` 逐字节相同；39 个新行已逐类列出 |
| 声明顺序 | 撤销记录在案的那一处倒置后与 `HEAD` 一致 |
| 入口导出 | 仍是同样五个名字 |
| 测试导入路径 | 未变 |

批次验收标准成立：入口导出同名，没有任何测试需要改导入路径，也没有任何常量、默认值或 fold 结果发生变化。

`pnpm run typecheck` 是证明新模块进入本包编译面的检查。本包发布 `tsconfig.host.json` 与 `tsconfig.client.json` 两个叶子配置，其显式 `files` 清单逐条列出源文件，因此该模块登记在 `tsconfig.client.json`。包级 `tsc -p packages/client/connection/tsconfig.json --noEmit` 证明不了这一点：那个配置是 `files: []` 的 solution，没有 `-b` 时不对任何文件做类型检查。

### 覆盖率豁免是继承来的债，不是新债

这些投影 fold 并非全覆盖。在加入豁免条目之前用 `--coverage.reporter=json-summary` 实测，该模块为 statements 93.38%、branches 85.08%、functions 100%、lines 97.14%：16 处未覆盖语句，全部落在 fixture 的 spec 从未驱动的分支——`plan/mode`、`sandbox/mode`、`todo/write` frame 处理，以及 `reasoningEffort === undefined` 那条臂。

这些正是入口自身豁免条目所记录的同一批缺口。`fixture.ts` 在 `vitest.config.ts` 中的理由为「Slash/command/input round: per-file gaps deferred with the same client-lane debt. TODO(gui): cover and remove with the lane above.」。把代码搬出被豁免文件并不会让它被覆盖，因此 `fixture-projections.ts` 得到了自己的条目，指向同一条 lane。没有这个条目，本刀会在一块当前门禁并未覆盖的代码上把 per-file 门禁打红——那是本刀没有任何部分能证成的状态变化。

## Alternatives considered

- **补写缺失的测试而不是加豁免条目。** 否决：那 16 处未覆盖语句是 `fixture.ts` 已在 `TODO(gui)` 下推迟的 client-lane 债，覆盖它们意味着把 `plan/mode`、`sandbox/mode`、`todo/write` 经由 fixture 的 command 面驱动一遍。那是一次有自己的范围的测试改动，不属于保持行为的提取。
- **在同一刀里把 `pageOf` 与 search 家族也搬出去。** 否决：它们的归宿是个未决问题——wire 类型旁边还是世界的处理链旁边——而在一刀主题为 fold 的改动里敲定它，会把两条边界混在一起。计划把它们留作入口的下一项。
- **顺着交错把 fold 切成两半**，把 `backscanTodos`/`backscanGoal` 放进第三个模块。否决：goal 回扫与其他 fold 同类（读 log、返回当前值），旧文件里把它们隔开的只是一段查询镜像。由一个无关区域恰好落在哪儿而造出的模块，会把这个偶然当成自己的名字。
- **把 `projectionFramesOf` 留在入口。** 它读 `SessionId`，世界的控制中继也直接调它，留下来是说得通的。否决：它与 `projectionValuesOf` 共用 `isFixtureTokenDelta` 和 usage fold，留在入口会迫使入口从模块导入五个私有名字，把耦合做大而不是做小。
- **把四个投影 interface 与共享类型放进 `src/types.ts`。** 否决理由与同批另一刀相同：它们是 client 面的 fixture 内部物，不是本包的接缝词汇，且没有一个出现在本包发布的 RPC 接缝上。
- **把十个私有辅助导出以便入口复用。** 否决：入口一个都不调，OXC 的 `no-unused-vars` 也无话可说——无人读的导出是下一个读者必须排除掉的名字。
- **把模块改造成世界实例化一次的 `createProjectionFold(log)` 闭包。** 否决：每个 fold 被调用时带的都是不同的 log（`logOf(id)`、快照、完整 log），世界的处理链已经传了它所指的那份，捕获一份 log 会更常出错而不是更方便。

## Consequences

`fixture.ts` 短了 578 行，持有 wire 词汇、查询镜像与世界。改 fixture 如何投影 plan 模式的人打开 `fixture-projections.ts`；改它如何应答 session 查询的人留在入口。两块区域不再交错。

代价是多一个文件、多一条带着比本刀更长寿的 `TODO(gui)` 的覆盖率豁免条目，以及一条被移到其所描述函数上的注释。模块以五条语句从 `@deepseek-ai/dsh-llm`、`dsh-session`、`dsh-tool-todo` 导入九个名字，入口反向导入十二个；除此之外流向未变。

`fixture.ts` 仍是 2897 行。计划在它内部的剩余切口是查询镜像与世界自身的区域；1596 行的 `createFixtureWorld` 现在是本包最大的单一函数体，切割它需要一个本刀不必做的边界决定。

该模块族及其兄弟 fixture 模块——`fixture.ts`、各抽取出的 `fixture-*` 模块及其 spec——后续被上游以 `@deepseek-ai/dsh-remote-mock` 与 `apps/web/tests/assembled-remote.ts` 整体取代。

## Related

- [拆分七个上帝文件](../../implemented/simplification/2026-09-14-god-file-split-plan.zh.md)（计划；本刀是其批次 2 `fixture.ts` 条目的第二项）
- [提取 fixture provider 的 fx-alpha 历史脚本与消息词汇](2026-09-14-fixture-history-module-extraction.zh.md)（本包内同批的另一刀）
- [提取 trajectory ledger 的 record 模型与呈现辅助](2026-09-14-trajectory-ledger-module-extraction.zh.md)（批次 1，`ui-trajectory`）
