# Agent Note：self-evolve 提交重复、lint 加固与诚实声明

Status: implemented

[English](2026-08-18-self-evolve-commit-and-lint-hardening.md) | 中文

## 问题

对 self-evolve 插件的审查发现一个真实缺陷与若干债务项：

1. **`self-evolve/commit` 双重 append**。`applyCommit` 追加了 commit 事件（durable 载荷中带占位 `commitSeq: 0`），`executeLoop` 又为同一提案追加了第二条 commit 事件。日志中每个 accepted 提案出现两条 commit 事件，第一条带假 seq；若接线 bracket invariant companion，第二条 append 会被拒绝。没有任何测试覆盖完整循环的提交路径，重复因此未被发现。
2. **类型谎言**。`validateL4Proposal` 向 `runner.define` 传入 `sessionId: agent.sessionId as never`，而两侧本就携带同一个 `SessionId` brand。整个包子树在仓库默认配置下还有 42 处 type-aware oxlint 违例（多余的 `as` 断言、对字符串做 `String()` 转换、非穷尽 switch、死防御条件），而 master 同配置是干净的。
3. **对已类型化载荷的死防御读取**。投影把 `compaction/end` 的 `error` 当作对象（`{ name }`）读取，而声明的持久类型是 `error?: string`；生产者追加的是 `errorChain(error)` 字符串。对象分支永远匹配不到真实事件；`self-evolve/end` 分支对无冒号错误名的切片还会静默截掉最后一个字符。
4. **诚实性缺口**。基础提供方未实现 workspace verifier（P1.3b），`minAcceptConfidence` 不可达，基础 bundle 中永远不会发生提交；工具 prompt 与 README 仍把提交描述为"实验性"而非"当前不可能"。held-out 通过率阈值 `0.6` 是硬编码字面量；四处近乎相同的读文件/解析例程（negative results、global patterns、champion archive ×2）存在重复。

## 决策

在一次限定范围内跨 self-evolve 各包修复上述四项：

- `EvolveCommit.commitSeq` 改为可选：事件无法引用自身 seq，因此 `self-evolve/commit` 载荷省略该字段，循环从 append 结果把它填入 `SelfEvolveResult.commits`。`applyCommit` 追加唯一的 commit 事件并返回其 seq；`executeLoop` 不再追加第二条。
- 移除 `as never` 断言及其余 42 处 type-aware lint 违例；子树在默认 89 规则配置与 staged 48 规则门禁下均干净。
- 投影的 `compaction/end` 分支读取真实的 `error?: string` 载荷；两处字符串错误分支共享 `errorNamePrefix` helper，按首个冒号切片且不再截断无冒号的名称。
- `minHeldOutPassRate` 成为经验证的 `Config` 字段（默认 `0.6`）而非字面量；新的 `src/jsonl.ts` 中 `readJsonlRows`/`readLatestJsonRow` 取代四处重复的读取例程；`runLoop` 的限流记账移入 maintenance 回调内部，被拒绝的启动不再消耗每日上限。
- 工具 prompt 片段、两份 README 与 spec 现在如实说明：基础 bundle 的提案被保守拒绝，在子类提供 workspace 信号（或 L3/L4 路径产生提案）之前不会发生提交。
- 回归覆盖：完整循环测试断言恰好一条 commit 事件且其 seq 与结果记录一致；限流测试现在在 stub 的 DSH_HOME 下运行真实 maintenance 任务。

## 备选方案

**保留载荷占位并在下游去重。** 拒绝：durable 事件携带假的 `commitSeq: 0` 是数据谎言，任何消费者都不应被迫忽略它。

**实现基线 workspace verifier（P1.3b）而非文档化。** 拒绝：使基础提交成为可能是行为变更，应等待 P1.10 的 60 题评估证据（spec 自身的回滚条件）；文档化不可达路径是诚实的中间状态。

**把事件载荷改为 `{ runId, proposal, validation }`。** 拒绝：最小的 `commitSeq?: number` 改动保持载荷形状不变，invariant 对 `commit.proposal.proposalId` 的读取也无需改动。

## 结果

- 每个 accepted 提案只产生一条 `self-evolve/commit` 事件；bracket invariant companion（若接线）不再看到重复提交。
- `pnpm run typecheck`、`pnpm exec vitest run packages/self-evolve/ packages/bundle/self-evolve-app/`（85 测试）、双配置 oxlint、`verify-package-invariants`、`gen-tool-catalog --check` 全部通过。
- `compaction/end` 失败模式现在携带真实的错误名签名而非常量回退；`self-evolve/end` 的无冒号错误名不再被截断。
- 仍延后：P1.9b workspace verifier、P1.10 评估、keyless snapshot，以及 `turnHasFailure` 的全量会话扫描。
