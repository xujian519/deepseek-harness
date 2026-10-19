---
kind: upgrade-guide
description: "`SelfEvolveEngine` 新增 `requestEvolve`，`self_evolve_now` 返回队列回执，self-evolve 类型改为品牌类型，`BenchmarkEvolveConfig.agentStateDir` 变为必填，并新增随包发布的 `self-evolve` profile。"
---

# Self-evolve 触发、队列与配置

[English](guide.md) | 中文

## 变更

`SelfEvolveEngine` 新增抽象方法 `requestEvolve(agent, levels?)`，返回 `EvolveRequestReceipt`（`{ requestId, status: 'queued' | 'coalesced', queuePosition }`）。`@deepseek-ai/dsh-self-evolve-basic` 把它实现为 per-session 的内存队列，在 idle 边界与每次 loop 结束后驱动，因为工具无法在自己的 turn 内启动维护工作。`self_evolve_now` 返回该回执而不是 run 结果。显式请求永不被淘汰、也不受限流；队列满（`maxPendingEvolveRequests`，默认 `8`）时淘汰最旧的自主请求，level 集合相同则合并。活过进程的排队请求会丢失。

触发器包括非 subagent 会话的 `agent/status` idle、自动压缩（`compaction/start` 的 `turn` 非空）、显式 `user-command`，以及配置了 `proposerTarget` 时 `low-confidence` 拒绝后的一次 `validation-retry`。`verifier-unavailable` 永不重试。`allowUnverifiedAutonomousRuns`（默认 `false`）让部署在没有 `workspaceVerifier.buildCommand` 或没有 `validatorTarget` 时跳过自主 loop；显式请求仍会执行，并仍报告 `verifier-unavailable`。

`registerL1Skill` 与 `registerL2Section` 在注册前先 dispose 之前的 self-evolve 贡献，L1 提交若撞上不属于本 provider 的名字则以 `apply-failed` 拒绝，回滚会恢复 champion；首次提交的回滚则写入 tombstone，由 skill 文件系统忽略。

`FailurePattern.patternId`、`EvolveProposal.proposalId`、`readPatterns` 的 session id 与 `SelfEvolveAgentContext.sessionId` 都是品牌类型。`BenchmarkEvolveConfig.agentStateDir` 变为必填，并校验相对路径、非目录、`baseDir`、`cwd`、home 与文件系统根，非空目录还需带 `.self-evolve-benchmark` 标记。`PROFILE_TEMPLATES` 新增 `self-evolve`。

## 迁移

1. 为本仓库之外的每个子类实现 `requestEvolve`，并且不要在工具调用内执行 loop。
2. 把 `self_evolve_now` 的结果读作回执；结果请从 `self-evolve/*` 事件或 follow-up 消息获取。
3. 显式传入 `agentStateDir`，指向专用的状态目录而不是工作区。
4. 用 `FailurePatternId`、`EvolveProposalId` 与 `SelfEvolveRunId` 铸造品牌标识。
5. 按部署复核 `allowUnverifiedAutonomousRuns`，因为默认值会停掉周期性的空转 loop。
6. 回滚首次提交后预期出现一条 skill 扫描 warning。
7. 确认：`pnpm exec vitest run packages/self-evolve` 通过，`pnpm dsh --profile self-evolve --help` 可解析，且 `self_evolve_now` 返回 `status: "queued"` 的那个 turn 之后出现 `self-evolve/start` 与 `self-evolve/end`。
