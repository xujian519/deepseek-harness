# Agent Note：提取 fixture 的 RPC 派发表（Issue #86）

Status: implemented

[English](2026-09-14-fixture-rpc-dispatch-extraction.md) | 中文

## Problem

`packages/client/connection/src/client/fixture.ts` 曾为 2483 行，它最后一块耦合区域就是 `rpc` 对象：一个含六十条端点臂的 `call` switch 与一个含五条臂的 `open`，合计 211 行。该表不直接读任何世界状态——每个有状态的端点都经由某个 remote 簇、session 或 workspace API 对象、流式 opener，或一个小 helper 到达状态——但这些十九个值都是世界里的局部量，只要它们留在原处，这张表就搬不走。

[拆分计划](../../proposed/simplification/2026-09-14-god-file-split-plan.zh.md)把这一项列为批次 2 在 `fixture.ts` 上剩下的条目，并预告了代价：那约二十个 handler 需要先有一个 interface。本刀建好那个 interface，并把表搬走。

## Decision

`packages/client/connection/src/client/fixture-rpc.ts`（318 行）导出 `createFixtureRpc(deps: FixtureRpcDeps): ClientConnectionRpc`；`fixture.ts` 为 2288 行。

| 搬走的东西 | 在新模块中的形态 |
| --- | --- |
| `rpc` 对象的 `call` 与 `open`（2249–2459） | 工厂返回的 `ClientConnectionRpc` |
| `fixtureModelGroups`、`DEEPSEEK_REASONING`、`OPENAI_REASONING`、`ModelProviderGroup` | 模块级目录，由 `session/modelCatalog` 与 `llm/discoverModels` 提供 |

`FixtureRpcDeps` 声明在 `fixture.ts` 而不是新模块，这是本刀主要的边界决策。它的成员用入口自己的声明来定型——`FixtureSessionApi`、`FixtureWorkspaceApi`、`FixtureControlFrame`、`WorkspaceFollowFrame`、`FixtureRemoteEventResult`、三个文件内 remote 簇，以及五个 opener。若把它声明在新模块，就得把这十二个类型全部导出（连同它们的 JSDoc 义务）；声明在它们所在之处只要一次导出，并让依赖清单与其命名的值相邻。

新模块通过 `Parameters<FixtureRpcDeps[...]>` 投影取用它需要的类型——`SessionApi`、`WorkspaceApi`、goal 引用、follow 请求与 remote 事件结果——因此不需要再搬任何类型。两个类型声明 `FxGoalRef` 与 `FxGoalView` 从 `createFixtureWorld` 函数体提升到模块级，依赖清单才得以命名它们。

### 各条臂保住了什么

六十五条臂全部保留端点名、实参整理与内联载荷。两处编辑是机械的，且只限于类型引用：

- `Parameters<FixtureSessionApi['list']>[0]` 及其同族改为 `Parameters<SessionApi['list']>[0]`，因为 session API 现在经依赖清单到达。
- 六条 `workspace/*` 臂原先直接断言 `WorkspaceCreateRequest` 及其同族；现在断言 `Parameters<WorkspaceApi['create']>[0]`，与 session 臂既有的写法一致。那六个请求 interface 仍作为模块私有留在入口，所以这是同一个收窄，只是写成平行家族早已采用的写法。

`workspaceFileRemotes` 离开入口的导入，改为由新模块直接导入：它是 `fixture-file-system.ts` 的模块级值，不是世界局部量，因此不需要依赖槽位。

### 测试变得可行，于是补上

`fixture-rpc.ts` 不在根 `vitest.config.ts` 的 GUI 债豁免名单里——那条目以精确路径点名 `fixture.ts`——所以逐文件门禁立即生效。有二十九条端点臂与两条拒绝路径在该包里一条测试都没有：五条 `agentPresets/*`、三条 `subagents/*`、三条 `llm/*`、`fileReferences/list`、`sessionReferenceResolver/candidates`、`directoryPicker/pick`、`settings/{canOpenAgentPresetDirectory,openSettingsDocument,openAgentPresetDirectory,mutate}`、`session/{openWorkspacePath,canOpenWorkspacePath,fork,attachment,updateQueue}`、`workspaceFiles/{read,stat,list,changes}`、`workspace/{insertBefore,archiveSession}`，以及 `open` 方法的通道守卫与未知端点拒绝。

`tests/fixture-rpc.client.spec.ts` 直接构造依赖集合，断言每条臂做了什么：到达哪个依赖、带了什么实参、应答哪个固定载荷，以及两个通道守卫都会拒绝。四项覆盖率指标均为 100%，未新增任何豁免。这个文件从此可以作为一个单元被触达，这正是本刀换来的东西：在此之前，要走到一条臂，只能把整个 fixture 世界驱动一遍。

### Verification

| 检查 | 结果 |
| --- | --- |
| `pnpm exec vitest run packages/client/connection` | 17 文件 / 216 通过（此前 16 / 201，加上 15 个新例） |
| `src/client/fixture-rpc.ts` 的覆盖率 | 语句／分支／函数／行均 100% |
| `pnpm exec tsc -p packages/client/connection/tsconfig.json --noEmit` | exit 0 |
| `pnpm run typecheck` | exit 0 |
| `pnpm exec tsx scripts/run-oxlint.ts packages/client/connection/src packages/client/connection/tests` | 41 文件，0 警告 0 错误 |
| `pnpm run verify-export-jsdoc` | 每个导出名都有文档 |
| `pnpm run duplication` | 0 处克隆 |
| `pnpm run test:docs` | 18/18 |
| `pnpm run doc-sync` | 33 通过 / 3 失败——doc graphs、config catalog、package paths，均在 `origin/master` 基线上原样复现 |

入口的导出清单新增 `FixtureRpcDeps` 与 `FixturePageRequest`，未减少任何名字；`FixtureWorld`、`createFixtureFaces`、`createFixtureConnectionRpc`、`FixtureOptions`、`FixtureAssistantStreamFrame` 均不变。两项新增都不由包入口再导出，因此已发布面没有移动。

## Alternatives considered

- **把 `FixtureRpcDeps` 声明在 `fixture-rpc.ts`。** 否决：为了一个消费者要导出入口的十二个内部类型，而每个新导出都欠着这些类型作为模块私有时从不需要的 JSDoc。
- **把三个文件内 remote 簇（`commandRemotes`、`referenceRemotes`、`goalRemotes`）也抽成独立模块。** 否决：三者都读写世界状态（`logOf`、`append`、`sessions`、`setGoalActivation`），独立成模块就需要一个世界状态访问器——正是文件系统那一刀点名否决的边界。
- **只把十条与世界无关的臂抽成零参数工厂。** 作为更弱的切法否决：它移走六十行字面量，却把表拆在两个文件里，另外五十五条臂仍与世界耦合。计划里的条目是整张表。
- **把六条 `workspace/*` 的类型断言改写为导出它们的请求 interface。** 否决：`Parameters<WorkspaceApi[...]>` 正是平行 session 臂读取其请求类型的方式，且让另外六个 interface 保持模块私有。

## Consequences

`fixture.ts` 减少 195 行，`fixture-rpc.ts` 为 318 行，因此净增即依赖清单加上模块头。点名 `fixture.ts` 与 `fixture-projections.ts` 的两条 `TODO(gui)` 覆盖率条目保持不变；本刀未新增任何条目。批次 2 至此清空——计划已在上一刀把它的 `typert/generator` 条目移入批次 3——Issue #86 因批次 3 的其余条目保持开放。

## Related

- [拆分七个上帝文件](../../proposed/simplification/2026-09-14-god-file-split-plan.zh.md)（计划；本刀清空批次 2）
- [提取 fixture 的配置类 remote](2026-09-14-fixture-configuration-remotes-extraction.zh.md)（本刀承接的上一刀，也是三个依赖槽位的来源）
- [提取 fixture 的内存文件系统](2026-09-14-fixture-file-system-module-extraction.zh.md)（定下「一个簇拥有什么」的切法）
- `packages/client/connection/src/client/fixture-rpc.ts`、`packages/client/connection/tests/fixture-rpc.client.spec.ts`
