# Agent Note: Benchmark 驱动的自进化、输出级评分与专利 preset 装配

Status: implemented

[English](2026-08-26-self-evolve-benchmark-output-scoring-patent-preset.md) | 中文

## Problem

现有 self-evolve 家族是运行时失败模式挖掘：`BasicSelfEvolveEngine` 从会话事件挖掘 `failure-patterns` 并产出 L1–L4 提案，配 held-in/held-out 验证，但它没有一个循环可以追逐的量化分数目标。penguin-harness（RSI,"Let AI Build AI"）补上了缺失的一半——benchmark 驱动的能力评测闭环：设计评测集 → 给 agent 打分 → 优化 → 在严格改进纪律下快照与回滚。本仓库此前也无法让专利 preset 针对真实交付质量做优化。

## Decision

**以新包 `@deepseek-ai/dsh-self-evolve-benchmark` 叠加一个互补的 benchmark 维度（C1+C2+C3），不动运行时 `BasicSelfEvolveEngine` 核心。** `BenchmarkEvolveEngine` 暴露 `establishBaseline` / `optimizeLoop` / `readScoreboard`；scoreboard 持久化每次 run 的 score/cost/duration 并链回会话 trace；整版快照是版本化的 `v<version>.tar.gz` 归档，排除 `.vault.toml` 且永不重用版本号。

**评分是输出级而非配置级。** `evaluateCase` 度量交付物而非 agent-state 目录：每个 case run 先经新增的 `executeCase` seam 执行任务（fork 一个继承专利 preset 的子代理，读取任务 `statement` 与作业规范），再把产出的交付物作为必填的 `attempt` 交给 evaluator。默认 evaluator prompt 针对私密 `rubric` 给交付物打分。

**agent state 是一份 model-visible 的专利作业规范（checklist），而非 preset 配置。** optimizer 编辑 `guidance.md`；executor 按它产出交付物；applier 把它写回。这绕开了「executor 无法从任意配置目录重组 agent」（`composeFrom` 只允许继承父代理的 standing preset）这一架构硬坎。

**装配在 agent-preset 层。** `patent/agent.cordis.yml` 在带 `isolate: selfEvolveBenchmark` 的 `cordis:group` 内挂载 `@deepseek-ai/dsh-self-evolve-benchmark`，仅编程接口——无模型工具。`agentStateDir` 指向数据根下播种的 `patent-state` 工作副本，绝不指向真实案卷目录：真实案卷或知识库永远不会被优化循环整包打快照或就地改写。

**随包交付可运行的示例 benchmark `patent-oas`**，含四个 case（`oa-answer`、`claim-drafting`、`infringement-comparison`、`novelty-creative`），每个 case 把公开的 `statement` 与私密的 `rubric` 物理分离，外加 `patent-state/guidance.md` 种子与幂等的 `seed.mjs` 播种脚本。

## Alternatives considered

**配置级评分。** 已拒绝：度量「配置看起来合规」对交付型专利工作无实义，还会让优化循环把 prompt 调向自我印证。输出级评分让分数等于真实交付质量。

**agent state 用完整 preset 配置。** 已拒绝：`composeFrom` 无法从任意配置目录重组 agent，executor 因而无法回放优化后的配置；作业规范 checklist 让优化对象与执行对象一致。

**在 profile-bundle 层装配。** 已拒绝：self-evolve seam 位于 profile-bundle 层（`dsh.profile.bundles` + `cordis.patch.yml`），而 patent preset 是 agent-preset 层对 `standard` 的整目录 fork；两层正交，不通过 preset `extends` 互通。

**本期就做 model-facing 的 `tool-self-evolve-benchmark` consumer。** 延后：本期只交付 programmatic service；把 `self_evolve_benchmark_*` 工具暴露给模型的 consumer 留作明确的后续选项。

## Consequences

- fork 子代理继承专利 preset：evaluator、optimizer、applier 子代理带着专利工具与人设运行，approval 钉死 `'never'`（需审批操作在子代理中被拒），并带入计划模式纪律——executor prompt 显式退出计划语义，以便直接产出交付物。
- 运行时闭包现在要求 python sdk-runtime 部署清单声明 `@deepseek-ai/dsh-self-evolve-benchmark`；目录生成器登记了新 service（`gen-cordis-catalog`、`gen-doc-graphs`、`gen-config-catalog`），并重新生成了 `docs/config-catalog`、`docs/capability-seams` 与 `docs/subsystems/self-evolve`。
- 防污染护栏不变：`publicBenchmarkView`/`assertNoPrivateLeak` 继续把 rubric 词汇排除在 optimizer 上下文之外，快照仍排除 `.vault.toml`。
- 验证：80 个单元测试、per-file 100% 覆盖率、`typecheck`、`lint`、`doc-sync`（28 个 gate）、`verify-cordis-config`、`verify-runtime-closure`（6 presets / 133 packages）、`verify-package-invariants` 全部通过。剩余 hygiene 红项是 master 上的既有债务（`constraints` 对无 manifest 的 `packages/self-evolve/evaluation` 目录的误报，以及 knip 对 `packages/bundle/im` 中 `@xmanrui/dsh-im` 与 `packages/memory/openviking` 中冗余 `@deepseek-ai/dsh-fs` devDependency 的报告）；`test:snapshot` 中 `examples/acp-agent` 的单一失败在 master 上同样复现（Node `ExperimentalWarning: SQLite` 泄漏到断言为空的 stderr，属环境 Node 版本产物，与本改动无关）。
