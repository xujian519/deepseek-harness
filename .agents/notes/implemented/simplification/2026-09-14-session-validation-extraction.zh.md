# Agent Note：提取会话头部与事件校验（Issue #86）

Status: implemented

[English](2026-09-14-session-validation-extraction.md) | 中文

## Problem

`packages/core/session/src/index.ts` 长到 1256 行，四个关切共用同一个模块：`SessionStore` 服务、`Session` 类、发布路径，以及一段 306 行的校验器。那段校验器与存储或类不共用任何符号——其中每个函数都接收一个 unknown 值，然后抛出或收窄它——而入口模块只用到其中三个声明，且都在 `Session` 的构造函数内。

[拆分计划](../../implemented/simplification/2026-09-14-god-file-split-plan.zh.md)把 `core/session` 列为批次 1 的条目；该批次的切法按构造保持行为：无实例状态、无新接口、行为不变，且入口模块再导出被搬走的东西。本 note 记录这一刀实际产出了什么。

## Decision

`packages/core/session/src/validation.ts`（345 行）现拥有头部与事件校验器；`packages/core/session/src/index.ts` 现为 950 行。

| 搬走的符号 | 在新模块中的形态 |
| --- | --- |
| `validateSessionHeader`、`validateRestoredSessionHeader`、`snapshotSessionHeader` | 头部校验、分离与冻结；改为导出以便入口导入，且不由入口再导出 |
| `adoptSessionEvent`、`snapshotSessionEvent` | 事件采纳；公开，且由入口以同名再导出 |
| `assertSessionEventEnvelope`、`assertCurrentLlmShape`、`assertAssistantSettlementShape`、`assertAdapterDefaults` | 种子事件封装校验；`assertAdapterDefaults` 一并带走模块私有的 `allowedAdapterKeys` |
| `isMessageEventType`、`MESSAGE_ROLE_BY_TYPE`、`assertMessageEventShape`、`hasProviderModel` | 消息形状校验；模块私有 |

入口仍用到的三个声明是 `assertSessionEventEnvelope`、`validateRestoredSessionHeader` 与 `snapshotSessionHeader`，各自在 `Session` 的构造函数中被调用一次。

### What stayed in the entry

`SessionCallback`、`collectSessionCallbacks` 与 `invokeContainedSessionObservers` 留在入口：它们是发布路径，由 `Session.append`、`SessionStore.announce`、`emitDisposed` 与 `flush` 消费。`SessionEntry` 与模块私有的 `attachments` WeakMap 出于同样的理由留下：计划的批次 3 条目把二者的同址性列为后续 `Session` 切分必须保持的约束，而不是本批次可以搬动的结构细节。

### Why three header validators became exports

`validateSessionHeader`、`validateRestoredSessionHeader` 与 `snapshotSessionHeader` 在入口中原本是模块私有，现在从新模块导出，因为出现了第二个导入它们的模块。三者在 `index.ts` 中都没有再导出，因此包的公开面不变。`Session` 的构造函数是后两者的唯一调用方，而 `snapshotSessionHeader` 与 `validateRestoredSessionHeader` 都会调用 `validateSessionHeader`。

### Two imports moved with the code

来自 `node:path` 的 `isAbsolute` 只有一个调用方，位于 `validateSessionHeader` 内，因此入口不再导入它。`validateSurfaceMetadata` 出于同样的理由离开入口的 `./surface.ts` 导入列表——`adoptSessionEvent` 是它唯一的调用方——而 `validateSessionEventData` 留下，因为 `Session.append` 直接调用它。

### Verification

`pnpm exec tsc -p packages/core/session/tsconfig.json --noEmit` 干净。`pnpm exec vitest run packages/core/session` 报 15 个文件 / 502 通过。`pnpm run typecheck` 覆盖整个工作区并通过，其中包含被搬走的公开函数的两个跨包消费者：`session-query` 与 `session-persistence`。`pnpm exec tsx scripts/run-oxlint.ts packages/core/session/src` 干净，`pnpm run test:docs` 通过 18 道门禁。

导出列表按提取出的名字比对，而不是按行。旧文件声明 `export function adoptSessionEvent`，新文件通过 `export { adoptSessionEvent, snapshotSessionEvent } from './validation.ts'` 再导出它；这是不同的行导出了相同的名字，行级 diff 会报出假差异。两侧都得到同样的 25 个名字，包括来自 `export * from './types.ts'` 的 `*` 与来自 `export default SessionStore` 的 `default`。

没有触碰任何 `jscpd:ignore` 块；被搬走的区域内不含此类标记。

## Alternatives considered

- **为三个头部校验器单开一个 `header.ts`。** 拒绝：`request-header.ts` 已经拥有 `request/header` 事件形状，第二个以 header 命名的模块会让两者在导入处无法区分，且这三个函数与消息校验器共享导入以及 `SESSION_FORMAT_VERSION`。
- **把头部校验与消息校验拆成两个文件。** 拒绝：`assertCurrentLlmShape` 会调用 `assertMessageEventShape` 与 `assertAssistantSettlementShape`，拆开会让两个文件互相导入对方的内部符号，却不会减少读者需要同时记住的东西。
- **把发布路径与校验器一起搬走。** 拒绝：`collectSessionCallbacks` 及其调用方承载 append 的重入与围堵状态，计划把这块推迟为语义问题；搬走它会把这一刀从「已经自包含的代码」扩大为「待评审的行为」。
- **新建 `src/types.ts` 收纳共享词汇（计划规则 3）。** 不适用：该包已有此文件，且没有新的共享词汇——每个符号都连同其消费者在既有模块之间移动，入口为自用而导入其中三个。

## Consequences

`index.ts` 缩短 306 行，`validation.ts` 为 345 行，因此净增部分是模块头加上三个新导出头部校验器所需的 JSDoc。批次 1 的不改变行为规则成立：没有常量、默认值或 schema 值移动，且每条拒绝消息都与入口此前抛出的逐字节相同。包 README 的源码地图在两种语言各增一行，该对的 i18n 一致性记录已重记。

## Related

- [拆分七个 god 文件](../../implemented/simplification/2026-09-14-god-file-split-plan.zh.md)（计划；本项是批次 1 的条目）
- [提取 python 运行时的成本与日志账本模块](2026-09-14-code-runtime-python-cost-and-ledger.zh.md)（批次 1 试点，本 note 沿用其体例）
- `packages/core/session/src/surface.ts`（`adoptSessionEvent` 校验其事件数据的 surface 管理器）
- `packages/session-query/session-query/src/index.ts`、`packages/session/session-persistence/src/storage-contract.ts`（再导出的事件采纳的跨包消费者）
