# 自进化插件 Gate 检查清单（优化后）

**使用规则**：每阶段所有项标记 Yes 才能进入下一阶段；任何 No 必须在阶段内修复，不能推到下一阶段。

---

## 前置 Gate（每 PR 必过）

| # | 项目 | 命令 / 位置 | Yes / No |
|---|---|---|---|
| PR0 | `pnpm run typecheck` exit 0 | 仓库根 | ☐ |
| PR1 | `pnpm run lint` exit 0 | 仓库根 | ☐ |
| PR2 | 改动 `packages/*/*/src` → `pnpm run test:coverage` 相关文件覆盖率 100% | 改动路径 | ☐ |
| PR3 | 改动 package.json / exports 字段 → `pnpm run hygiene` exit 0 | 仓库根 | ☐ |
| PR4 | 改动 JSDoc / docs 路径 → `pnpm run doc-sync` exit 0 | 仓库根 | ☐ |
| PR5 | `git diff --check` exit 0（无 trailing whitespace + 正确行尾换行） | 仓库根 | ☐ |
| PR6 | 所有新增 Durable Event 都在 SessionEventMap 中声明（declaration merging） | [types.ts](file:///Users/xujian/projects/deepseek-harness/packages/self-evolve/self-evolve/src/types.ts) | ☐ |
| PR7 | 所有模型 / 进程 / 磁盘 / worker 边界的入参出参走 zod schema | [failure-projection.ts](file:///Users/xujian/projects/deepseek-harness/packages/self-evolve/self-evolve/src/failure-projection.ts#L113-L132) | ☐ |
| PR8 | 所有注册（tools, projection, prompt section, skill）包在 `ctx.effect(...)`，scope 销毁自动回滚 | Provider apply 入口 | ☐ |
| PR9 | 没有未解释的 `any` / `@ts-ignore` / `eslint-disable` | `pnpm run lint` + 人工 grep | ☐ |
| PR10 | `self-evolve/*` 事件 bracket 合法（start/end 成对；proposal→validation→commit 顺序正确） | [invariant.ts](file:///Users/xujian/projects/deepseek-harness/packages/self-evolve/self-evolve/src/invariant.ts) | ☑ |
| PR11 | **证据等级声明生效**：若 spec.md 声明「P1 CI 跨零则收窄为 L1 默认关闭」，P1 的 gate-check 脚本里必须做自动化判断（跑 60 题离线小集或等效 smoke），不能靠人工拍脑袋。 | Phase 1 Gate 最后一步 | ☐ |

---

## Gate P0（骨架闭合）

| # | 项目 | 验收方式 / 位置 | Yes / No |
|---|---|---|---|
| P0-1 | turn/end 后 idle 相位确实触发 `evolveIfNeeded(trigger='idle-maintenance')`（不依赖外部手工调用） | snapshot 中出现 self-evolve/start | ☐ |
| P0-2 | 同一 pattern（同 error）出现 2 次（≥ minPatternOccurrences=2，非 tool-runtime tier）→ mined event | snapshot: mined data.patterns.length > 0（投影单测等价覆盖） | ☑ |
| P0-3 | 6 事件顺序严格 start → mined → proposed → validated → commit → end，runId 一致 | snapshot p0-bracket 断言序列（invariant 单测覆盖括号顺序） | ☑ |
| P0-4 | `pnpm run test:snapshot -- -t p0-self-evolve-bracket` 通过（无 normalize 作弊，无 diff） | replay vs recorded | ☐（snapshot 未录制） |
| P0-5 | Maintenance 期间发 abort 信号（或 turn 中途被新消息打断）→ maintenance abort，最后仍出现带 error 的 end event（bracket 完整不丢） | 手动打断一次 + grep end.data.error | ☐ |
| P0-6 | 节流正确：两次 evolveNow 间隔 < minIntervalMs(idle-maintenance=30000) → 第二次 return null，不产出事件 | 单测 mock Date.now 断言（minInterval + 24h 上限已测） | ☑ |

---

## Gate SIG（中间 Gate：Verifier-Grounded Causal Signature）

> 此 gate 不通过 → 禁止进 Phase 1。否则 pattern 归并错误，后续 Validator 全链烧 token。

| # | 项目 | 验收方式 / 位置 | Yes / No |
|---|---|---|---|
| SIG-1 | `FailurePattern` 类型新增 `verifierTier` + `causalSignature` 字段；zod schema 在 failure-projection.ts 里通过 serialize → deserialize round trip | typecheck + 单测：构造对象 → JSON.parse/stringify → parse 通过 | ☑ |
| SIG-2 | `patternId` 计算从 `(level+summary)` 改为 `(level+verifierTier+causalSignature)`，**summary 变化不影响 ID**：同 level+tier+sig 但摘要改字 → ID 相同 | 两个 5 行单测断言 | ☑ |
| SIG-3 | **bash/shell 同 exit 1 + 不同 stderr → 两个不同 patternId**（归并不粗） | 两个 tool/result（bash, exit=1, stderr A vs B） | ☑ |
| SIG-4 | **agent/request-error 同 provider 但不同 error.code → 两个 patternId**（归并不粗） | mock 两个 request error + waterfall 生产者单测 | ☑ |
| SIG-5 | verifierTier='tool-runtime' 的弱 tier pattern，threshold 自动上抬：occurrences=2 → 不进入 eligible；occurrences=3 → 进入 eligible | `eligiblePatterns` 单测 | ☑ |
| SIG-6 | sha1 hash 算法正确（已替换 CRC32→SHA1）：同字符串 → 同 hash 值跨进程稳定 | 两个 JS 进程分别计算同一字符串比较 | ☑ |
| SIG-7 | stateVersion bump：failure projection 定义的 stateVersion 升到 3（v2 加字段、v3 加 toolCalls 身份映射，均破坏旧 deserialization） | failure-projection.ts stateVersion: 3 | ☑ |

---

## Gate P1（Validator 结构化）

| # | 项目 | 验收方式 / 位置 | Yes / No |
|---|---|---|---|
| P1-1 | ProposalValidationOutcome 扩展 `deconstructedScores/confidence/replayEvidence/nextRoundSuggestion` 类型 + zod schema 通过 | types.ts 检查 | ☐ |
| P1-2 | **Held-In 双 Verifier**：`dsh test pass ∩ (build+diff stat 健康)` 二者任一 false → outcome kind=rejected，**且不追加 regressions（保守避免误学习）** | 单测：verifier1=T, verifier2=F → rejected 且 regressions=[]（决策接线已测；信号收集器 P1.2/P1.3 待落地） | ☑（决策） |
| P1-3 | Held-In：±candidate 两次 replay，应用版不再产生同 patternId 的失败 → heldIn 通过 | 离线断言 fork 前后日志对比 | ☐ |
| P1-4 | 无 `ctx.sessionQuery` 时 heldOutPassed=0，confidence=0.3（低置信）但流程不抛错 | 构造不注册 sessionQuery 的 profile 跑通 | ☐ |
| P1-5 | 有 sessionQuery 时 `searchEvents(query: pattern.summary, limit=5)` 返回 ≥ 1 条，通过率 ≥ 0.6 → heldOutPassed = 实际比率 | 用 sqlite.spec 已有的 searchEvents 模式 mock 返回 | ☐ |
| P1-6 | `confidence = min(deconstructedScores) × heldInRate × heldOutRate` 公式严格成立 | 单测断言 | ☐ |
| P1-7 | validatorTarget ≠ proposerTarget （config load-time 校验：相同 → 抛错不启动）；两者之一固定 seed | 两个 target 写相同字符串 → 启动 throw；不同 → ok | ☐ |
| P1-8 | L1 skill commit → `<project>/.dsh/skills/<name>/SKILL.md` 存在；parseSkillFile 解析无错；冷重启 dsh 后 skill 仍可通过 `/skills` 检索 | parseSkillFile 单测 + 重启 snapshot | ☐ |
| P1-9 | Validator rejected 的 proposal：nextRoundSuggestion + diagnostic 写入 pattern.verifierMeta.failedProposals 数组，下次 propose 时作为反例 few-shot 入 prompt | 读 projection 后 grep verifierMeta.failedProposals | ☐ |
| P1-10 | **负面结果沉淀**（翁荔挑战 4）：`outcome.kind=rejected` → `$DSH_HOME/self-evolve/negative-results.jsonl` 追加一行；行数 = rejected 次数（无重、无丢） | 脚本 reject N 次后 `jq -s length` = N（临时 DSH_HOME 单测） | ☑ |
| P1-11 | Champion-Challenger 归档 + 自动回滚：连续 2 次同 patternId 触发 `nextRoundSuggestion.regressions ≥ 1` → 旧 archive 版本被写回，新 effect 被 disposer 撤销 | 构造 2 次 regression，assert 版本号回到 champion | ☐ |
| P1-12 | **Prompt 通胀保护**（翁荔挑战 7）：7 天累计 L2 section 新增字节 >2048 → pruning job 触发；`过去 7 天 0 次调用` 的 self-evolve section 被归档到 l2-archive/，effect 被 disposer。system prompt 最终总增长 ≤ 2048。 | 构造 2049 字节触发 pruning，读 systemPrompt.length 回落 | ☐ |
| P1-13 | `pnpm run test:snapshot -- -t p1-validator` 通过（无 diff） | replay vs recorded | ☐ |
| P1-14 | **统计显著性停开关**（spec 证据等级承诺自动化）：离线 60 题小集 3 次 seed 跑后，净胜分 95% CI 下界 ≤ 0 → 自动在 base patch 把 self-evolve disabled=true（或把 defaultLevels 降为 [L1]）；CI 跨零则阻断进入 Phase 2 PR。 | 离线脚本 + CI gate 输出 | ☐ |

---

## Gate P2（L3 Workflow + L4 Harness 接入审批。原 P3，前置对齐报告递进链）

| # | 项目 | 验收方式 / 位置 | Yes / No |
|---|---|---|---|
| P2-1 | L3 workflow candidate：applyCommit 之前 `workflowEngine.start` smoke；脚本抛错 / agentsStarted=0 / stopReason≠completed → reject 不 commit | mock workflow 返回 error → outcome.kind=rejected（validation 期 smoke 作 held-in 信号 + applyCommit 复核） | ☑ |
| P2-2 | L4 candidate 翻译为 `cordis-host-runner.run()` 调用且 `requiresApproval === true`（默认情况） | mock run 返回 awaiting-approval → accepted；refusal → approval-denied；runner 缺失 → 拒绝 | ☑ |
| P2-3 | **L4 二次保险**：`cordis/before-approval` wrapper 生效。即使 cordis-host-runner 要放行（approveFutureVersions=true），只要「跨 proposalId 或距上次审批 > 24h」 → wrapper 强制重写 requiresApproval=true | mock 两个场景：不同 ID 或 >24h → 仍审批（runner + provider 双单测） | ☑ |
| P2-4 | `base/cordis.patch.yml` self-evolve-basic.defaultLevels 仍严格 [L1, L2]（不自动开 L3、L4）| grep patch 确认值 | ☑ |
| P2-5 | `pnpm run test:snapshot -- -t p2-l3-l4` 通过 | replay vs recorded | ☐ |

---

## Gate P3（Step-Reflection + CSR。原 P2，后置 Meta-Harness 层）

| # | 项目 | 验收方式 / 位置 | Yes / No |
|---|---|---|---|
| P3-1 | pre-step reflection 仅本 turn 有 error 才触发；无 error turn 触发计数 0。 | 单测：无失败轮 → 无 reflection 事件 | ☑ |
| P3-2 | `maxStepReflectionsPerTurn=1`：连续 3 次 tool/error 仍最多触发 1 次 LLM reflection | 单测：两次调用仅 1 个 reflection 事件 | ☑ |
| P3-3 | reflection 输出 confidence≥0.85 → pattern.occurrences +1 + synthetic supportingSeq（不用等 Maintenance）| 单测 + 投影折叠测试 | ☑ |
| P3-4 | JoyCode CSR：proposer LLM prompt 开头包含 `'resolved ' + pattern.summary` 的 searchEvents 结果块 | 单测：searchEvents 命中进入 proposer 上下文 | ☑ |
| P3-5 | **提案 token 节约**：开启 CSR 后的 proposal prompt 长度 ≤ 关闭 CSR 版本的 70%（JoyCode 数据：少 30% token 同时涨分） | 两个版本字节计数断言 | ☐ |
| P3-6 | per-pattern 冻结：同 patternId 24h 内 2 次 proposal → 第三次 evolveNow targeting 它 → proposals 数组不出现该 pattern 条目 | 连续三次 evolveNow 单测 | ☑ |
| P3-7 | budget hard-cap：`executeLoop` 字节累计超过 `maxBudgetCharsPerLoop=32768` → maintenanceSignal.abort('budget-exceeded')；end event.data.error 含字符串 `budget-exceeded`，bracket 完整 | 单测：超限 → rejects /budget-exceeded/，end event 带 error | ☑ |
| P3-8 | `pnpm run test:snapshot -- -t p3-step-reflection` 通过 | replay vs recorded | ☐ |

---

## Gate P4（Global Pattern KB）

| # | 项目 | 验收方式 / 位置 | Yes / No |
|---|---|---|---|
| P4-1 | Maintenance commit 后，end event 之前 → `global-patterns.jsonl` 行数 +1；每 line `jq .` 合法 JSON | 单测：persistGlobalPatterns 追加合法 JSON 行 | ☑ |
| P4-2 | 会话 A 出 pattern X 1 次，会话 B 出 pattern X 1 次（合计 ≥2，24h 滚动窗口）→ B 会话最后产生 proposed event targeting X（提前触发） | 单测：readPatterns occurrences 并入他会话行 | ☑ |
| P4-3 | 24h 窗口过滤：A session 的时间戳被 Date mock 推到 25h 前，B 会话仅 1 次 → 合计仍 1（不触发 proposed） | 单测：超窗行忽略 | ☑ |
| P4-4 | `pnpm run test:snapshot -- -t p4-global-kb` 通过 | replay vs recorded | ☐ |

---

## Gate F（最终里程碑验收）

| # | 项目 | 验收方式 | Yes / No |
|---|---|---|---|
| F-1 | top-1 解决率相对基线净胜：95% CI 下界 >0；P3 后累计 +13pp / 45pp→58pp（≥+5pp 目标） | 离线 60 题 × 3 次 seed | ☐ |
| F-2 | commit 正向提案率 ≥ 35%（accepted / all proposals） | 离线脚本统计 `self-evolve/validated` 事件 | ☐ |
| F-3 | Maintenance 单轮 token 预算硬 cap：超过 8K in +4K out（等效 32768 chars）→ abort 触发；无单轮超过 cap 的 commit | 所有事件日志扫描 | ☐ |
| F-4 | **一键回滚验证**：注入 2 次 regression → champion-challenger 自动回滚到 archive 内容；回滚后 10 个 turn 的结果和 baseline 无显著差异（p>0.05） | mock 脚本 + t 检验 | ☐ |
| F-5 | **总关闭开关验证**：cordis.patch.yml 把两个 self-evolve 插件 disabled=true → 冷启动后日志里 0 条 self-evolve/* 事件；`.dsh/skills/` 原有的持久化 skill 仍能被 skill-filesystem 读到（不因骨架关闭而丢失） | snapshot + skill grep | ☐ |
| F-6 | **8 类风险全部有 green 证据**：退化 / 多样性坍缩 / Validator 漂移 / 评估噪声 / 负面结果浪费 / prompt 通胀 / token 爆炸 / L4 误审批——8 项全部通过对应 Gate 的检查项 | 所有 Gate 人工签名确认 | ☐ |
