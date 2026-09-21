# Agent Note: Decompose the patent-teams service and state modules by lifecycle owner

Status: proposed

[English](2026-09-21-patent-teams-state-service-decomposition.md) | 中文

## Problem

`packages/patent/patent-teams/src/service.ts`(1382 行)与 `packages/patent/patent-teams/src/state.ts`(907 行)是团队子系统的持久化与协作中心,各自承载多项「变化原因不同」的职责。

`service.ts` 持有团队生命周期、任务状态机、契约校验与质量门、成员运行时、状态与归档投影。`state.ts` 持有团队持久化、mailbox lease 协议、任务再分配、key 哈希,以及文件锁与原子写原语。

代价在这次审阅里可见,不只是体积。`service.ts` 的两处 `v8 ignore`(约 `:828` 与 `:853`)的理由描述的载荷与返回值与被豁免的代码不是同一版本;这个不一致能存活下来,正因为读一个职责不再意味着读另一个。`state.ts` 把锁与原子写原语放在它们所保护的记录类型旁边,于是改动 mailbox lease 协议需要读与 lease 无关的代码。

## Proposal

按生命周期归属拆分,每步一个提交,保持包对外导出面不变。

1. 从 `state.ts` 抽出 `team-lock.ts`(`withTeamLock`、`atomicWriteText`、`replaceFileAtomicOrDirect`)与 `mailbox.ts`(lease、TTL、投递状态)。`state.ts` 保留记录类型与作用于其上的状态转移。
2. 从 `service.ts` 抽出 `task-ops.ts`(claim、update、validate、gate 各分支)与 `member-runtime.ts`(成员 spawn、wake、投递)。`service.ts` 保留团队级操作与配置。
3. 从 `packages/patent/patent-core/src/evidence/engine.ts` 抽出 `rule-set.ts`,把 `parseRuleSet` 及其校验移出引擎类所在文件。

每一步都是搬移而非重写:不改行为、不改错误类型、不改 durable 格式。既有 `patent-teams/tests`(15 个 spec 文件)是第 1、2 步的验收信号——必须在**不修改测试**的前提下保持绿;若某次搬移需要改测试,那就是该搬移改变了行为的证据。

第 1、2 步同时给同包重复守卫解锁了归宿:`isOptionalString` 在 `invariant.ts:28` 与 `state.ts:707` 定义相同,两个消费方都在本包内,拆分让这些守卫有了自然的落点。

## Alternatives considered

**保留两个文件,加分节注释。** 否决:问题不是文件难导航,而是两个独立职责共用一套错误词汇与一个加锁顺序。注释分离不了它们;那些漂移掉的 `v8 ignore` 理由正是「读文件不等于连贯地读它的各部分」的证据。

**拆成多个包。** 否决:这次拆分在一个包的归属之内——锁、记录、任务转移都是同一份 durable store 契约的组成部分。包边界只会增加发布与依赖开销而没有归属收益,而 mailbox lease 协议必须能与它所保护的记录在同一提交里变更。

**先拆 `service.ts`,缓拆 `state.ts`。** 作为顺序被否决:`service.ts` 的加锁与 lease 语义要调进 state 层,因此先抽 `task-ops.ts` 会把同一团纠缠代码拖进新文件。state 层的拆分是更便宜的第一步,也是让第二步变机械的那一步。

## Acceptance criteria

- 每一步都是纯搬移:`pnpm vitest run packages/patent/patent-teams/tests` 与 `pnpm vitest run packages/patent/patent-core/tests` 在**无测试改动**下通过。
- `pnpm run typecheck` 通过;包的公开导出与 durable 文件格式不变。
- `service.ts` 的两处 `v8 ignore` 在同一改动中处理完毕:核实,或删除让门禁报告。
- `isOptionalString` 与 `isNonEmptyString` 在包内各只有一处定义。
- `pnpm run duplication` 仍然通过。

## Risks

拆分一个 1382 行的模块会触及每一个 import 内部符号(而非包入口)的测试,因此首个提交会暴露所有曾伸手进内部的测试。这正是要发现的东西,但处理方式应是改从入口 import,而不是从新文件再导出内部符号——否则拆分买不到任何东西。若 durable 格式测试与 mailbox lease 测试无法干净分离,那本身就是两个职责共享状态的证据,边界必须在搬移之前重画。
