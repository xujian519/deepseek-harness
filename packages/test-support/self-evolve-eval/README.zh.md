# @deepseek-ai/dsh-self-evolve-eval

[English](README.md) | 中文

self-evolve 能力的 **P1-10 评估脚手架**：确定性 60 题子集选择、baseline/self-evolve 配对结果收集、净胜分统计、分位数 bootstrap 95% 置信区间，以及触发 CI 停开关的 continue/rollback 决策记录。

这是开发/测试基础设施而非运行时插件：不拥有任何服务，也没有模型可见面。真实战役——每题 docker 镜像、agent 运行与 FAIL_TO_PASS 验证——需要 keyed 环境；脚手架覆盖其外围并在数据缺失时如实失败。

## 用法

在仓库根目录运行。所有产物默认落在 `packages/self-evolve/evaluation/`。

```sh
# 1. Select the deterministic 60-task subset from a SWE-bench manifest.
#    Export the dataset first (networked environment):
#      python -c "from datasets import load_dataset; load_dataset('princeton-nlp/SWE-bench_Verified').to_json('swebench-verified.jsonl')"
pnpm eval:self-evolve subset --manifest swebench-verified.jsonl --seed 20260821 --out packages/self-evolve/evaluation/subset.json

# 2. Run baseline and self-evolve campaigns over the subset (keyed + docker).
#    Collect one paired result row per task into results.json — see the schema below.

# 3. Score and record the decision:
pnpm eval:self-evolve score  --results packages/self-evolve/evaluation/results.json
pnpm eval:self-evolve decide --results packages/self-evolve/evaluation/results.json --write
```

`decide --write` 持久化 `eval-decision.json`；`pnpm run verify-self-evolve-eval`（CI 门禁）在记录的建议为 `rollback` 时失败——即"CI 跨零自动停开关"。

## 结果 schema

`results.json` 是配对战役报告：

```json
{
  "seed": 20260821,
  "subsetSize": 60,
  "generatedAt": 1755780000000,
  "tasks": [
    { "taskId": "django__django-12345", "baselinePassed": false, "evolvedPassed": true }
  ]
}
```

self-evolve 跑通而 baseline 未跑通的任务为 **win**，反之为 **loss**；`netWin = wins − losses`。主要统计量是配对胜率差（N 题中 `evolvedPassed − baselinePassed`），其 95% 置信区间是对重采样任务差做的可播种分位数 bootstrap（10,000 次重采样）。决策规则（spec P1-10 回滚条件）：仅当区间严格大于零才 `continue`；跨零（无法排除随机性）或小于等于零（伤害证据）则 `rollback`。

## 环境要求

- **清单导出**：Hugging Face（`princeton-nlp/SWE-bench_Verified`）+ `datasets` 包；脚手架本身只消费导出的 JSONL/JSON。
- **战役运行**：`DEEPSEEK_API_KEY` 与支持 docker 的主机（每实例的 SWE-bench 评估协议）。脚手架不代跑 agent；收集到的 `results.json` 就是契约。
- **可复现**：在战役记录中固定子集 seed 与清单；bootstrap seed 只需对决策记录稳定。

## 诚实状态

脚手架已落地并有单测（子集确定性、评分、区间、决策 I/O）。**本仓库尚未执行任何真实 60 题战役**——需要 keyed/docker 环境，且决策记录文件尚不存在，因此 CI 停开关处于休眠态。
