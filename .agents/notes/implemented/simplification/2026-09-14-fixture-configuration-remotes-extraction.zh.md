# Agent Note: 提取 fixture 的配置类 remote 簇（Issue #86）

Status: implemented

[English](2026-09-14-fixture-configuration-remotes-extraction.md) | 中文

## Problem

[文件系统那一刀](2026-09-14-fixture-file-system-module-extraction.zh.md)按每块区域捕获了什么状态给 `createFixtureWorld` 的函数体分了类，并且只搬走了它能整块搬走的那一类。它自己的表格点出了第二类就停住了：`settingsRemotes`、`credentialRemotes`、`presetRemotes` 同样是自足的，但它们捕获的是**三块**可变状态——`fixtureCredentials`、`fixturePresets`、`fixtureDefaultPreset`——而不是一块。那一刀把这个问题称为「下一刀的边界决策」。

同一刀也写下了这个决策所需的模板：**一个簇把世界的值作为参数接收，并持有它自己改动的状态。** 它没有定下来的是复数形式。三块状态绑定可以变成三个工厂、一个工厂，或者一个接收世界状态访问器的工厂。

这个问题不是风格问题。三个簇里有两个彼此完全无关，而有一个不是：`settingsRemotes.openAgentPresetDirectory` 读的正是 `presetRemotes` 读写的那张 `fixturePresets`。

## Decision

`src/client/fixture-configuration-remotes.ts` 持有 fixture 的三个配置类簇及其状态。入口保留世界，并且不传任何值就调进去。

| 模块 | 行数 | 持有 |
| --- | --- | --- |
| `src/client/fixture.ts` | 2483（原 2675） | wire 词汇、session 查询镜像，以及世界 |
| `src/client/fixture-configuration-remotes.ts` | 246 | settings、credential、agent-preset 三类 remote 及其存储 |

模块头部写明了它的边界：

```ts
// The fixture's configuration remotes: the settings, credential, and
// agent-preset clusters, together with the writable state they own.
```

### 一个工厂，且零参数

签名是 `createConfigurationRemotes()`。文件系统那一刀的工厂需要 `home`；这一个什么都不需要，而这是实测结论而非偏好。入口 2675 行里对 `fixtureCredentials`、`fixturePresets`、`fixtureDefaultPreset` 的每一处引用，都落在这三个被搬走的区间之内——也就是这一刀带走的四行状态声明，以及读或写它们的方法。没有任何 `open*` 生成器、`timingHooks` 方法或其他 remote 碰过它们。

零参数工厂同时保住了文件系统那一刀建工厂所需要的性质：每次调用返回独立的存储。本包自己的 spec 与无密钥浏览器验收都会在同一个进程里构建多个世界，而一个模块级的 `fixturePresets` 会让某个世界复制出来的 preset 出现在另一个世界里。

### 三个簇，一个工厂

`fixtureCredentials` 与另两个没有共同读者，所以凭据簇本可以独立出去。`fixturePresets` 则不然：`settingsRemotes` 读这份名册来判断某个 preset 的目录能否打开，`presetRemotes` 读写它，包括默认值。

拆成两个工厂就会迫使 presets 这张表以参数形式跨过边界——而它同时被一侧写、被另一侧读。这正是[文件系统 note](2026-09-14-fixture-file-system-module-extraction.zh.md)点名否决过的*把世界状态访问器传进工厂*，而且在这里连「值」都算不上。一个工厂只需要把归属讲一次：这三个簇就是 fixture 可写的配置，由这个模块持有。

三个成员 interface 与工厂的返回 interface 都不导出，沿用 `fixture-file-system.ts` 里的 `FixtureDirectoryPickerRemotes` 做法。给每个对象字面量标注它的 interface，可以让每个方法签名只写一遍——`verify-export-jsdoc` 要求导出的工厂带显式返回类型，而该返回类型要指名这三者。不导出它们也让它们落在该门禁之外，因为该门禁只查导出名。

### rpc 派发表零改动

入口以同名解构接收这三个 remote：

```ts ignore-check
const { settingsRemotes, credentialRemotes, presetRemotes } = createConfigurationRemotes()
```

`agentPresets/*` 各臂、三个 `credentials/*` 臂、六个 `settings/*` 臂照旧解析这些名字，因此全部十四个臂逐字节不变。`createFixtureWorld` 仍然只返回 `rpc`，入口的导出面仍是那五个名字。

不需要任何 re-export。这三个簇及其存储从来就不是入口的导出，而会用到入口的两个 spec 文件只导入 `createFixtureFaces` 与 `createFixtureConnectionRpc`。

### 保持原有顺序，延后求值因此仍然成立

在被搬走的区间里，`settingsRemotes` 依旧声明在 `fixturePresets` 之前，与它在入口里时相同；`openAgentPresetDirectory` 从方法体内部读那张表。这在今天能成立，是因为方法体在调用时求值而非在构造对象时求值；这一刀保留了让该性质成立的顺序，而没有为了让它变得不必要而重排这个区间。`openAgentPresetDirectory` 的成功路径——用户自建 preset，其目录应当打开——就是新 spec 的用例之一，所以这个延后读取是被执行过的，而不是被假定的。

## 这次搬移是一次切片，并由字节记账校验

| 量 | 计数 |
| --- | --- |
| 模块行数 | 246 |
| 可逐行追溯到 `HEAD` 的 `fixture.ts` | 193 |
| ——逐字节一致 | 190 |
| ——因已声明改动而不同 | 3 |
| 新撰写 | 53 |
| 入口删除行 | 194 |
| 入口新增行 | 2 |
| `fixture.ts` | 2483（原 2675） |
| `createFixtureWorld` 跨度 | 1756 行（原 1947），两侧同一口径 |

两个被追溯的区间是 `HEAD` 的 725–837（113 行，本身连续）与 1367–1446（80 行）。搬移不需要任何变换：两者原本就在 `createFixtureWorld` 内两列缩进处，而工厂体缩进层级相同，所以这 193 行按原样与 `HEAD` 逐字节一致。区间顺序也保持不变，因此模块内的搬移区是入口的保序子序列。

3 行改动是那三个对象字面量，它们写出了自己的 interface：

```ts ignore-check
const settingsRemotes: FixtureSettingsRemotes = {
```

53 行新撰写按文件顺序是：两行模块注释及其后空行（3）；五行 import 及其后空行（6）；四个 interface 及其间空行（33）；工厂的 JSDoc 与签名（8）；以及收尾的空行与 `return`（2）。剩下 1 行新撰写是分隔两个被追溯区间的空行——`HEAD` 在该位置填的是留在入口里的那 529 行。

搬移同时带出两处入口改动。那条 `//` 注释、三个簇与四行状态作为一整块在 725–837 处离开，`presetRemotes` 在 1367–1446 处离开；接线行补上第一块的位置。入口还去掉了 `CredentialInfo` 与 `SettingsDescribeValue`/`SettingsNamespaceView`——它们的唯一读者搬走了——改为 import `createConfigurationRemotes`。这是必需而非整洁：`noUnusedLocals` 会对那两条失去读者的 import 报 TS6133。`RpcResult` 与 `SessionId` 在入口别处仍有读者，保留。

## 测试因此变得可能，于是补上了

这三个簇此前完全没有测试：它们身处 `vitest.config.ts` 罩在 `fixture.ts` 上的 `TODO(gui)` 覆盖率豁免之下。把它们抽成独立文件会让 per-file 门禁立刻在它们身上失败，因此这一刀要在「再加一条豁免」与「补测试」之间选择。

它补了测试：`tests/fixture-configuration-remotes.client.spec.ts`，15 个用例，`vitest.config.ts` 未改。所有已写明会失败的分支都被覆盖：三个写方法的 `settings/rejected`，`openAgentPresetDirectory` 的未知名与 system trust 两种拒绝及其成功路径，`credentials/describe` 的两种 configured 状态，`presets/read` 的缺失 id，`copy` 的缺失源、重名及其成功路径，以及 `deletePreset` 对 system preset 与用户自建 preset 的处理。工厂的隔离性由直接断言保证：改动一次调用的名册，再读另一次的。

以 `--coverage.reporter=json-summary` 实测，该模块报告 100% statements / branches / functions / lines（41 statements、14 branches、17 functions）。模块内没有任何 `v8 ignore`。

## Verification

| 检查 | 结果 |
| --- | --- |
| `pnpm exec vitest run packages/client/connection` | 16 文件 / 201 通过——切割前的 15 文件 / 186，加上新 spec |
| 模块覆盖率（`--coverage.reporter=json-summary`） | 100% statements / branches / functions / lines；未改 `vitest.config.ts` |
| `pnpm run typecheck` | exit 0，两个编译面 |
| `pnpm exec tsx scripts/run-oxlint.ts packages/client/connection/src packages/client/connection/tests` | exit 0 |
| `pnpm exec tsx scripts/verify-export-jsdoc.ts` | exit 0 |
| `pnpm run duplication` | exit 0 |
| `pnpm run test:web`（本地） | 不作为通过信号：本 fork 已提交的 aria golden 与品牌文本在切割前就有 43 文件 / 65 用例失败，而本改动按构造是行为保持的 |
| `pnpm run doc-sync`（本地） | 33 个门禁通过、3 个失败——`verify-doc-graphs`、`verify-config-catalog`、`verify-package-paths`；三者都未点名本刀触碰的文件 |
| 字节记账 | 193 行追溯行中 190 行逐字节一致；3 行改动与 53 行新撰写已逐项列出 |
| 入口导出面 | 仍是同样 5 个名字 |

`pnpm run typecheck` 是证明新模块进入本包编译面的那道检查。本包的 `tsconfig.client.json` 用一份显式 `files` 清单列出每个源文件，因此新模块登记在其中；没有该条目，入口的 import 会报 TS6307。包级 `tsc -p packages/client/connection/tsconfig.json` 什么都证明不了——那个配置是 `files: []` 的 solution。

## Alternatives considered

- **三个工厂，每簇一个。** 否决：`settingsRemotes` 与 `presetRemotes` 共用 `fixturePresets`，于是 presets 存储必须以参数传入，而它被一个工厂写、被另一个读。那不过是换了个名字的世界状态访问器。
- **两个工厂——凭据独立，settings 与 presets 合在一起。** 否决：凭据存储确实独立，但它属于同一主体。两个工厂换不来读者能据以行动的东西，却要多一条入口绑定，还要把「哪个模块持有 fixture 可写配置」再说一遍。
- **重排该区间，让状态声明在每个读它的簇之前。** 否决，依据「不提未要求的行为变更」：延后求值本就成立，这个顺序就是 `HEAD` 的顺序，保留它使搬移区保持为入口的保序子序列——这正是上面那份字节记账可用的前提。
- **导出那四个 interface。** 否决：模块之外没有消费者指名它们。那样 `verify-export-jsdoc` 会要求给成员写文档，而 `src/types.ts` 是给包的 seam 词汇用的，不是给 fixture 内部词汇。
- **为了让签名与 `createDirectoryPickerRemotes(home)` 对称而给工厂一个参数对象。** 否决：没有簇读的参数就是给下一块区域留的一封邀请函，请它从这里伸手进去。这个参数的不存在本身就是结论。
- **照投影那一刀的做法再加一条 `vitest.config.ts` 豁免。** 否决：这些区域一旦离开世界就可被触达，而文件系统那一刀的先例是把提取所促成的测试写出来。

## Consequences

`fixture.ts` 短了 192 行，`createFixtureWorld` 短了 191 行，留下 `rpc` 派发表作为它自己的 note 归类为「耦合」且尚未搬走的唯一区域。改 fixture 如何应答 settings、credential、agent-preset 调用的人打开 `fixture-configuration-remotes.ts`；改世界如何存 session、workspace 与 event 的人留在入口。

代价是多一个文件、多一条 `tsconfig.client.json` 条目，以及 53 行撰写出来的头部、interface 与工厂框架，对应 193 行搬移行。剩下的区域是 `rpc` 派发表（现为 2249–2459，211 行），它需要先把约二十个 handler 收进一个 interface 才能搬——比哪一块 remote 簇都更大的边界决策。

这一刀确认的模板就是文件系统那一刀的模板，如今连它的退化情形也记下了：**一个簇把世界的值作为参数接收，并持有它自己改动的状态——而当它什么都不接收时，它就什么都不接收。** 当簇读到的每个值都归它自己所有时，零参数工厂就是正确答案。

## Related

- [拆分七个上帝文件](../../proposed/simplification/2026-09-14-god-file-split-plan.zh.md)（计划；本刀是其批次 2 的 `fixture.ts` 条目）
- [提取 fixture 的内存文件系统](2026-09-14-fixture-file-system-module-extraction.zh.md)（点出这个边界问题、并给出本刀所用模板的那一刀）
- [提取 fixture provider 的投影折叠](2026-09-14-fixture-projections-module-extraction.zh.md)（再往前一刀）
