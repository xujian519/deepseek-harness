# Self-Evolve 任务清单

> **内部工作追踪文档（非参考，不参与双语/doc-sync）**：用于自进化插件的阶段推进与验收记录，内容会随进度漂移。权威参考——子系统见 [`docs/subsystems/self-evolve.md`](../../docs/subsystems/self-evolve.md)（含 `.zh.md`），各包契约见各自双语 README，设计决策见 `.agents/notes/implemented/` 下 self-evolve 相关 Agent Note。

## P0 骨架（已完成）

- [x] P0.1 Service Definition：`SelfEvolveEngine` + `self-evolve/*` 事件。
- [x] P0.2 Failure-pattern projection：verifier-grounded `causalSignature` + `verifierTier`。
- [x] P0.3 Basic provider：L1 skill + L2 prompt section 提案与提交。
- [x] P0.4 Tool consumer：`self_evolve_inspect_patterns` + `self_evolve_now`。
- [x] P0.5 Invariant companion：事件括号检查。
- [x] P0.6 构建与文档修复：README、tsdown、Agent Note。
- [x] P0.7 事件源接线（G1 修复）：`tool/result` 分类 + `agent/request-error` 生产者。

## Gate-SIG（Signature 中间验收）

- [x] SIG-1/SIG-2/SIG-3：`eligiblePatterns` 阈值上抬、patternId 稳定、zod 严格解析、stateVersion=3。

## P1 Validator（Phase 1）

- [x] P1.1 `ProposalValidationOutcome` 扩展：`deconstructedScores` / `confidence` / `replayEvidence[]` / `nextRoundSuggestion`；reject reason 新增 `low-confidence`。
- [x] P1.1b Held-In 双 Verifier 决策接线：`requireDualVerification`（默认 true）+ `_verifyHeldInCase`；T+F / F+F → rejected 且 regressions=[]；信号缺失按弱路径 0.3 计。
- [x] P1.2 Held-In replay 验证：`replayCase` 经 `ctx.subagents` 的 `fork` provider 重放失败场景（child 继承父历史前缀，end-seed 后的事件用失败投影折叠检测重触发 patternId）；基础设施缺失时返回 null 走弱路径。
- [x] P1.3 Held-Out 跨会话构造：`collectHeldOutSignal` 用 `sessionQuery.searchEvents` 搜索相似历史并逐个重放；无 sessionQuery / 无命中 → null 弱路径。**注意**：workspace verifier（Verifier B：`git diff --stat` + build）仍为基础 `collectWorkspaceSignal` 钩子（子类实现）。
- [x] P1.4 Deconstructed LLM-Judge：`_judge` 经 `validatorTarget` 路由 4 维度打分（0-1 钳制，JSON 解析失败退化为结构分）；`validatorTarget ≠ proposerTarget` 加载期校验。
- [x] P1.5 L1 skill 持久化：applyCommit 经 `ctx.fs` 写 `<project>/.dsh/skills/<name>/SKILL.md`（frontmatter name/description/whenToUse）；fs 缺失时仅运行时注册。
- [x] P1.6 Validator reject 回写：`readPatterns` 把最近失败注入每个模式的 `verifierMeta.failedProposals`（源自 negative-results 日志）。
- [x] P1.7b 负面结果沉淀：`persistNegativeResult` + `readNegativeResults` + 模板 proposer 前缀。
- [x] P1.8 Champion-Challenger：提交前归档 champion 到 `$DSH_HOME/self-evolve/archive/<patternId>/`；同一模式连续 2 次 rejection 自动回滚最新 champion。
- [x] P1.9 L2 `estimatedBytes` 声明 + pruning job：`maxPromptInflationBytesPerWeek`（默认 2048）超限时把最旧 section 归档到 `$DSH_HOME/self-evolve/l2-archive/` 并 disposer 撤销（7 天 0 调用按注册时间近似，最旧优先）。
- [ ] P1.7 Phase 1 snapshot 录制（需 API key 的 keyless 录制，待 `pnpm run test:snapshot:record` 环境）。
- [x] P1.9b Workspace verifier 具体实现：`captureWorkspaceBaseline`（重放前 git 基线）+ `collectWorkspaceSignal`（重放后净脏增量 `git diff HEAD --numstat`/未跟踪行数，排除 `.dsh/`，+ `buildCommand` 健康判定）；未配置 `workspaceVerifier.buildCommand`、非 git 仓库或 shell 服务缺失时退化为弱路径。`_verifyHeldInCase` 新增 `build-failed` 原因；`validateProposal` 改为顺序采集（先重放、后工作区检查）。
- [x] P1.10a 评估脚手架（PR11/P1-14 支撑）：`packages/test-support/self-evolve-eval`——确定性 `selectSubset`（seed 可复现）、配对 `results.json` schema 与 `validateResults`、`summarize`/`bootstrapCi`（10k 重采样分位数 95% CI）/`wilsonCi`、`decide`/决策记录 I/O、CLI（subset/score/decide --write）+ `verify-self-evolve-eval` CI 停开关（记录为 rollback 时门禁失败）；单测覆盖确定性、评分、区间与决策路径。
- [ ] P1.10 60 题离线子集评估：baseline vs self-evolve 净胜分 95% CI（含 CI 跨零自动停开关，PR11/P1-14）——实机双跑需 keyed+docker 环境，尚未执行。

## P3 L3 + L4 审批（Phase 2）

- [x] P3.1 L3 workflow smoke：`runWorkflowSmoke` 经 `ctx.workflowEngine` 执行候选脚本（`stopReason='completed'` 且 `agentsStarted≥1` 通过）；validation 作为 held-in 信号 + applyCommit 提交前复核。
- [x] P3.2 L4 harness 审批流：`validateL4Proposal` 经 `dynamicCordisRunner.define` + `run`（Client-bearing 必走人工审批，awaiting-approval/starting/running 视为进入激活管线）；refusal → rejected `approval-denied`；runner 未挂载 → 拒绝。
- [x] P3.3 L4 二次保险：cordis-host-runner 新增 `cordis/before-approval` waterfall（审批武装前咨询，listener 可强制 requiresApproval=true）；self-evolve 包装器按台账强制跨 proposal / 超 `l4ReapprovalHours`（默认 24h）重审。`clientVersionUpdatesApproved` 默认 false 已在 runner。
- [x] P2.4 base patch `defaultLevels` 保持 [L1, L2]（L3/L4 需显式开启）。

## P2 Step-Reflection + CSR（Phase 3 完成）

- [x] P2.1 `agent/pre-step` reflection hook：每轮至多 `maxStepReflectionsPerTurn` 次；仅当轮内存在持久失败面（tool/result 失败标记 / request-error）时触发；2K 输入 / 512 输出低预算；confidence ≥ `reflectionMinConfidence`（0.85）且命中既有模式 → 追加 `self-evolve/reflection` 事件，投影 occurrences +1。
- [x] P2.2 LLM 版 proposeForPatterns：`proposerTarget` 配置且 llm 挂载时走 `proposeWithLlm`（JSON 提案数组解析，仅 L1/L2）；JoyCode CSR 经验段（`resolved <summary>` searchEvents 命中前 3 条）+ negative-results 前缀；无路由回退模板。per-pattern 24h 冻结（`patternFreezeHours`，两次提案后第三次跳过）。
- [x] P2.3 `maxBudgetCharsPerLoop`（32768）hard-cap：judge/提案/搜索调用计费，超限 `budget-exceeded` 中止并以错误关闭 bracket。

## P4 Global KB（Phase 4 完成）

- [x] P4.1 跨会话 `global-patterns.jsonl`：每次 loop 结束前追加 {ts, sessionId, patternId, occurrences}。
- [x] P4.2 24h 滚动合并：`readPatterns` 把其他会话 24h 窗口内的 occurrences 并入（排除本会话行），提前触发挖掘阈值。
- [ ] P4.3 causalSignature 相似度去重（roadmap P4.3 原为 snapshot；去重留待后续）。

## 工程债

- [x] E.1 idle-maintenance listener 错误日志化。
- [x] E.1b `maxDailyLoopsPerSession` + per-trigger `minIntervalMs` 落实。
- [x] E.2 Prompt inflation pruning job（P1.9 内实现）。
- [ ] E.3 negative-results proposer 前缀条数配置化（`negativeResultsMaxContextItems: number`；当前为硬常量 `NEGATIVE_RESULTS_CONTEXT_ITEMS = 3`，见 spec.md §风险矩阵"负面结果被丢弃"）。
