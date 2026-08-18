# Agent Note: self-evolve 失败事件源与验证门修复

Status: implemented

[English](2026-08-17-self-evolve-event-sources-and-validation-gates.md) | 中文

## 问题

self-evolve 能力在计划（spec.md/tasks.md/check_list.md，对齐《自进化优化.md》评审）与运行时行为之间存在结构性缺口：

- **失败事件没有生产者。** `failure-patterns` 投影分类的是 `tool/error` 与 `agent/request-error` **会话事件**，但 harness 中没有任何代码追加它们。工具失败实际以 `tool/result` 持久化（shell 工具渲染 `[exit code: N]` / `[killed by signal: …]` 标记，或 `isError` + `{name, code}`）；`agent/request-error` 是 Cordis 上下文 waterfall，不是会话事件。计划最关心的两个 verifier 层级（`subprocess-exit`、`llm-provider`）在生产中永远无法触发。
- **模型可见声明超出真实行为。** 工具提示片段声称提案"仅在 held-in 与 held-out 回归验收后提交"、L4 请求会触发人类审批；而 `validateProposal` 恒 accepted（confidence=0），且不存在任何审批路径。
- **死配置。** `maxDailyLoopsPerSession` 被解析与记录但从未执行；`lastStartByTrigger` 只读不写，per-trigger `minIntervalMs` 门形同虚设；`_verifyHeldInCase`（双 verifier 决策）无调用者；`maxDirtyLinesAddedPerCommit` 只服务于它。
- **无负面结果持久化、无 proposer 失败上下文、无测试**（provider、工具消费者、invariant 均无测试），idle-maintenance 监听器静默吞错误。

## 决策

把每个 verifier-grounded 信号接到真实持久数据源，并让循环行为如实，一次改动覆盖三个 self-evolve 包：

- **分类 `tool/result` 而非 `tool/error`。** 投影现在折叠 `tool/call` 身份（callId → name，state 内有界映射，`stateVersion` 2 → 3），并分类 `tool/result` 失败面：shell 退出/信号标记解析为 `subprocess-exit` tier，签名 `exit=N:stderr前缀` / `signal=S:stderr前缀`；`isError` 结果退化为 `tool-runtime` tier，键为 `error.name`。`tool/error` 会话事件声明移除（无生产者；bash 非零退出是渲染标记而非错误事件）。
- **追加 `agent/request-error` 会话事件。** `self-evolve-basic` 提供方在 waterfall 监听器中追加 `{provider, statusCode, error: {code, name, message}}`（取自 `LlmFailure`），并总是通过 `next()` 让渡。声明保留在 `dsh-self-evolve`；catalog 重新生成以纳入它与 `self-evolve/*` 事件。
- **双 verifier 决策接线。** `requireDualVerification`（默认 true）门控 `validateProposal`：当 `collectReplaySignal` 与 `collectWorkspaceSignal` 都返回信号时由 `_verifyHeldInCase` 裁决（混合失败或双失败 → rejected 且 `regressions: []`）；基础收集器返回 `null`（P1.2 重放 / P1.3 工作区基础设施尚未构建），门退化为 bracket smoke 验证器并明确标注，而非伪造验收。
- **负面结果（P1.7b）。** 拒绝按每行一条 JSON 追加到 `$DSH_HOME/self-evolve/negative-results.jsonl`（`persistNegativeResult`），`readNegativeResults(patternId, limit)` 读回，模板 proposer 把每个模式最近 3 条被拒记录摘要进生成的 section 文本。
- **速率限制修复。** `maxDailyLoopsPerSession` 现在以 24h 滚动窗口门控自主触发器（`idle-maintenance`/`pressure`/`validation-retry`）；循环启动时写入 `lastStartByTrigger`，使 `minIntervalMs` 真正生效。
- **如实声明。** 工具提示片段、工具描述、README（中英）、seam JSDoc 均说明：基础提供方只实现 L1/L2，验证在 P1.2/P1.3 落地前是 P0 bracket smoke，尚无 L4 审批路径。idle 监听器改为记录日志而非吞错误。
- **测试。** 四个文件共 47 个测试：投影（tool/result 分类、签名稳定、工具名配对）、invariant 括号（9 例）、provider（双验证、每日上限、minInterval、负面结果、request-error 生产者、`eligiblePatterns` 阈值上抬）、工具消费者注册与执行。
- **catalog 与 patent 修复。** `gen-persistence-catalog` 现在通过：self-evolve 会话事件去掉 `@mode` 标签（日志事件没有调度模式）并重新生成 catalog；既有 `patent/plantask`/`patent/workflow-run` 声明的 `@mode` 违规以同样方式修复。

## 备选方案

**由 `core/agent-loop` 生产 `tool/error` 与 `agent/request-error`。** 否决：事件声明位于 `dsh-self-evolve`，不把词汇移入 core 的话 agent-loop 的类型图看不到它们；且 bash exit≠0 不是 `isError` 工具结果，`tool/error` 生产者仍会漏掉 `subprocess-exit` tier。分类已然持久的 `tool/result` 把改动留在能力包内部。

**verifier 不可用时拒绝所有提案（`requireDualVerification` + 无信号 → reject）。** 否决：P1.2/P1.3 基础设施落地前循环将永远无法提交任何东西，摧毁 P0 bracket-smoke 的目的；诚实的中间路线是显式 `null` 收集器 + 有文档说明的 smoke 回退。

**保留夸大承诺的提示词等 P1 再改。** 否决：模型可见输入必须与持久现实一致是 harness 惯例；声明在同一次改动中修正。

## 后果

- `pnpm exec tsc -b packages/self-evolve/*` 与 `pnpm exec vitest run packages/self-evolve/` 通过（47 测试）；子树 staged oxlint 干净；tsdown bundle 构建成功；`verify-persistence-catalog` 绿，`KNOWN_SESSION_EVENT_TYPES` 包含 `agent/request-error` 与全部六个 `self-evolve/*` 事件。
- 投影持久状态新增 `toolCalls`，`stateVersion` 升至 3；v2 状态无法反序列化（未发布，无兼容承诺）。
- 模型可见文本改为低承诺：基础提供方对 L3/L4 不产出提案，验证在 P1.2/P1.3 前如实标注为 bracket smoke。
- 仍延后（roadmap gate）：P1.2 重放 verifier、P1.3 工作区 verifier、P1.4 LLM judge、P1.9 60 题 SWE-bench 评估与 CI 跨零自动停开关、P2/P3/P4 阶段、`p0-bracket` keyless snapshot；`verify-translation-pairing` 全库仍因既有 patent 配对而红。
- `gen-persistence-catalog` 同时解除了待提交共享文件的阻塞；patent `@mode` 修复是两行声明清理，无行为变化。
