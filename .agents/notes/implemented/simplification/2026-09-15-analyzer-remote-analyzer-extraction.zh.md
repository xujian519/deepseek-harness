# Agent Note：提取 analyzer 的 Remote/RPC 分析器（Issue #86）

Status: implemented

[English](2026-09-15-analyzer-remote-analyzer-extraction.md) | 中文

## Problem

`packages/typert/generator/src/analyzer.ts` 曾为 2206 行，仍塞着两簇。类型建模器已搬到 `src/type-graph.ts`；留下的是 Remote/RPC 分析器——决定一次调用的装饰器与 gateway 读取、lookup 或 Context 参数取自哪张 type-meta 映射、每个线上字段投影到的严格 JSON 边界，以及生成器消费的调用模型——它与调用它的包遍历交错在一起。它的 22 个成员全是私有的，因此文件之外无人叫得出这一簇的名字，想看 RPC 契约的读者只能在 `collectExplicitServices` 与 `collectEvents` 之间找它。

[拆分计划](../../proposed/simplification/2026-09-14-god-file-split-plan.zh.md)点名了这一刀并预判了它的形态：状态归类型图之后，它只剩三处调用点需要出文件。搬移前实测，这三处正是该簇写入类型图所拥有状态的地方——`allocateNodeId`、`setNode` 与 `setDeclaration`。该簇其余的依赖全是读取。

## Decision

`packages/typert/generator/src/remote-analyzer.ts`（1025 行）导出 `class RemoteAnalyzer`、`RemoteAnalyzerDeps` 与 `validateInvocationIdentity`；`analyzer.ts` 为 1253 行。

| 搬走的东西 | 在新模块中的形态 |
| --- | --- |
| `collectInvocations`、`invocationModel` | `RemoteAnalyzer` 方法；`collectInvocations` 是唯一公开入口 |
| `remoteMarker`、`remoteResultType`、`isGlobalAbortSignal` | `RemoteAnalyzer` 方法，逐字搬移 |
| `gatewayBinding`、`gatewayFieldBinding`、`gatewayServiceBinding`、`gatewayBindingArguments` | `RemoteAnalyzer` 方法，其载体 `GatewayBinding` 随之搬走 |
| `lookupDeclarations`、`contextDeclarations`、`typeMetaMapMembers` | `RemoteAnalyzer` 方法，连同它们填充的 `staticLookups` 与 `staticContexts` 备忘 |
| `remoteBoundary`、`resolvedRemoteCodecType`、`assertRemoteJsonType`、`includesRemoteAbsence`、`isRemotePhantomConstraint`、`resolvedCycleReference` | `RemoteAnalyzer` 方法，逐字搬移 |
| `namedWorkspaceType`、`publicRemoteType`、`isWorkspaceClass` | `RemoteAnalyzer` 方法；`PUBLIC_REMOTE_TYPE_ROOTS` 随它们搬走 |
| `validateInvocationIdentity` | 接收 face 与已分析出的包的导出函数 |

### 依赖清单就是切口

`RemoteAnalyzerDeps` 接五个值：checker、其 type-meta 声明给出 lookup 与 Context 键的 face 程序、`TypeGraph`、`registrationForFile`，以及程序的已解析源文件。该簇原先对分析器类型图委派的十处调用——`fail`、`location`、`resolveSymbol`、`symbolAtType`、`symbolId`、`isTypeMetaSymbol`、`convertType`、`addNode`、`requiredType` 与 `allocateNodeId`——改为直呼 `this.graph.<方法>`，而不是再建一套同名委派：那些委派是为分析器自身的调用点而存在，新消费方点明「这是谁的操作」只多一个前缀。

另有三处调用不再出分析器。`allocateNodeId`、`isTypeMetaSymbol` 与 `requiredType` 在簇外已无读者，其委派一并删除，八个导入随之消失。

### 这一刀让什么变得可测

跨包身份校验此前只能靠分析一整个 fixture 工作区触达：`tests/remote-model.spec.ts` 改写 fixture 并跑一次限时 60 秒的分析来证明冲突。成为一个「face + 已分析出的包」的函数之后可直接调用，`tests/remote-invocation-identity.spec.ts` 手工构造两个包——四例、2 毫秒，其中一例钉住两种身份同时重复时消息先报哪一个。

id 稳定性测试是这次搬移的守卫。`tests/node-id-stability.spec.ts` 手写钉住全部同址序号（含 Remote codec 的七行），`tests/__snapshots__/type-model.spec.ts.snap` 逐字节比对，因此访问次序一旦重排即失败，而不是以快照 diff 的形式落地。

### Verification

| Check | Result |
| --- | --- |
| 搬移后的类体 | 施加十条改名规则与一次可见性变更后，与原区域逐字节一致 |
| `pnpm exec vitest run packages/typert/generator` | 10 文件 / 207 通过，快照全部匹配 |
| `pnpm exec tsc -p packages/typert/generator/tsconfig.json --noEmit` | 退出码 0 |
| `pnpm exec tsx scripts/run-oxlint.ts packages/typert/generator` | 0 警告、0 错误 |
| `pnpm run duplication` | 2229 文件 0 克隆 |
| coverage | 不受门禁：`packages/typert/*/src/**` 是既有豁免 |

## Alternatives considered

- **把边界与 codec 这一半拆成第二个模块。** 否决：`isWorkspaceClass` 被调用那一半读取，`remoteBoundary` 在其中被四处调用；拆分只会为了缩短两个本就小于本包最大模块的文件而多出导出。
- **在新类里保留类型图委派。** 否决：十一个私有单行函数，唯一作用是让搬走的文本一字不动，而点明归属是同一处改动。
- **让 `validateInvocationIdentity` 保持私有、经分析器测试。** 否决：那正是这一刀要消除的 60 秒路径，而该校验并不需要程序。
- **把 `PUBLIC_REMOTE_TYPE_ROOTS` 搬进 `src/types.ts`。** 否决：只有一个函数读它，它也不是两个模块共享的词汇。

## Consequences

`analyzer.ts` 减少 953 行，保留包遍历、导出图、服务与事件收集、显式服务收集与发现；`remote-analyzer.ts` 收下把带装饰器的方法变成 RPC 端点的全部读取。批次 3 的清单已完：五个条目全部落地，因此计划笔记自身的验收条件——迁往 `implemented/`——现已到期。

## Related

- [拆分七个上帝文件](../../proposed/simplification/2026-09-14-god-file-split-plan.zh.md)（本计划；这是批次 3 第八刀落地）
- [提取 analyzer 的类型图](2026-09-15-analyzer-type-graph-extraction.zh.md)（正是它把这一刀测得只剩三处调用点）
- [钉住 analyzer 的节点 id](../testing/2026-09-15-node-id-stability.zh.md)（每次 analyzer 搬移的守卫）
- `packages/typert/generator/src/remote-analyzer.ts`、`packages/typert/generator/tests/remote-invocation-identity.spec.ts`
