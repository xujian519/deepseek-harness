# 自进化插件推进路线图（2026 Q3）

> **历史草稿（superseded）**：本目录为自进化插件的原始设计工作稿（2026-08-20），内容陈旧，不再维护。当前权威状态与阶段验收以 [`packages/self-evolve/spec.md`](../../../../packages/self-evolve/spec.md)、[`packages/self-evolve/tasks.md`](../../../../packages/self-evolve/tasks.md)、[`packages/self-evolve/check_list.md`](../../../../packages/self-evolve/check_list.md) 为准。

## 范围与定位

本文件定义 `@deepseek-ai/dsh-self-evolve-*` 包组从骨架到可用产物的五阶段落地路径。所有设计复用已有基础设施，不引入新的 runtime 或第三方存储。

**文档属性**：实施计划（reference）；不发布到 docs，不要求双语翻译。

---

### 证据等级声明（强制对齐调研报告 §九 + Cordis 论文局限 §）

本路线图的前提假设是「Cordis 论文提出的时空可组合性 + Self-Harness 三阶段循环（弱点挖掘→有界提案→双集回归验证）在 60 题 SWE-bench Verified 子集上确实能贡献净正向统计显著收益」。该假设当前仅有：
1. Cordis 论文的观察性证据（Koishi 单生态、TypeScript 单语言，缺与替代方案的受控对比）；
2. 社区工作（Skill RSI、Live-SWE-agent、JoyCode、Memento-Skills、AREX）的独立复现报告；
**尚未经过本项目独立受控实验验证**。

若 Phase 1 Validator 收敛后 60 题净胜分 95% 置信区间跨零（无法排除随机性），应立即将范围收敛为 L1-only 且默认关闭，不进入 Phase 2、3、4。

**不宣称**：本方案 = RSI（递归自改进）已经跑通。只宣称：跑通最小工程闭环 + 离线 60 题提供统计显著性证据或证伪。

---

## 目标（12 周窗口）

1. 让 L1（skill）和 L2（system-prompt section）两层自进化在 60 个 SWE-bench 验证子集中**真正贡献净正向分差**（相对基线 ≥+5pp，95% 置信区间下界 >0）。
2. 自进化循环的**提案-验证-提交**三步 100% 事件可回放，任何 commit 可在 2 分钟内被回滚到 champion 版本。
3. 单次 idle maintenance 对 token 预算的冲击**上限为 8K 输入 + 4K 输出**，不会挤掉主对话预算。
4. L3（workflow）和 L4（dynamic harness）的提交流程复用 `cordis-host-runner` 审批机制，**不会出现自动越过审批的提交**。

---

## 非目标（明确排除）

- 参数级 / weight 级自改进（LoRA、PPO、在线 fine-tune 等）——后续里程碑评估，不在本次窗口。
- 跨用户的全局 skill 共享市场或云端 pattern KB——先做项目级本地 global KB（Phase 4）。
- "自动修自己的自己修改自己"闭环（元自改进）——先把对业务代码的效果跑通。
- 默认自动开 L4 harness 级提案——L4 在 base patch 里永远需要显式 approveFutureVersions，否则永远走人工审批（符合草案 §Sandbox 边界）。
- **对外宣称"本方案 = RSI 已经跑通"**：仅宣称最小工程闭环 + 离线显著性证据或证伪。

---

## 架构对齐：每项能力的复用位置

| 本方案能力 | 复用的现有基础设施 | 挂接位置 |
|---|---|---|
| idle phase 触发 | `ReactLoopAgent` phase 状态机 + `runMaintenance` | [agent.ts](file:///Users/xujian/projects/deepseek-harness/packages/core/agent-loop/src/agent.ts#L142-L162) |
| 增量 failure pattern 挖掘 | `SessionProjectionRegistry.register` | [registry](file:///Users/xujian/projects/deepseek-harness/packages/session/session-projection/src/index.ts#L194-L222) + [failure-projection.ts](file:///Users/xujian/projects/deepseek-harness/packages/self-evolve/self-evolve/src/failure-projection.ts#L135-L146) |
| held-in 单例 replay 验证 | `subagent-fork-in-process` + `workflow engine` | [tool-workflow](file:///Users/xujian/projects/deepseek-harness/packages/workflow/tool-workflow/src/index.ts#L205-L300) 的 `agent()` 封装 |
| held-out 跨会话相似案例构造 | `sessionQuery.searchEvents`（SQLite FTS5） | [sqlite engine](file:///Users/xujian/projects/deepseek-harness/packages/session-query/session-query-sqlite/src/index.ts#L256-L282) |
| L1 skill 持久化到磁盘 | `skill-filesystem` 的 fs observation + 解析器 | [parseSkillFile](file:///Users/xujian/projects/deepseek-harness/packages/skill/skill-filesystem/src/index.ts#L793-L835)；文件格式不用发明 |
| 框架级副作用回滚 | `ctx.effect` 注册 disposer | [applyCommit](file:///Users/xujian/projects/deepseek-harness/packages/self-evolve/self-evolve-basic/src/index.ts#L166-L197) L1/L2 case |
| L4 审批流程 + host/client 双端激活 | `cordis-host-runner` + `cordis-client-runner` | [run()](file:///Users/xujian/projects/deepseek-harness/packages/extensions/cordis-host-runner/src/index.ts#L248-L312) 的 requiresApproval 分支 |
| 提案结果 steer 回模型 | `steerRunOutcome` → `agent.steer` | [cordis settleActivation](file:///Users/xujian/projects/deepseek-harness/packages/extensions/cordis-host-runner/src/index.ts#L1019-L1047) |
| 提案成功率监控 | 6 个 `self-evolve/*` 事件入 session log，session-query 可检索 | [types.ts](file:///Users/xujian/projects/deepseek-harness/packages/self-evolve/self-evolve/src/types.ts#L97-L161) |

---

## 分阶段设计与决策

> **阶段顺序**：严格对齐调研报告 §二 51 行的「优化对象递进链」：
> 指令提示词 → 结构化上下文 → 工作流（ADAS/AFlow） → harness 代码 → 优化器
> 因此：L1/L2 → L3 workflow → Step-Reflection（改主循环 = harness 级），顺序严格不跳。

### Phase 0：骨架闭合（1-2 天）

**目的**：让 6 个 `self-evolve/*` 事件第一次真的出现在 session log 里，便于后续写 snapshot 测试。

关键改动：
- `BasicSelfEvolveEngine` 构造函数中新增 `ctx.on('turn/end', ...)` 监听器。turn 结束时同步读 `ReactLoopAgent.phase === idle`，若满足就以 `trigger='idle-maintenance'` 调用 `evolveIfNeeded`。
- 把 `evolveIfNeeded` 接收的 `agent` 上下文从"需要外部传 runMaintenance 绑定"改为"内部通过 agent id 从 `ctx.agents` 查 agent，直接 bind 到对象方法"，降低调用方书写成本。
- `proposeForPatterns` 最小可用实现：无 LLM，纯模板，对 `tool/result` 失败面（shell `[exit code: N]` / `[killed by signal: …]` 标记或 isError）产出一个 L2 `section`，section 文本为 pattern.summary + 建议的调试步骤。
- `validateProposal` 最小可用实现：**always accepted，但 heldInPassed=0、heldOutPassed=0、regressions=[]**——Phase 0 只验证事件 bracket 闭合，不验证 validator 质量。（现状：双 verifier 决策已接线，见 Gate P1-2。）

**验收事件流**：一个脚本化对话，故意触发两次同一类 `bash exit 1`，turn/end 后应出现：`self-evolve/start` → `self-evolve/mined` → `self-evolve/proposed` → `self-evolve/validated` → `self-evolve/commit` → `self-evolve/end`，6 个事件 runId 一致。

---

### Phase Sig（中间 Gate：Verifier-Grounded Causal Signature 改造）（0.5-1 天）

**目的**：让 FailurePattern 的定义严格符合 Self-Harness 论文「verifier-grounded + 因果状态」，不是表面文本错误分类。不做这一步，Phase 1 Validator 的 held-out 会反复把"同一个 exit code 但不同原因"的 pattern 当成同一个，纯浪费 token。

关键改动：
1. `FailurePattern` 加字段：
   - `verifierTier: 'tool-runtime' | 'subprocess-exit' | 'llm-provider' | 'agent-loop'`
   - `causalSignature: string`（不是表面文本，而是 verifier 层能区分失败因果的签名：如 `exitCode+stderr前200sha1`、`error.code` 等）
2. `classifyFailure` 细分：
   - `bash` / `shell` tool：verifierTier = subprocess-exit，causalSignature = `exit=N:stderr前200`（渲染标记 `[exit code: N]` / `[killed by signal: …]`，经 `tool/result` + 配对 `tool/call` 身份）
   - `agent/request-error`：verifierTier = llm-provider，causalSignature = `error.code ?? statusCode`（会话事件由 basic provider 在 waterfall 上追加）
   - 其它（普通 isError tool/result）：verifierTier = tool-runtime，causalSignature = `JSON.stringify(error.name)`
3. patternId 稳定算法由 `(level+summary)` 升级为 `(level+verifierTier+causalSignature)`，**summary 保留用于展示但不参与 ID 计算**，避免文本微调影响模式归并。
4. 降级分支（verifierTier=tool-runtime，因果签名最弱）的 `minPatternOccurrences` 阈值自动由 2 上调为 3，防止弱证据提前触发。

**实现状态**：以上 4 项全部完成（SIG-1~SIG-7 全 ☑）。`tool/error` 事件声明已移除——生产环境无生产者（bash 非零退出是渲染标记而非错误事件），失败面统一从 `tool/result` 分类。

---

### Phase 1：Judgement / Validator 体系（4-6 天，trust 底座）

**目的**：把 Validator 从"恒 accepted"升级为 Skill RSI 论文风格的可解释打分。Phase 1 结束后 commit 的提案才被算作真的有效。

关键改动：
1. `ProposalValidationOutcome` 扩展字段：`deconstructedScores`, `confidence`, `replayEvidence[]`, `nextRoundSuggestion`。向下兼容：`kind`, `heldInPassed`, `heldOutPassed`, `regressions` 保留。
2. **Held-In 双 Verifier**（报告 §七 「弱/模糊评估器」的直接对应）：每个 case 必须同时满足（a）原 dsh test exit=0，（b）`git diff --stat` + build 通过双判定；只有 a∩b 才算 held-in pass；单侧通过视为「不确定」，直接 reject 且不计入 regression 列表（保守策略）。
3. Held-In 重放：从 `pattern.supportingSeqs` 的最近一条失败 seq 取前后上下文（窗口 ±3 events），以 `subagent-fork` 同 seed 重放一次 +candidate、一次 -candidate，对比是否不再出现同 ID 的失败 pattern。
4. Held-Out：调用 `ctx.sessionQuery.searchEvents({ query: pattern.summary, limit: 5 })`，每个命中都作为独立 held-out case 跑，≥ 60% 通过才允许通过。`openAt=never` 时跳过 held-out 并强制 `confidence = 0.3`（低置信，commit 不会直接生效，只在事件流里留下"验证不充分"的痕迹）。
5. **负面结果沉淀**（对应翁荔挑战 #4：「Negative Results」——「不改进的数据也值钱」）：每次 `outcome.kind==='rejected'`，把 `{ts, patternId, proposalId, reason, diagnostic, deconstructedScores, nextRoundSuggestion}` 一条一行写入 `$DSH_HOME/self-evolve/negative-results.jsonl`（append-only）。`proposeForPatterns` 正式接入 LLM 后，prompt 前缀先固定放「过去 3 次同 pattern 的类似尝试为什么失败」的 3 条摘要——直接从 negative-results.jsonl 里按 patternId 过滤取最近 3 条。
6. L1 skill 持久化：commit 成功后，把 skill 内容写成 Markdown 文件到 `<project>/.dsh/skills/<sanitized-name>/SKILL.md`，frontmatter 填充 `name` `description` `whenToUse`。文件写完后依赖 `skill-filesystem` 的 fs observation 自动 reload，**不写额外 invalidate 调用**。

---

### Phase 2：L3 Workflow + L4 Dynamic Harness 接审批流（4-6 天）

> **为什么放在 Step-Reflection 之前？**——因为调研报告 §二 51 行的递进链明确：prompt → context → **工作流（ADAS/AFlow）** → harness 代码。L3 = AFlow 层，先跑通再碰 Meta-Harness 级主循环改动。

**原则**：不重写任何审批 UI / Host 激活逻辑。把 L3/L4 candidate 翻译为 `cordis-host-runner` 已有的输入格式，剩下的全部复用。

关键改动：
1. L3 workflow 验证：`applyCommit` 中遇到 `kind === 'L3-workflow'` 时，用 `ctx.workflowEngine.start({ script, parent: agent })` 跑一次 smoke 测试，agentsStarted ≥ 1 且 stopReason='completed' 才接受。
2. L4 harness 验证 & 提交：不直接激活，只调用 [cordis-host-runner.run()](file:///Users/xujian/projects/deepseek-harness/packages/extensions/cordis-host-runner/src/index.ts#L248-L312)。因为 `plan.definition.clientCode !== undefined` 时 `requiresApproval` 默认 true，加上 `clientVersionUpdatesApproved` 默认 false，**一定会挡回人工审批**；用户点 approveFutureVersions 后后续版本才会免打扰。Host 的 steer 结果自动 steer 回 agent，不用我们再发消息。
3. **L4 二次保险**（cordis-host-runner 外层 wrapper 注入，不改源码）：即使 `approveFutureVersions=true`，只要「跨 proposalId 或 距上次审批 >24h」就强制重审，防止误勾复选框造成自动改 Harness。
4. 把 `defaultLevels` 在 base patch 里**默认保持 L1+L2**。L3、L4 必须由用户在 profile 中显式开启，防止默认开太宽。

---

### Phase 3：Step-Reflection + 经验检索（5-7 天，最大分差点）

> 必须在 Phase 2 跑通后再开。Live-SWE-agent 论文 reflection 每步都吃 token，**Validator 质量不稳时这部分是纯开销**（Phase 1~2 先稳、再 reflection）。
> **Live-SWE-agent 数据**：reflection + tool creation 贡献 62% → 73% 段约 +11pp 净胜，ROI 高于 Validator 深度化。

关键改动：
1. 注册新的 agent loop waterfall hook：`agent/pre-step`（模型刚返回 tool-call / message 后）。仅当本 turn 出现 `tool/error` 或 `agent/request-error` 时，额外发一次极低预算的 LLM call（max_input=2k, max_output=512），输出三元组 `<confidence, patternId 推测, 建议改动一句话>`。置信度 ≥ 0.85 时，写入 `failure-patterns` 作为 extra evidence（occurrences +1，supportingSeqs 增加本步 seq）——**不用等到 Maintenance，失败当下就加权**。
2. `proposeForPatterns` 正式接入 LLM 时，prompt 里先塞 **JoyCode CSR 经验段**：
   ```
   ctx.sessionQuery.searchEvents({ query: 'resolved ' + pattern.summary, limit: 3 })
   ```
   把最近三次"类似问题真的被解决"的 session patch diff 作为 few-shot 直接塞进 proposal prompt，按 JoyCode 数据减少约 30% token 同时涨分。
3. 节流：`BasicSelfEvolveConfig` 新增 `maxStepReflectionsPerTurn = 1`，默认 1，不允许多次 reflection 吃预算。
4. **长期 vs 短期对齐保护**（对应翁荔挑战 #7：「长期成功 vs 短期目标」）：每个 L2 section proposal 必须携带 `estimatedBytes` 声明；过去 7 天内 system prompt 新增字节累计超过 `maxPromptInflationBytesPerWeek = 2048` 时，maintenance 独立的 pruning job 跑一次：把「过去 7 天 0 次被 step 明确调用过的 self-evolve 生成 section」统一归档到 `$DSH_HOME/self-evolve/l2-archive/` 并撤销 effect 注册，保证长期不 prompt 膨胀。

---

### Phase 4：跨会话 Global Pattern KB（3-4 天，最后的放大系数）

将 pattern 的 occurrences 从"会话内"扩展到"项目级"，把稀疏 pattern 提前触发阈值。

实现：
- Maintenance 最后，把 `{ sessionId, patternId, occurrences, ts }` 一条一行追加到 `$DSH_HOME/self-evolve/global-patterns.jsonl`。
- 下次读 projection 后，同步读 jsonl 做一次 occurrences 加总，写到内存态；`minPatternOccurrences` 阈值以"本地 + 全局合计（24h 滚动窗口）"判定。
- 不引入 sqlite 或 leveldb，jsonl append + 启动时内存合并足够，100 次 session 后单文件大小约 1MB。

---

## 风险与缓解（对齐翁荔七大未来挑战 + Cordis 论文局限）

| 风险（对应翁荔挑战编号） | 机制 | 配置 / 回滚 |
|---|---|---|
| ① 连续 commit 把 prompt 改退化（Champion-Challenger 漂移） | 每次 commit 成功把旧版本复制到 `$DSH_HOME/self-evolve/archive/<id>/`；`nextRoundSuggestion` 若出现连续 2 次同类 regression，一键 rollback（archive 里的 champion 写回原路径 + disposer 激活）。 | `maxConsecutiveRegressions=2`。 |
| ② 多样性坍缩（所有 proposal 盯同一 pattern） | 同一 `patternId` 在 24h 窗口最多 2 次 proposal，随后冻结。 | `patternFreezeHours=24`。 |
| ③ Validator 本身漂移（LLM-as-Judge） | `validatorTarget` 与 `proposerTarget` 独立配置，固定 model + seed，禁止主对话默认 model 混用； | config 强制两 target 不同，否则 load-time 抛错。 |
| ④ **弱/模糊评估器假阳假阴**（翁荔挑战 1） | Held-In 双 Verifier：`dsh test pass ∩ build+diff stat 健康` 双独立判定通过才叫 pass；单边通过 = 不确定 = reject。 | `requireDualVerification=true`。 |
| ⑤ **负面结果被丢 → 重复踩坑**（翁荔挑战 4） | rejected → 结构化写入 `negative-results.jsonl`，proposer prompt 前缀固定三条「过去为什么失败」。 | Phase 1 对应任务 TASK-P1.7b。 |
| ⑥ **短期 vs 长期：prompt 通货膨胀**（翁荔挑战 7） | L2 proposal 带 `estimatedBytes`；每周 pruning job 把 7 天 0 调用的 self-evolve section 归档。 | `maxPromptInflationBytesPerWeek = 2048`。 |
| ⑦ Maintenance 吃掉太多 token | `maxPatternsReadPerLoop = 50` 硬上限；`maxProposalsPerLoop = 2` 已有。每步做字节累计，超预算直接触发 `maintenanceSignal.abort()`。 | `maxBudgetCharsPerLoop = 8192*4`。 |
| ⑧ 人类误点 approveFutureVersions → L4 失控 | L4 的 approveFutureVersions 勾选后仍保留「跨 proposalId 或 >24h 强制重审」双保险。 | cordis-host-runner 外层 wrapper 注入。 |

---

## 成功指标与评估方案（阶段顺序已对齐：P1→P2→P3 = Validator → L3/L4 → Step-Reflection）

**离线跑一次 60-problem SWE-bench Verified 子集**（和 JoyCode 子集中验证的那 60 题对齐）：

| 指标 | 基线（无自进化） | Phase 1 目标 | Phase 2 目标 | Phase 3 目标 |
|---|---|---|---|---|
| top-1 解决率 | 45pp（mini-SWE-agent） | +3pp → 48pp（L1/L2 + Validator 生效） | +2pp → 50pp（接入 L3 工作流） | +8pp → 58pp（Step-Reflection + CSR 激活，总 +13pp 相对基线 ≥+5pp 的目标在此达成） |
| commit 正向率（accepted / proposed） | N/A | ≥40% | ≥40% | ≥35% |
| 平均每 solved problem token 增量（相对基线） | N/A | ≤+15% | ≤+25% | ≤+35% |
| 跨会话 pattern 提前触发率（Phase 4 打开后） | N/A | - | - | ≥25% 的 pattern 在更早一次 session 就达到 threshold |

评估时严格走 keyless snapshot 之外的 `test:e2e`，并记录每一步的 `self-evolve/*` 事件日志。所有评估跑三次独立 seed 取平均。若 Phase 1 结束净胜分 CI 跨零，停止进入 Phase 2+，**范围回收为 L1-only 默认关闭**。

---

## 回滚总策略（最极端的情况 —— 直接关）

在 `cordis.patch.yml` 把 `self-evolve-basic` 和 `tool-self-evolve` 两行 disabled=true 即可；已注册的 skill/prompt section 会因 fiber 销毁自动卸载（Reversible Effects），不需要额外清理；本地的 `$DSH_HOME/self-evolve/` 目录可手动移走恢复原状态。
