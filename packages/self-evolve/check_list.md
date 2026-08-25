# Self-Evolve 阶段验收清单

> **内部工作追踪文档（非参考，不参与双语/doc-sync）**：用于自进化插件的阶段推进与验收记录，内容会随进度漂移。权威参考——子系统见 [`docs/subsystems/self-evolve.md`](../../docs/subsystems/self-evolve.md)（含 `.zh.md`），各包契约见各自双语 README，设计决策见 `.agents/notes/implemented/` 下 self-evolve 相关 Agent Note。

## Gate-P0：骨架可运行

| # | 项目 | 验收命令 | Yes/No |
|---|---|---|---|
| P0-1 | `pnpm exec tsc -b packages/self-evolve/*` 通过 | `pnpm exec tsc -b packages/self-evolve/self-evolve packages/self-evolve/self-evolve-basic packages/self-evolve/tool-self-evolve --force` | ☑ |
| P0-2 | `pnpm exec vitest run packages/self-evolve/` 通过 | `pnpm exec vitest run packages/self-evolve/` | ☑ |
| P0-3 | 三个包 `tsdown` 打包成功 | `cd packages/self-evolve/self-evolve && pnpm exec tsdown --config tsdown.config.mjs`（及另外两包） | ☑ |
| P0-4 | README Model Experience 合规 | `pnpm exec tsx scripts/verify-package-readme-model-experience.ts` | ☑ |
| P0-5 | 事件源接线：`tool/result` 分类 + `agent/request-error` 生产者 | 单测：bash exit=1 不同 stderr → 两个 patternId；waterfall 触发后 session 出现 `agent/request-error` 事件 | ☑ |

## Gate-SIG：Signature 中间验收

| # | 项目 | 验收 | Yes/No |
|---|---|---|---|
| SIG-1 | patternId 基于 `(level, verifierTier, causalSignature)` | 单测：bash exit=1 + 不同 stderr → 不同 patternId | ☑ |
| SIG-2 | `verifierTier='tool-runtime'` 时 threshold 自动 +1 | 单测：occurrences=2 时 skip；=3 时被 mined（`eligiblePatterns` 直测） | ☑ |
| SIG-3 | `FailurePattern` 新增 `causalSignature` + `verifierTier` 字段类型安全 | typecheck + zod schema 严格解析 + stateVersion=3 | ☑ |
| SIG-4 | `agent/request-error` 会话事件有真实生产者 | 单测：`agent/request-error` waterfall 上追加 durable 事件，字段对齐声明 | ☑ |

## Gate-P1：Validator 可用

| # | 项目 | 验收 | Yes/No |
|---|---|---|---|
| P1-1 | `requireDualVerification` 配置生效 | 双信号 T+F / F+F → rejected 且 regressions=[]；信号缺失按弱路径 0.3 计并保守拒绝（不再 smoke 放行） | ☑ |
| P1-2 | Held-In replay 验证（P1.2） | `replayCase` 经 fork provider 重放；child 仅 end-seed 后事件参与折叠；基础设施缺失 → null 弱路径 | ☑ |
| P1-3 | Held-Out 跨会话（P1.3） | `collectHeldOutSignal` 搜索相似历史并逐个重放；无 sessionQuery / 无命中 → null；通过率 ≥ 0.6 达标 | ☑ |
| P1-4 | LLM judge（P1.4） | `_judge` 4 维度 0-1 钳制；无 validatorTarget → 结构分；validatorTarget=proposerTarget → 加载抛错 | ☑ |
| P1-5 | L1 skill 持久化（P1.5） | applyCommit 经 `ctx.fs` 写 `<project>/.dsh/skills/<name>/SKILL.md`（frontmatter 三键） | ☑ |
| P1-6 | failedProposals 回写（P1.6） | `readPatterns` 输出含 `verifierMeta.failedProposals`（源自 negative-results） | ☑ |
| P1-7 | Negative results 写入 `$DSH_HOME/self-evolve/negative-results.jsonl` | reject 次数 = jsonl 行数（临时 DSH_HOME 实测） | ☑ |
| P1-8 | Champion-Challenger 回滚（P1.8） | 连续 2 次同 patternId rejection → 最新 champion 经 owning seam 恢复（单测） | ☑ |
| P1-9 | Prompt 膨胀 pruning（P1.9） | 超 `maxPromptInflationBytesPerWeek` → 最旧 section 归档到 l2-archive/ 且 disposer 撤销（单测） | ☑ |
| P1-10 | 60 题离线子集净胜分 95% CI | 提供 evaluation report，CI 不跨零；CI 跨零自动停开关 | ☐ |
| P1-11 | Phase 1 snapshot 录制 | `pnpm run test:snapshot:record -- -t p1-validator`（需 key 环境） | ☐ |

## Gate-P3：L3 + L4 审批

| # | 项目 | 验收 | Yes/No |
|---|---|---|---|
| P3-1 | L3 workflow smoke（P2.1） | `runWorkflowSmoke` 经 workflowEngine 执行；completed+agents≥1 通过；失败 → held-in rejected；引擎缺失 → null 弱路径 | ☑ |
| P3-2 | L4 define+run 审批流（P2.2） | `dynamicCordisRunner.define` + `run`；awaiting-approval → accepted；refusal → `approval-denied`；runner 缺失 → 拒绝 | ☑ |
| P3-3 | L4 二次保险（P2.3） | `cordis/before-approval` waterfall：跨 proposal 或超 24h → 强制重审（runner + provider 单测）；fresh 同 proposal 保留基础要求 | ☑ |

## Gate-P2：Step-Reflection

| # | 项目 | 验收 | Yes/No |
|---|---|---|---|
| P2-1 | `agent/pre-step` reflection hook 不阻塞正常 step | 单测：低置信/未知 patternId 丢弃；命中 ≥0.85 → `self-evolve/reflection` 事件 + occurrences+1；节流 1 次/轮 | ☑ |
| P2-2 | LLM 提案器 + CSR 经验段（P3.2） | 单测：proposerTarget 路由解析 JSON 提案数组（含 estimatedBytes）；无路由回退模板 | ☑ |
| P2-3 | per-pattern 冻结（P3.3） | 单测：两次提案后第三次 evolveNow proposals=[] | ☑ |
| P2-4 | budget hard-cap（P3.4） | 单测：超 `maxBudgetCharsPerLoop` → budget-exceeded 中止 | ☑ |

## Gate-P4：Global KB

| # | 项目 | 验收 | Yes/No |
|---|---|---|---|
| P4-1 | 跨会话 `global-patterns.jsonl` 追加（P4.1） | 单测：loop 结束前逐模式追加一行 | ☑ |
| P4-2 | 24h 滚动 occurrences 合并（P4.2） | 单测：他会话 24h 内行并入阈值；超窗行忽略 | ☑ |
