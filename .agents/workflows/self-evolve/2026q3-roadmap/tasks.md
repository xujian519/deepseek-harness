# 自进化插件推进任务清单（优化后）

> **历史草稿（superseded）**：本目录为自进化插件的原始设计工作稿（2026-08-20），内容陈旧，不再维护。当前任务状态见 [`packages/self-evolve/tasks.md`](../../../../packages/self-evolve/tasks.md)。

严格 gated。每阶段完成后先跑 `check_list.md`，全部 yes 才能进入下一阶段。顺序严格对齐报告 §二 51 行的「优化对象递进链」：**prompt/context → workflow → harness-code → reflection**。

总顺序：

```
P0.1 → P0.2 → P0.3 → P0.4 → [Gate P0]
  → Sig.1 → Sig.2 → Sig.3 → [Gate SIG]
    → P1.1 → P1.1b → P1.2 → P1.3 → P1.4 → P1.5 → P1.6 → P1.7 → P1.7b → P1.8 → P1.9 → [Gate P1]
      → P2.1 → P2.2 → P2.3 → P2.4 → P2.5 → [Gate P2]
        → P3.1 → P3.2 → P3.3 → P3.4 → P3.5 → [Gate P3]
          → P4.1 → P4.2 → P4.3 → [Gate P4] → [Gate F 最终]
```

---

## Phase 0：骨架闭合（4 任务）

### TASK-P0.1：turn/end 监听器接入 idle detection
- **时长**：1 h
- **依赖**：无
- **修改文件**：
  - `BasicSelfEvolveEngine` ([self-evolve-basic/src/index.ts](file:///Users/xujian/projects/deepseek-harness/packages/self-evolve/self-evolve-basic/src/index.ts)) 构造函数
  - `self-evolve/src/index.ts` 的 Service class `inject` 数组加 `agents`
- **实现要求**：
  - 构造器里用 `ctx.on('turn/end', fn)` 监听 turn 结束；若 phase.kind===idle + 满足 trigger minIntervalMs，内部用 `_agentCtxFor(sessionId)` 生成 agent 上下文（agent id 从 session.agentId 取，ctx.agents.get() 查到实例后 bind runMaintenance），再调 evolveIfNeeded。
- **验收命令**：`pnpm run typecheck 2>&1 | tail -5` 无错；`pnpm run test -- packages/self-evolve`。

### TASK-P0.2：最小 proposeForPatterns（纯模板 L2，无 LLM）
- **时长**：1.5 h
- **依赖**：P0.1
- **修改文件**：`BasicSelfEvolveEngine.proposeForPatterns` 覆写
- **实现要求**：对每个 `L1-skill` pattern 生成一个 L2 candidate：
  - sectionName = `self-evolve-patch-${patternId 8 chars sha1}`
  - order: 260（prompt 靠后）
  - sectionText: `当你看到 ${pattern.summary} 时，请先检查 supportingSeqs 最后一次失败的上下文，不要立即重复同样调用顺序；外部进程错误先诊断再修复。`
  - 受 `maxProposalsPerLoop` 截断。
- **验收**：`pnpm run typecheck`。

### TASK-P0.3：validateProposal 恒 accepted（只测事件 bracket）
- **时长**：0.5 h
- **依赖**：P0.2
- **修改文件**：validateProposal 目前返回 rejected，临时改为恒 accepted（confidence=0.01）
- **验收**：`pnpm run typecheck`。

### TASK-P0.4：录制骨架闭合 snapshot
- **时长**：2 h
- **依赖**：P0.1–P0.3
- **修改**：新建 `examples/snapshots/self-evolve-basic/p0-bracket.yml`
- **脚本**：`bash exit 1` ×2 → `echo done` → turn/end idle → 最后必须完整出现 6 条 `self-evolve/*` 事件且 runId 一致。
- **验收命令**：
  ```sh
  pnpm run test:snapshot:record -- -t p0-self-evolve-bracket
  pnpm run test:snapshot -- -t p0-self-evolve-bracket
  ```

---

## Phase SIG（中间 Gate：Verifier-Grounded Causal Signature）—— 已完成（SIG-1~SIG-7 全 ☑）

（对齐报告 §二 46 行 Self-Harness 论文 pattern 定义：必须是 verifier-grounded + causal-signature，不是表面文本）

### TASK-SIG.1：FailurePattern 类型扩展 zod schema —— [x]
- **时长**：0.5 h
- **依赖**：[Gate P0 通过]
- **修改文件**：
  - [self-evolve/types.ts](file:///Users/xujian/projects/deepseek-harness/packages/self-evolve/self-evolve/src/types.ts) 的 `FailurePattern` 接口
  - [failure-projection.ts](file:///Users/xujian/projects/deepseek-harness/packages/self-evolve/self-evolve/src/failure-projection.ts) 的 `failurePatternSchema`
- **新增字段**：
  - `verifierTier`: `'tool-runtime' | 'subprocess-exit' | 'llm-provider' | 'agent-loop'`
  - `causalSignature`: `string`（verifier 层能区分失败因果）
- **验收命令**：`pnpm run typecheck`。

### TASK-SIG.2：classifyFailure 细分（verifierTier + causalSignature）—— [x]（失败面统一从 `tool/result` 分类，见 spec 注）
- **时长**：1 h
- **依赖**：SIG.1
- **修改文件**：failure-projection.ts 的 classifyFailure 函数
- **规则**：
  - `toolName == 'bash' || 'shell'` → `verifierTier='subprocess-exit'`，causalSignature = `sha1("${exitCode}:${stderr前200字节}")`
  - `type='agent/request-error'` → `verifierTier='llm-provider'`，causalSignature = `(error.code ?? event.data.statusCode ?? 'unknown').toString()`
  - `'self-evolve/end' with error` → `verifierTier='agent-loop'`，causalSignature = `error.name`
  - 其它 tool/error → `verifierTier='tool-runtime'`，causalSignature = `error.name ?? 'generic-error'`
- **sha1 实现**：失败投影里已有的 CRC32 太小（冲突风险），把 helper 换为 `SubtleCrypto.digest('SHA-1', textEncoder.encode(...))`，转 base32。

### TASK-SIG.3：patternId 算法升级 + 弱 tier 阈值上抬 —— [x]（`eligiblePatterns` 纯函数直测）
- **时长**：1 h
- **依赖**：SIG.1, SIG.2
- **修改**：
  - `stableId(signal)` 输入由 `(level+summary)` 改为 `(level+verifierTier+causalSignature)`，`summary` 保留展示但不参与 ID。
  - `BasicSelfEvolveEngine.filterEligiblePatterns`：verifierTier==='tool-runtime' 的 pattern，`minPatternOccurrences` 阈值从 config 值 +1（默认 2→3）。
- **验收命令**：
  ```sh
  pnpm run test -- packages/self-evolve  # 如无单元测试可写两个 5 行 case 断言：
  # 同一 exit1 + 不同 stderr → 不同 patternId
  # verifierTier=tool-runtime + occurrences=2 → 不进入 eligible；=3 → 进入
  ```

---

## Phase 1：Validator 结构化（9 任务，原 7 任务 + 新增 2）

### TASK-P1.1：扩展 ProposalValidationOutcome 类型
- **时长**：1 h
- **依赖**：[Gate SIG 通过]
- **修改**：types.ts#L75-L81 扩展 4 字段：`deconstructedScores`, `confidence`, `replayEvidence[]`, `nextRoundSuggestion`；老字段保留。

### TASK-P1.1b（新增）：Held-In 双 Verifier 规则落地（对应翁荔挑战 1）—— [~]（决策接线完成：`_verifyHeldInCase` 接入 `validateProposal` + `requireDualVerification`；replay/workspace 信号收集器待 P1.2/P1.3）
- **时长**：1 h
- **依赖**：P1.1
- **修改文件**：`BasicSelfEvolveEngine` 私有方法 `_verifyHeldInCase(proposal, heldinCase)`
- **规则**：每个 held-in case 必须两条件全满足：
  1. fork 出来的 agent 跑的任务 exitcode=0 且无相同 patternId（原有）
  2. `build` 命令（或 `git diff --stat` 对工作区的影响量 < N 行，若无可执行则 fallback 到 "no dirty state"）——独立判定。
- **两都 true → pass；任一 true 另一 false → 不确定 = reject（regressions 不追加，避免 future proposer 误学习）**。
- **验收**：单测 mock 两个独立 verifier 为 T+F → outcome.kind = rejected。

### TASK-P1.2：Held-In replay 验证
- **时长**：2 h
- **依赖**：P1.1b
- **修改**：validateProposal 扩 `_replayOne` 私有方法。用 `ctx.agents.fork(session.agentId, { seed, systemPromptPatch: … })` 重放 ±candidate，命中同 patternId 判定为"未解决"。

### TASK-P1.3：Held-Out 跨会话构造
- **时长**：2 h
- **依赖**：P1.2
- **修改**：validateProposal。无 `ctx.sessionQuery` 时 heldOutPassed=0 confidence=0.3 走弱路径；有则 `searchEvents(query: summary, limit=5)`，通过率 ≥ 0.6 视为 heldOutPassed。

### TASK-P1.4：Deconstructed LLM-Judge 打分
- **时长**：2 h
- **依赖**：P1.1, P1.3
- **修改**：`_judge(proposal, replayEvidence)`。Inject `llm` 服务。4 固定维度打分：activates-when-correct / clarity / no-regression-introduced / safety。**confidence = min(scores) × heldInRate × heldOutRate**。validatorTarget 强制独立配置。

### TASK-P1.5：L1 skill 持久化到磁盘
- **时长**：2 h
- **依赖**：P1.1
- **修改**：applyCommit 的 L1 分支写 `<project>/.dsh/skills/<name>/SKILL.md`。文件格式严格参考 [parseSkillFile](file:///Users/xujian/projects/deepseek-harness/packages/skill/skill-filesystem/src/index.ts#L793-L835) 定义的 frontmatter。写操作走 `ctx.fs` capability。

### TASK-P1.6：Validator reject 的 diagnostic 回写 pattern.verifierMeta
- **时长**：1 h
- **依赖**：P1.2–P1.4
- **修改**：executeLoop → validated event 后若 rejected，把 `{proposalId, reason, nextRoundSuggestion}` push 到 pattern.verifierMeta.failedProposals（下次 propose 用作 few-shot 反例）。

### TASK-P1.7：录制 Phase 1 snapshot
- **时长**：2 h
- **依赖**：P1.1–P1.6
- **新建**：`examples/snapshots/self-evolve-basic/p1-validator.yml`
- **验收命令**：
  ```sh
  pnpm run test:snapshot:record -- -t p1-validator
  pnpm run test:snapshot -- -t p1-validator
  ```

### TASK-P1.7b（新增）：负面结果沉淀（对应翁荔挑战 4）—— [x]（`persistNegativeResult` + `readNegativeResults` + 模板 proposer 前缀）
- **时长**：1 h
- **依赖**：P1.7
- **修改**：
  - executeLoop 里当 `outcome.kind === 'rejected'` → 写 `$DSH_HOME/self-evolve/negative-results.jsonl` 一行 `{ts,patternId,proposalId,reason,diagnostic,deconstructedScores,nextRoundSuggestion}`（append-only）。
  - `proposeForPatterns`（真正接入 LLM 版时）前缀固定读最近 3 条同 patternId 失败。
- **验收命令**：
  ```sh
  # 构造 3 次 reject
  ls $DSH_HOME/self-evolve/negative-results.jsonl && \
  jq -s length $DSH_HOME/self-evolve/negative-results.jsonl | grep -q 3
  ```

### TASK-P1.8：Champion-Challenger 双版本 + rollback 钩子
- **时长**：1 h
- **依赖**：P1.5
- **修改**：applyCommit 成功前把旧版本（原 skill 内容 / 原 section 文本）复制到 `$DSH_HOME/self-evolve/archive/<proposalId>/`。读最近 2 条相同 patternId 连续 regression → 自动回滚 archive 的 champion。

### TASK-P1.9：L2 提案 estimatedBytes 声明 + 每周 pruning job 骨架（对应翁荔挑战 7）
- **时长**：1.5 h
- **依赖**：P1.7
- **修改**：
  - L2 candidate 新增字段 `estimatedBytes = sectionText.length`。
  - 新增配置 `maxPromptInflationBytesPerWeek = 2048`。每次 Maintenance 开始时先算过去 7 天 self-evolve 新增 section 累计字节，超 2048 → 触发独立 pruning：把 7 天 0 次调用的 self-evolve 生成 section 归档到 `$DSH_HOME/self-evolve/l2-archive/` 并 disposer 撤销 effect。
- **验收**：构造 ≥ 2048 + 1 字节，pruning job 被触发，最后 system prompt 长度回落到阈值以下。

---

## Phase 2：L3 Workflow + L4 Harness 审批 —— 已完成（P2-1~P2-4 ☑，P2-5 snapshot 待 key）

> 原则：**工作流（ADAS/AFlow 层）比 harness 主循环改动风险低，必须先跑通**。

### TASK-P2.1：L3 workflow applyCommit 接入 workflowEngine smoke
- **时长**：1.5 h
- **依赖**：[Gate P1 通过]
- **修改**：applyCommit switch 加 case 'L3-workflow'。`ctx.workflowEngine.start({ script, meta:{name}, parent:agent })`，agentsStarted≥1 且 stopReason='completed' 才视为通过；否则 reject。
- **验收**：`pnpm run typecheck`。

### TASK-P2.2：L4 harness 提交流程翻译为 cordis-host-runner.run()
- **时长**：3 h
- **依赖**：P2.1
- **修改**：applyCommit case 'L4-harness'。把 candidate.hostCode / clientCode 翻译为 `pluginId + packageId` 临时定义。直接调用 `ctx.dynamicCordisRunner.run(agent, pluginId, packageId, mode='install', signal)`。由于默认 clientCode 非空且 approveFutureVersions=false，requiresApproval 恒 true，必走人工审批。
- **验收**：mock cordis-host-runner.run，assert 返回 requiresApproval=true。

### TASK-P2.3：L4 approveFutureVersions 二次保险 wrapper
- **时长**：1.5 h
- **依赖**：P2.2
- **修改**：`ctx.on('cordis/before-approval', fn)` 外层 wrapper，判定：若 level='L4-harness' 且（上次 approval ts < now-24h 或 proposalId 不同）→ 强制覆盖 requiresApproval=true，即使 cordis-host-runner 本来要放行。不修改 cordis-host-runner 源文件。
- **验收**：mock 两种场景，跨 proposalId 仍要求审批。

### TASK-P2.4：base patch 保持 defaultLevels = [L1, L2]
- **时长**：0.25 h
- **依赖**：P2.2
- **修改**：核对 [cordis.patch.yml](file:///Users/xujian/projects/deepseek-harness/packages/bundle/base/cordis.patch.yml#L453-L465) self-evolve-basic.defaultLevels 仍是 [L1-skill, L2-context]。L3、L4 必须由用户 profile 显式开启，默认关。

### TASK-P2.5：录制 Phase 2 snapshot
- **时长**：2 h
- **依赖**：P2.1–P2.4
- **验收命令**：
  ```sh
  pnpm run test:snapshot:record -- -t p2-l3-l4
  pnpm run test:snapshot -- -t p2-l3-l4
  ```

---

## Phase 3：Step-Reflection + CSR —— 已完成（P3-1~P3-7 ☑，P3-8 snapshot 待 key）

### TASK-P3.1：agent/pre-step reflection hook
- **时长**：2 h
- **依赖**：[Gate P2 通过]
- **修改**：`BasicSelfEvolveEngine` inject 加 `llm`；构造器注册 waterfall hook `agent/pre-step`。仅本 turn 有 tool/error 或 request-error 时触发，budget max_input=2k, max_output=512。
- **输出三元组**：`{confidence, patternId, suggestion}`。confidence≥0.85 → 手动 +1 occurrence。
- **throttle**：`maxStepReflectionsPerTurn = 1`。

### TASK-P3.2：真正 LLM 版 proposeForPatterns + JoyCode CSR 经验段
- **时长**：2 h
- **依赖**：P3.1
- **修改**：`proposeForPatterns` 从模板版升级为 LLM 版。prompt 里前缀：
  ```ts
  ctx.sessionQuery.searchEvents({ query: 'resolved ' + pattern.summary, limit: 3 })
  ```
  最近 3 条 patch diff 用作 few-shot。token 计数目标：无 CSR 版本的 ≤70%。

### TASK-P3.3：per-session per-pattern proposal 冻结 24h
- **时长**：1 h
- **依赖**：P3.1
- **修改**：SessionRateState 加 `frozenPatterns: Record<patternId, frozenUntilEpoch>`。同一 patternId 连续 2 次 proposal 后冻结 24h。第三次触发跳过。

### TASK-P3.4：budget hard-cap 字节累计（Maintenace 防 token 爆炸）
- **时长**：1 h
- **依赖**：P3.2
- **修改**：executeLoop 加 `budgetUsed = 0`。每次 LLM call / searchEvents 调用时把字节数累加，超过 `maxBudgetCharsPerLoop = 32768` 时立即触发 `maintenanceSignal.abort('budget-exceeded')`；事件流仍以带 error 的 end event 结束（bracket 完整）。

### TASK-P3.5：录制 Phase 3 snapshot
- **时长**：2 h
- **依赖**：P3.1–P3.4
- **验收命令**：
  ```sh
  pnpm run test:snapshot:record -- -t p3-step-reflection
  pnpm run test:snapshot -- -t p3-step-reflection
  ```

---

## Phase 4：Global Pattern KB —— 已完成（P4-1~P4-3 ☑，P4-4 snapshot 待 key）

### TASK-P4.1：append 写入 global-patterns.jsonl
- **时长**：1 h
- **依赖**：[Gate P3 通过]
- **修改**：executeLoop 尾部（end event 之前）追加 `{ts, sessionId, patternId, occurrences}`。

### TASK-P4.2：读取 + occurrences 合并（24h 滚动窗口）
- **时长**：2 h
- **依赖**：P4.1
- **修改**：readPatterns 投影读完后再读 global jsonl；24h 窗口内同 patternId occurrences 相加。`minPatternOccurrences` 阈值用合计值。

### TASK-P4.3：录制 Phase 4 snapshot
- **时长**：1 h
- **依赖**：P4.1–P4.2
- **验收命令**：
  ```sh
  pnpm run test:snapshot:record -- -t p4-global-kb
  pnpm run test:snapshot -- -t p4-global-kb
  ```

---

## 每次 PR 必跑（POST-CHECK-ALL）

提交 PR 前按顺序运行，0 exit 才能发 PR：

```sh
pnpm run typecheck
pnpm run lint
pnpm run test:coverage    # 若改动路径少，可跑最小子集（见 change-scope）
pnpm run hygiene         # 改动 package.json/exports 必须跑
pnpm run doc-sync        # 改动 JSDoc contract 或 docs 路径必须跑
git diff --check
```
