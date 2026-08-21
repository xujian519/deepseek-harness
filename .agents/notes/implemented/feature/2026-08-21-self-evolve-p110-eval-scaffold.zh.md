# Agent Note：self-evolve P1-10 评估脚手架

Status: implemented

[English](2026-08-21-self-evolve-p110-eval-scaffold.md) | 中文

## 问题

spec 的 P1-10 验收——60 题离线子集评估、净胜分 95% 置信区间与"CI 跨零自动停开关"——没有任何代码支撑：没有子集选择、没有配对结果契约、没有统计量，也没有让 CI 强制回滚条件的机械手段。整个 self-evolve 前提（Cordis 可组合性 + Self-Harness 三阶段循环带来净正收益）仍然未被测量，而 P1.9b 工作区验证器已经让提交路径可达，却没有任何证据表明它应当保持开启。

## 决策

把评估脚手架落在新的 test-support 包 `@deepseek-ai/dsh-self-evolve-eval`（开发/测试基础设施，无常量插件面）加一个 CI 门禁：

- **子集**（`src/subset.ts`）：`normalizeSwebenchInstances` 把数据集行（`instance_id`/`repo`/`base_commit`/`FAIL_TO_PASS`/`PASS_TO_PASS`）归一化为 `EvalTask`；`selectSubset` 先按 instance id 排序，再用播种 Fisher-Yates（mulberry32）取出可复现的 `count` 题子集（默认 60）。输入顺序永不影响结果。
- **结果契约**（`src/types.ts` + `validateResults`）：每次战役一份 `results.json`，每题一条配对 `TaskOutcome`（`baselinePassed`/`evolvedPassed`，可选单侧错误按未通过计）。畸形报告宁可失败也不要静默按零分计。
- **统计量**（`src/score.ts`）：`summarize`（wins/losses/netWin、配对胜率差）、对重采样任务差做的可播种分位数 bootstrap（默认 10,000 次）得到 95% CI，以及标准正态分位数求解器支撑的 `wilsonCi` 参考统计量。
- **决策与停开关**（`src/decision.ts` + `scripts/verify-self-evolve-eval.ts`）：`decide` 仅当区间严格大于零时记录 `continue`；跨零或小于等于零记录 `rollback`。记录落在 `packages/self-evolve/evaluation/eval-decision.json`；门禁在 `rollback` 时使 CI 失败，在缺记录（战役未定案前的休眠态）或 `continue` 时通过。
- **CLI**（`src/cli.ts`，`pnpm eval:self-evolve`）：`subset`、`score`、`decide [--write]`；产物默认 `packages/self-evolve/evaluation/`。
- 门禁注册进 `scripts/run-gates.ts` 的 `ciSharedStaticGates`，所有 CI 模式都携带该开关。

## 备选方案

**现在下载并提交真实的 60 题子集。** 否决：工作环境无法访问 Hugging Face 数据集，提交捏造的 instance id 是数据谎言。改为文档化导出脚本路径；`subset` 命令对任何真实清单保持确定性与可复现。

**在包内实现完整战役运行器（每实例 docker + agent 求解 + FAIL_TO_PASS 验证）。** 否决：它需要 keyed、支持 docker 的主机，以及大量无法在本环境验证的代码；诚实的边界是结果契约加文档化流程。运行器属于 keyed 后续工作，不属于本脚手架。

**以 Wilson 区间作为主统计量。** 否决：战役是配对设计（同一任务在两个臂各跑一次），重采样配对差才是正确分布；Wilson 保留为单臂率的参考统计量。

## 后果

- `pnpm eval:self-evolve subset/score/decide` 产出确定性子集、配对摘要、bootstrap 区间与决策记录；`verify-self-evolve-eval` 以"记录前休眠"语义武装 CI 停开关。
- 单测覆盖子集确定性与归一化、摘要数学、区间可复现与退化情形、Wilson 参考值、决策转移与记录 I/O。
- 诚实状态：脚手架已落地；**尚未执行任何真实 60 题战役**（需 keyed/docker 环境）。在 results 与决策记录存在前，P1-10 勾选框保持开放。
- spec.md/tasks.md 把 P1.10a 记为完成、P1.10 记为开放；先前笔记的"仍推迟"清单在此不变。
