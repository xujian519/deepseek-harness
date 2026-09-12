# Agent Note: 快照 harness 等待超时时指名所等待的状态

Status: implemented

[English](2026-09-12-snapshot-wait-diagnostic.md) | 中文

## 问题

`packages/test-support/session-snapshot/src/harness.ts` 为场景脚本可请求的等待步骤轮询持久化状态:`waitForTurnStart`、`waitForTurnEnd`、`waitForSubagentTurnEnd`、`waitForGoalPhase`、`waitForInboxMessage`、`waitForTitleAfterTurnEnd`、`waitForEventAfterTurnEnd` 与 `waitForFile`。这 8 处等待此前都委托 `vi.waitFor(callback, { interval: 10, timeout })`,由回调在所等状态缺失时抛出调用方自己的诊断(`snapshot-harness: session "…" did not persist turn/end within 20ms`)。

`vi.waitFor` 只在**截止前已有尝试抛出**时才重抛回调错误——它的 `handleTimeout` 是 `let error = lastError; if (!error) error = new Error("Timed out in waitFor!")`。而这里的回调都是异步的:要读会话目录并解析 JSONL。于是在负载较高的机器上,首次尝试可能仍在自己读文件时截止就到了,失败文案变成 `Timed out in waitFor!`——既不说明在等什么状态,也不说明是哪个 session。

仓库里能看到两个后果:

1. **CI 偶发失败。** PR #114 的首次 CI 在 `waitForGoalPhase requires the requested durable goal phase` 上失败,文案正是 `Timed out in waitFor!`;同一提交重跑即绿。该断言用 20ms 预算,是这里唯一没有针对该竞态做防护的超时断言。
2. **围绕它已经积累了两处绕行。** `waitForPersistedChildTurnEnd` 把自己的等待包在 try/catch 里,把诊断与底层失败作为 `cause` 重抛,注释写的是「截止可能先于首次 harvest」。测试侧 `isolateDiagnosticTimeout` 则 monkey-patch `vi.waitFor`,让 20ms 预算的断言先直接跑一次回调再进入计时等待。第三处 `titleDiagnosticTimeoutMs` 出于同一原因把 Windows 上的预算抬到 5s。

## 决策

8 处等待现在都调用同一个 helper `waitForPersisted(probe, diagnostic, timeoutMs)`:

- **探针是谓词。** 它返回所等状态是否存在,诊断移到调用点,因此每处等待只写一次状态名,也没有探针用「抛错」表示「尚未到达」。
- **预算同时约束「状态出现」与「探针本身」。** helper 让每次探针与剩余预算赛跑,因此仍在读自己的文件、甚至干脆卡住的探针,也会报出调用方的诊断。
- **探针抛错仍可重试。** `harvestSessionLogs` 可能与正在轮转的会话文件相撞,所以读失败应重试而非直接致命;而截止到达时,报告的是最后一次失败而不是诊断——一次读失败比一个迟迟不出现的状态更有信息量。
- **被放弃的尝试要接住。** 被截止抛下的探针会挂一个空拒绝处理,免得之后以 unhandled rejection 的形式冒出来。

两处绕行随其遮掩的缺陷一起删除:`waitForPersistedChildTurnEnd` 不再需要那层 try/catch;测试侧删掉 `isolateDiagnosticTimeout` 与 Windows 预算分支,标题那条断言在各平台统一用 20ms 预算。

## 考虑过的其他方案

**给每处 `vi.waitFor` 都套 try/catch,把诊断与底层错误作为 `cause` 重抛。** 这是最小改动,也与子会话等待此前的做法一致。否决:它埋掉了探针自身失败的身份,而 `waitForPersistedTurnStart` 是刻意把畸形记录报成那条校验错误、而不是报成状态缺失——该路径有自己的注释与测试钉住。8 段重复的 try/catch 也会把同一个决策重述 8 遍。

**识别 vitest 自己的超时文案,只替换那一种。** 否决:匹配库的内部字符串很脆,而且 vitest 一升级,失败方式是静默的——等待会悄悄退回报库的文案。

**抬高预算。** 否决:这是报告缺陷,不是给慢机器留余量。加大预算会拖慢每个场景,而且在首次尝试足够慢时仍然丢掉状态名——那 5s 的 Windows 预算本身也没让子会话等待变得确定。

**保留 `vi.waitFor`,进入计时等待前先跑一次回调。** 否决:首次回调一旦卡住,整个等待就挂死,而这正是子会话等待测试用「首个 `readdir` 永不返回」所覆盖的情形。

## 后果

超时的等待现在在任何平台都会指名所等待的状态、session(或子会话与轮次)与预算。轮询中的读失败会以读失败本身呈现——此前子会话等待把它报成诊断并把失败挂为 `cause`,其余等待则直接重抛,现在 8 处口径一致。

harness 不再使用 `vi.waitFor`,因此它的测试改为断言 harness 自己的诊断,而不再去 patch 库。被截止抛下的尝试仍会在后台把文件 I/O 跑完,与 `vi.waitFor` 时相同。

## 测试

`pnpm exec vitest run --coverage packages/test-support/session-snapshot` —— 344 通过、1 跳过,`harness.ts` 语句、分支、函数、行均为 100%。

- `identifies the child wait when its first log harvest outlasts the deadline`(既有):mock 的 `readdir` 永不返回,等待仍须指名子会话与轮次。
- `reports the harvest failure when a listed log cannot be versioned`(新增):向会话根目录预置一份文件名与头声明格式版本不一致的日志,等待须报该不一致而不是「状态缺失」——即报告探针自身失败的那条分支。

`pnpm run test:snapshot` 回放驱动本 harness 的录制会话:127 通过、5 失败——这 5 项在合并基线的干净检出上同样失败,而 fork CI 不跑快照回放,所以该套件在本次改动前已经是红的。

## 相关

- [ACP 快照测试](2026-06-19-acp-snapshot-tests.zh.md) —— 引入本 harness 及其等待步骤的套件。
- Issue #92 —— 本次修复所属的测试可靠性族。
