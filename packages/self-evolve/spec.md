# Self-Evolve 路线图（v0.1 DP → P4）

## 证据等级声明

本路线图的前提假设是："Cordis 论文提出的时空可组合性 + Self-Harness 三阶段循环（Weakness Mining / Harness Proposal / Proposal Validation）在 60 题 SWE-bench 子集上确实能带来净正向收益"。

该假设当前仅有：

- Cordis 论文的观察性证据（Koishi 生态、TypeScript 单语言）。
- 翁荔博客《Harness Engineering for Self-Improvement》对 Self-Harness 框架的综述。
- 社区复现报告与 DeepSeek Harness 团队负责人的方向背书。

**尚未经过本项目独立受控实验验证。**

**非目标**：本方案不宣称"RSI / 递归自我改进已经跑通"。我们只宣称"跑通最小工程闭环 + 在 60 题离线子集上提供统计显著性证据或证伪"。

**回滚条件**：Phase 1 验证结束后，若净胜分 95% 置信区间跨零（无法排除随机性），立即回滚范围：默认关闭、仅保留 L1-skill、不做 P2/P3/P4。

---

## 优化对象递进链

严格对齐翁荔博客给出的递进顺序：

| 阶段 | 优化对象 | 对应层级 | 风险等级 |
|---|---|---|---|
| P0 | 骨架 + L1 skill + L2 prompt section | 指令提示词 / 结构化上下文 | 低 |
| P1 | Validator：held-in + held-out 双 verifier | 验证基础设施 | 中 |
| P3 | L3 workflow + L4 harness 审批 | 工作流 / harness 代码 | 高 |
| P2 | Step-Reflection + CSR（agent loop 级改动） | Meta-Harness | 最高 |
| P4 | Global Negative-Results Knowledge Base | 优化器 / 长期知识 | 高 |

**关键顺序**：P3 必须排在 P2 之前。Step-Reflection 每步都吃 token，必须在"validator 质量可接受、P3 held-out 双验证稳定"之后再开启，否则 token ROI 提前爆炸。

---

## 风险矩阵（对齐翁荔七大未来挑战）

| 风险 | 缓解机制 | 配置/回滚 |
|---|---|---|
| **弱/模糊评估器导致 Verifier 错判**（SWE-bench 假阳/假阴） | Held-In + Held-Out 使用双 verifier：① 项目内 `dsh test`；② 独立 `git diff --stat` + `build`。两者都 pass 才认定 held-in pass；单边 pass 视为"不确定"，直接 reject，不计入 regressions。**现状**：决策函数已接线（`_verifyHeldInCase` + 信号收集钩子），信号收集器（P1.2/P1.3）未落地前退化为 bracket smoke 并如实标注。 | `requireDualVerification: boolean`（默认 true，已实现） |
| **负面结果被丢弃** | rejected proposal 的 `nextRoundSuggestion` + `diagnostic` + `deconstructedScores` 结构化写入 `$DSH_HOME/self-evolve/negative-results.jsonl`（append-only）。proposer prompt 前缀附加"过去 N 次类似尝试为何失败"的 3 条摘要。**现状**：持久化 + 读取 API + 模板 proposer 前缀已实现；LLM 版前缀待 P3.2。 | Phase 1 实现，可配置 `negativeResultsMaxContextItems: number`（当前常量 3，待配置化） |
| **短期解决 vs 长期 prompt 膨胀** | 每个 L2 proposal 带"最小生效字节数"声明；累计新增文本每超过 2K 阈值，由独立 pruning job 把过去 7 天 usage count=0 的 section 归档。 | `maxPromptInflationBytesPerWeek: number`（E.2，未实现） |
| **多样性坍缩** | 每会话提案上限 `maxProposalsPerLoop`；跨会话 global KB 去重相似 causalSignature。 | 已配置（`maxProposalsPerLoop` 生效；global KB 去重属 P4） |
| **Validator 漂移** | patternId 基于 `(level, verifierTier, causalSignature)` 稳定化；验证结果与 pattern 绑定而非与 summary 绑定。 | 已实现 |
| **Token 爆炸** | idle/pressure 触发 rate limiting；Step-Reflection 延后到 P3 稳定后。 | 已配置（含 24h 自主循环上限 `maxDailyLoopsPerSession`） |
| **L4 误批** | L4-harness 默认走人类审批；`clientVersionUpdatesApproved` 保持 false。**现状**：flag 默认 false 已在 `cordis-host-runner` 生效；self-evolve 自身的 L4 提案路径（P3.2 的 runner 翻译）未实现，缓解未闭环。 | 已实现（flag 侧）；路径侧待 P3 |
| **人类角色"上移"** | 审批保留在人类可理解的摘要层（L4、reflection 开关），不陷入每步微决策。 | P3/P2 设计原则 |

## 失败事件源（G1 修复后）

投影的 verifier-grounded 信号全部来自真实 durable 事件：

- **`tool/result`**：shell 工具失败面（渲染文本中的 `[exit code: N]` / `[killed by signal: …]` 标记，或 isError 工具错误），工具名经配对的 `tool/call` 身份解析 → `subprocess-exit` / `tool-runtime` tier。
- **`agent/request-error`**：由 `self-evolve-basic` 在请求失败 waterfall 上追加的 durable 会话事件（provider/model/statusCode/error.code）→ `llm-provider` tier。
- **`compaction/end`**（带 error）→ `tool-runtime`（L2-context）。
- **`self-evolve/end`**（带 error）→ `agent-loop` tier（自引用闭环）。

原先声明的 `tool/error` 会话事件已移除：生产环境无生产者（bash 非零退出是渲染标记而非错误事件），声明属于死词汇。

## 阶段定义

### P0：骨架（当前已实现）

- Service Definition / Provider / Consumer 三分层。
- `failure-patterns` projection 支持 verifier-grounded causal signature（stateVersion=3，含 `toolCalls` 身份映射）。
- L1 skill + L2 prompt section 基础 provider。
- 事件括号 `self-evolve/start` → `end` + invariant 测试。
- 事件源接线：`tool/result` 分类 + `agent/request-error` 生产者。

### P1：Validator（Phase 1 完成）

- [x] Held-In 双 verifier 决策接线（`requireDualVerification` 默认 true；fork 重放收集器 P1.2；workspace 信号为基础钩子待 P1.3b）。
- [x] Held-Out 相似历史重放（P1.3，`sessionQuery.searchEvents` + fork 重放，弱路径 0.3）。
- [x] LLM judge（P1.4，`validatorTarget` 路由，4 维度评分；与 proposerTarget 同路由拒绝加载）。
- [x] L1 skill 持久化（P1.5，`ctx.fs` 写 `<project>/.dsh/skills/`）；failedProposals 回写（P1.6）。
- [x] negative results 持久化 + 读取 + 模板 proposer 前缀（P1.7b/P1.8）。
- [x] Champion-Challenger 归档与回滚（P1.8）；prompt 膨胀 pruning（P1.9，`estimatedBytes` + `maxPromptInflationBytesPerWeek`）。
- [ ] 60 题离线子集 baseline + 净胜分 95% CI 评估（含 CI 跨零自动停开关）；Phase 1 snapshot 录制（需 key 环境）。

### P3：L3 + L4 审批（Phase 2 完成）

- [x] L3 workflow smoke（P2.1）：validation 期 `runWorkflowSmoke` + applyCommit 提交前复核。
- [x] L4 harness 审批流（P2.2）：`dynamicCordisRunner.define` + `run`，Client-bearing 必走人工审批；refusal → `approval-denied`。
- [x] L4 二次保险（P2.3）：runner 新增 `cordis/before-approval` waterfall；跨 proposal 或超 `l4ReapprovalHours` 强制重审；`clientVersionUpdatesApproved` 默认 false。

### P2：Step-Reflection + CSR（Phase 3 完成）

- `agent/pre-step` 级低预算 reflection（2K/512，节流 + 置信度门，命中既有模式才加权）。
- LLM 版 proposer（proposerTarget 路由 + JoyCode CSR 经验段 + negative 前缀；无路由回退模板）。
- per-pattern 24h 冻结 + `maxBudgetCharsPerLoop` hard-cap。

### P4：Global KB（Phase 4 完成）

- 跨会话 `global-patterns.jsonl`（P4.1）+ 24h 滚动 occurrences 合并提前触发阈值（P4.2）。
- causalSignature 相似度去重（留待后续）。
