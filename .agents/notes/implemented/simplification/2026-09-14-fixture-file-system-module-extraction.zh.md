# Agent Note: 提取 fixture 的内存文件系统（Issue #86）

Status: implemented

[English](2026-09-14-fixture-file-system-module-extraction.md) | 中文

## Problem

[投影那一刀](2026-09-14-fixture-projections-module-extraction.zh.md)把 `packages/client/connection/src/client/fixture.ts` 留在了 2897 行，并写明了它为什么停在那儿：此前每一刀提取的都是**模块级纯函数**，而 `createFixtureWorld`（704–2875）那 2172 行的函数体里，没有哪块区域符合这个条件。[拆分计划](../../proposed/simplification/2026-09-14-god-file-split-plan.zh.md)把这里剩下的活儿归入批次 2——*需要先把接口定形的切割*——但没有点名那个接口是什么。悬着的问题是**一个簇怎么拿到世界的状态**。

按每块区域捕获了什么状态来分类，问题就有答案了。逐块对照其自身的符号引用：

| 类别 | 区域 | 理由 |
| --- | --- | --- |
| 自足 | `workspaceFileRemotes`、`directoryPickerRemotes` 及其数据集 | 除自身外不读任何世界状态 |
| 自足但延后 | `settingsRemotes` / `credentialRemotes` / `presetRemotes` | 只碰 `fixturePresets` / `fixtureCredentials` / `fixtureDefaultPreset` |
| 耦合 | `sessionApi`、`rpc` 派发表、`timingHooks`、`workspaceApi`、五个 `open*` 生成器、`commandRemotes` / `goalRemotes` / `referenceRemotes` | 经 `logOf`（读一次就会改）与 `append`（写 `logs`、抬 `sessions[].updatedAt`、并发出 follow/control/remote 帧）互相咬合 |

本刀取第一行，并就此把计划留下的问题定下来。

## Decision

`src/client/fixture-file-system.ts` 持有这个内存文件系统。入口保留世界，只用一个值调进去。

| 模块 | 行数 | 持有 |
| --- | --- | --- |
| `src/client/fixture.ts` | 2483（本刀之前 2897，本刀落地时 2675） | wire 词汇、session 查询镜像，以及世界 |
| `src/client/fixture-file-system.ts` | 255 | workspace 文件读取与目录选择器的浏览树 |

模块头部写明了它的边界：

```ts
// The fixture's in-memory file system: the read-only workspace-file remotes
// every world shares, plus the directory-picker remotes whose browse tree is
// created per world.
```

### 世界传进来的只有 home 目录；这个簇自己持有它改动的状态

工厂签名是 `createDirectoryPickerRemotes(home: string)`。它是唯一跨过边界的值，而且是值，不是对世界的引用。

`FIXTURE_HOME` 留在入口。`workspaces[0].path`（854 行）与 `ready` 帧的 `host.home`（2184 行）也读它，因此入口持有它，并把它交给工厂：

```ts ignore-check
// The picker tree is per-world; the shared read-only workspace-file remotes live in the module.
const directoryPickerRemotes = createDirectoryPickerRemotes(FIXTURE_HOME)
```

浏览树 `directoryTree`——只有 `createDirectory` 会写它——在工厂内部创建，于是每个世界拿到自己的一份。这不是洁癖。本包自己的 spec 与 keyless 浏览器验收都会在同一进程里建出多个世界；模块级的树会让一个世界建出的目录出现在另一个世界里，使断言依赖于执行顺序。

只有选择器这一半需要这种隔离，所以只有它是工厂。workspace 文件数据集及其路径与分页辅助读的是模块级数据和纯函数，每个世界从它们算出的答案都一样；一个零参工厂只会为每个世界造一个无状态对象，把「整个文件系统是按世界隔离的」写进结构里——而那是假的。

### 三个导出，入口各有一个读者

`WORKSPACE_FILES_ROOT`、`workspaceFileRemotes` 与 `createDirectoryPickerRemotes`。入口三个都导入。

`WORKSPACE_FILES_ROOT` 是唯一的反向依赖——入口在 2157 行读它，拼出 fixture 文件变更帧报告的那个 `notes/demo.txt` 路径。这个常量是模块的根，模块持有它；给入口留第二个家是同一条路径的第二处归属，更糟。它不走 `src/types.ts`：那个文件承载的是一个包的*接缝词汇*，而本包没有接缝词汇，这是个 fixture 根。`rpc` 派发表则完全没改——`workspaceFileRemotes` 以导入绑定、用自己的名字到达，于是 `workspaceFile/*` 那几条臂（2536–2542 行）与 `directoryPicker/*` 那几条臂（2476–2479 行）逐字节未变。

`FixtureWorkspaceEntry` **不导出**。担心 `declaration: true` 会报 TS4023 是多余的，仓库里即可反证：`fixture-projections.ts` 声明了非导出的 `FixtureRequestContext`，导出的 `lastRequestContext` 返回它，而产出的 `lib/types/client/fixture-projections.d.ts` 把它作为非导出 interface、由导出签名按名引用。不导出也让它落在 `verify-export-jsdoc` 之外——那道门只查导出名。

`FixtureDirectoryPickerRemotes` 同样不导出。它存在是因为 `verify-export-jsdoc` 要求导出函数带显式返回类型；让它做这三个方法签名的唯一居所，免得同一份签名写两遍。用它对对象字面量做标注，而不是在字面量上重复签名，正是下面那 4 行搬迁行与 `HEAD` 不同的原因。

## 这次搬迁是切片，用字节账目核验

新模块由从入口切出的连续区间构成，所以核验方式是算术。

| 量 | 值 |
| --- | --- |
| 模块行数 | 255 |
| 逐行可追溯到 `HEAD` 的 `fixture.ts` | 227 |
| ——经两处声明式变换后逐字节相同 | 217 |
| ——被声明式改动过 | 10 |
| `WORKSPACE_FILES_ROOT` 上方那 3 行 `//` 注释，今为 5 行 JSDoc | +2 |
| 新撰写 | 26 |
| 入口删除行 | 229 |
| 入口新增行（全部为 import 与工厂接线） | 7 |
| `createFixtureWorld` 函数体 | 1946 行（原 2172） |

三段追溯区间是 `HEAD` 872–900（29 行）、1280–1429（150 行）、1431–1478（48 行）。切片 A 整体搬运：29 行经 `FIXTURE_HOME` → `home` 变换后逐字节相同。另外两段带有下列改动。

两处变换都是机械且可逆的：

- **整个模块缩进两列。** 被搬区域原本在 `createFixtureWorld` 内部；切片 B（`WORKSPACE_FILES_ROOT` 到 `workspaceFileRemotes`）现在位于模块顶层。
- **`FIXTURE_HOME` 变成 `home`**，共五处：两处 `directoryTree` 种子、`pick()` 里的字面量、`list` 的 `path ?? home` 兜底，以及清单里原本写 `home: FIXTURE_HOME` 的字段——它简写成了 `home`。

10 处改动行是：`WORKSPACE_FILES_ROOT` 上方那三行 `//` 注释——因为该常量现在是导出，重新缀成 JSDoc；该常量与 `workspaceFileRemotes` 各加 `export ` 前缀；选择器对象中指明 `FixtureDirectoryPickerRemotes` 的那四行；以及清单里 `home: home` 那个字段——变换把它塌成了简写 `home`。

26 个新行按文件顺序是：三行模块头部、一个空行、两条 import 与一个空行（7 行）；`workspaceFileRemotes` 之后的空行（1 行）；`FixtureDirectoryPickerRemotes` interface 及其后的空行（6 行）；工厂的 JSDoc 与签名（9 行）；选择器自带 JSDoc 之前的空行（1 行）；以及 `return directoryPickerRemotes` 与闭合的括号（2 行）。

随搬迁落地一处文档改动：`HEAD` 1280–1287 行那 8 行 JSDoc（`Workspace text reads under `?fixture`. …`）描述的是 `workspaceFileRemotes`，但它的主语声明在 58 行之后（1346 行），隔着一个 `WORKSPACE_FILES_ROOT` 自己的注释。它现在紧贴在 `workspaceFileRemotes` 上方——正是它所描述的那个声明。除此之外搬迁行逐字节相同，且仍是 `HEAD` 的一个有序子序列。

## 测试变得可行，于是补了测试

`workspaceFileRemotes` 此前一条测试都没有，`directoryPickerRemotes` 只有一条，因为两者都落在 `vitest.config.ts` 对 `fixture.ts` 的 `TODO(gui)` 覆盖率豁免之下。把它们提取成独立文件会让 per-file 门禁立刻在它们身上变红，于是这一刀必须二选一：追加第二条豁免，还是补测试。

它补了测试：`tests/fixture-file-system.client.spec.ts`，22 例。`vitest.config.ts` 未改动。

这正是[计划](../../proposed/simplification/2026-09-14-god-file-split-plan.zh.md)自己的验收标准——*某个测试变得可行、某个接口变得显式、某个方法变得可读*——而这正是本刀的证成，且模块正是让它可行的原因：每条分支跑的都是模块级数据，或当场造出的工厂，中间没有世界、log、session 或传输。`vitest.config.ts` 里 `fixture.ts` 那条注释写的是 `TODO(gui): cover and remove`；对这块区域，这件事现在是做完了，而不是被另一个文件继承下去。

以 `--coverage.reporter=json-summary` 实测，该模块为 statements、branches、functions、lines 四项 100%（82 行、87 条语句、67 条分支、16 个函数）。模块内没有任何 `v8 ignore`；入口那六处抑制全都落在搬迁区间之外。

## Verification

| 检查 | 结果 |
| --- | --- |
| `pnpm exec vitest run packages/client/connection` | 15 文件 / 186 通过——切割前的 14 文件 / 164，加新 spec |
| 模块覆盖率（`--coverage.reporter=json-summary`） | statements / branches / functions / lines 四项 100%；未改 `vitest.config.ts` |
| `pnpm run typecheck` | exit 0，两个编译面 |
| `pnpm exec tsx scripts/run-oxlint.ts packages/client/connection/src packages/client/connection/tests` | exit 0 |
| `pnpm exec tsx scripts/verify-export-jsdoc.ts` | exit 0 |
| `pnpm run duplication` | exit 0 |
| `pnpm run test:web`（本地） | 不是通过信号：43 文件 / 65 用例失败，其漂移非本刀引起——已提交的 aria golden 不含插件现在会渲染的 `Deliverables` / `Board` / `Teams` 三个 tab，`built-boot` 断言的品牌文本 `DSH Local Build` 在本 fork 中已改名。没有任何一条失败提到 fixture 符号。 |
| `pnpm run doc-sync`（本地） | 33 个门禁通过、3 个失败——`verify-doc-graphs`、`verify-config-catalog`、`verify-package-paths`；三者都未点名本刀触碰的文件 |
| 字节账目 | 227 行追溯行中 217 行逐字节相同；10 处改动行与 26 个新行已逐类列出 |
| 入口导出 | 仍是同样五个名字 |

字节账目来自：对三段追溯区间施加两处声明式变换后，把模块与 `HEAD` 的入口逐行比对，再把模块的每一行归类为命中、改动或区间之外。上表每个数字都是该脚本的输出，没有估算。

`pnpm run typecheck` 是证明新模块进入本包编译面的检查。本包的 `tsconfig.client.json` 用显式 `files` 清单逐条列出源文件，因此新模块登记在那里；没有这一条，入口的 import 就是 TS6307。包级 `tsc -p packages/client/connection/tsconfig.json` 证明不了这一点——那个配置是 `files: []` 的 solution。

删掉入口第 28 行那句 `DirectoryListing as FixtureDirectoryListing` 的 import 属于同一项要求：搬迁之后它仅有的读者在新模块内部，那里导入同一个别名，而 `noUnusedLocals` 会报 TS6133。别名保留原名，好让搬走的 `list` 签名不变。

## Alternatives considered

- **为了对称，给 `workspaceFileRemotes` 也配一个工厂。** 否决：它的方法读模块级数据与纯辅助，每个世界得到的答案都相同，工厂只会凭空为每次调用造一个无状态对象。那还会让「整个文件系统按世界隔离」看起来成立，而实际只有选择器的树如此。
- **把世界状态访问器传进工厂**（log、session 或 home 的 getter）。否决：两块区域都不读其中任何一项。`home` 就是全部的跨越，更宽的参数只会招引下一块区域从这里伸手。
- **只搬选择器，把 `workspaceFileRemotes` 留在入口。** 否决：两块区域是同一个主题——fixture 的内存文件系统——而 workspace 文件那一半更大。拆开会让入口持有数据集，而模块持有与之同形的树。
- **让 `WORKSPACE_FILES_ROOT` 走 `src/types.ts`。** 否决：那个文件承载的是一个包的接缝词汇，本包没有接缝词汇，而该常量是新模块自己的根，不是两个模块共享的一个词。入口把它读回来只是一条 import，不是第二个所有者。
- **让树的祖先节点从 `home` 派生。** 按「不做未要求的行为改变」否决：树硬编码了 `['/', ['home']]` 与 `['/home', ['fixture']]`，所以任何不是 `/home/fixture` 的 `home` 本就自相矛盾，而本刀只有一个调用点、传的是正确的值。工厂的 JSDoc 写明这个前提，而不是顺手改成派生。
- **照投影那一刀的做法，加一条 `vitest.config.ts` 豁免。** 否决：那一刀继承的缺口是从世界内部够不着的缺口。这些区域一旦移出世界就够得着了，而豁免会丢掉本刀唯一的防线。
- **在同一刀里把 `settingsRemotes` / `credentialRemotes` / `presetRemotes` 也搬走。** 是延后，不是否决：它们以同样的方式自足，需要同样的处理，但它们捕获的是三份可变状态（`fixturePresets`、`fixtureCredentials`、`fixtureDefaultPreset`）而不是一份，那是下一刀的边界决定。[那一刀](2026-09-14-fixture-configuration-remotes-extraction.zh.md)用一个零参数工厂持有全部三者，把它定了下来。

## Consequences

`fixture.ts` 短了 222 行，`createFixtureWorld` 短了 226 行。改 fixture 如何应答 workspace 文件读取或目录浏览的人打开 `fixture-file-system.ts`；改它如何存 session、workspace 或事件的人留在入口。文件系统不再落在入口那条 `TODO(gui)` 豁免之下，它的测试每次 `test` 都会跑。

代价是多一个文件、多一条 `tsconfig.client.json` 登记，以及一个要被入口读回来的常量。本刀给世界其余部分立下的模板就是这个工厂签名：**一个簇把世界的值作为参数收进来，自己持有它改动的状态。**

三个延后的 remote 簇[此后已落地](2026-09-14-fixture-configuration-remotes-extraction.zh.md)，进入 `fixture-configuration-remotes.ts`。剩余区域是 `rpc` 派发表（以当前入口计 2249–2459 行，211 行）——它需要先把它那约 20 个 handler 编成一个 interface 才能搬，是个比文件系统更大的边界决定。

本刀留下两处陈旧点。`fixture.ts` 在 `referenceRemotes` 上方堆了两条文档注释（1209–1210 行）：属于其上方 `goalView` 声明的 Goal Remote 那句，紧挨着描述该常量本身的 reference-discovery 那句。以及计划自己的 30–31 行仍写着 `fixture.ts` 含有 `jscpd:ignore` 块——那个块在上一刀里已经移到 `fixture-projections.ts`。

## Related

- [拆分七个上帝文件](../../proposed/simplification/2026-09-14-god-file-split-plan.zh.md)（计划；本刀是其批次 2 `fixture.ts` 条目的一项）
- [提取 fixture provider 的投影 fold 家族](2026-09-14-fixture-projections-module-extraction.zh.md)（本文件内的上一刀，也是命名了这条边界问题的那一刀）
- [提取 fixture provider 的 fx-alpha 历史脚本与消息词汇](2026-09-14-fixture-history-module-extraction.zh.md)（本包内批次 2 的第一刀）
