# Agent Note: Decompose the patent-teams service and state modules by lifecycle owner

Status: implemented

[English](2026-09-21-patent-teams-state-service-decomposition.md) | 中文

## Problem

`packages/patent/patent-teams/src/service.ts` 与 `packages/patent/patent-teams/src/state.ts` 是团队子系统的持久化与协作中心,各自承载多项「变化原因不同」的职责。`service.ts` 持有团队生命周期、任务状态机、契约校验与质量门、成员运行时、状态与归档投影。`state.ts` 持有团队持久化、mailbox lease 协议、任务再分配、key 哈希,以及文件锁与原子写原语。

代价在审阅里可见,不只是体积。`service.ts` 的两处 `v8 ignore` 的理由描述的载荷与返回值,与被它们豁免的代码不是同一版本;这个不一致能存活下来,正因为读一个职责不再意味着连贯地读另一个。`state.ts` 把锁与原子写原语放在它们所保护的记录类型旁边,于是改动 mailbox lease 协议需要读与 lease 无关的代码。

## Decision

按生命周期归属拆分,每步一个提交,包的对外导出面与 durable 文件格式不变。

- **`state.ts` 保留记录层与任务状态机,锁与 mailbox 迁出。** `team-lock.ts` 持有工作区状态推导与锁(`withTeamLock`、`stateRootOf`、`teamLockKey`、`sanitizeKey`、`stripLeadingBom`),以及原子替换原语(`replaceFileAtomicOrDirect`、`atomicWriteText`、`renameWithRetry`)。`mailbox.ts` 持有消息记录与投递协议(`createMessage`、`appendMailbox`、`readMailbox`、`readUnreadMailbox`、`claimMailboxDelivery`、`releaseMailboxDelivery`、`acknowledgeMailbox`)。`state.ts`(455 行)保留团队记录类型及其校验、带尝试世代的任务状态机、团队读写扫描与查找、退役成员名单,以及归档目录搬移。
- **`service.ts` 保留服务面,逐操作的工作迁出。** `task-ops.ts` 持有 create、reassign、claim、update 及其校验与质量门分支;`member-runtime.ts` 持有成员的增删;`team-access.ts` 持有团队查找、成员与任务的前置条件,以及另外两者都需要的锁内重读。第三个模块是刻意的:把这些访问器留在 `service.ts` 里,会让两个新模块反向依赖它。
- **`evidence/engine.ts` 保留引擎,规则解析迁出。** `packages/patent/patent-core/src/evidence/rule-set.ts` 持有 `parseRuleSet` 与 `DEFAULT_WEIGHTS`;引擎保留条件表、三性判定与类型特定判定,以及 `EvidenceEngine`。
- **任务操作的两个消费方保留调用方视角。** `PatentTeamsService` 的 `createTask`、`reassignTask`、`claimTask`、`updateTask` 都是一行委托,因此服务定义仍读作团队的完整服务面,而状态机只住在一个文件里。

## Consequences

`state.ts`、`service.ts`、`evidence/engine.ts` 现为 455、756、761 行,提案时为 907、1382、876 行。

提案的第四条验收项没有落地。它期望 `isOptionalString` 与 `isNonEmptyString` 在包内各只有一处定义,因为 `state.ts` 与 `invariant.ts` 里的可选字符串守卫逐字相同。那次抽取被撤回:新增一个 `guards.ts` 模块会在 `patent-teams` 里产生内容哈希 chunk,而 `verify-built-package-invariants` 拒绝这种发布面,所以合并这两个守卫要以包的发布 chunk 布局为代价。两份定义因此保留,它们是这个取舍里更便宜的一侧;这一对被记入 `scripts/duplication-baseline.json`,与本域其他被接受的克隆同列。该验收项真正想要的东西——守卫有个唯一归宿——不值得改动发布面。

拆分动机里那两处理由漂移的 `v8 ignore` 由 issue #214 单独解决,而且是删除而非改写理由:所有任务事件发射点现在统一展开一个 `attemptFields(task)` helper,它的 JSDoc 写明 `attempt` 与 `attemptId` 都是可选的,因为从未开过 attempt 的任务两个字段都没有;`patent-teams/task-updated` 的 invariant 也改为按可选字段校验。

拆分一个 1382 行的模块会触及每一个 import 内部符号(而非包入口)的测试。这正是要发现的东西,而它把边界定下来了:durable 格式测试与 mailbox lease 测试能干净分离,这就是两个职责不共享状态的证据。上面那处守卫重复,是这次审阅画出的边界唯一没能贯彻到底的地方。

## Alternatives considered

**保留两个文件,加分节注释。** 否决:问题不是文件难导航,而是两个独立职责共用一套错误词汇与一个加锁顺序。注释分离不了它们;那些漂移掉的 `v8 ignore` 理由正是「读文件不等于连贯地读它的各部分」的证据。

**拆成多个包。** 否决:这次拆分在一个包的归属之内——锁、记录、任务转移都是同一份 durable store 契约的组成部分。包边界只会增加发布与依赖开销而没有归属收益,而 mailbox lease 协议必须能与它所保护的记录在同一提交里变更。

**先拆 `service.ts`,缓拆 `state.ts`。** 作为顺序被否决:`service.ts` 的加锁与 lease 语义要调进 state 层,因此先抽 `task-ops.ts` 会把同一团纠缠代码拖进新文件。state 层的拆分是更便宜的第一步,也是让第二步变机械的那一步。
