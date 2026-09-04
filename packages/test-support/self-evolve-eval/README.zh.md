---
description: "self-evolve 能力的 **P1-10 评估脚手架**：确定性 60 题子集选择、baseline/self-evolve 配对结果收集、净胜分统计、分位数 bootstrap 95% 置信区间，以及触发 CI 停开关的 continue/rollback 决策记录。"
kind: "package-reference"
---

# @deepseek-ai/dsh-self-evolve-eval

[English](README.md) | 中文

## 概述

self-evolve 能力的 **P1-10 评估脚手架**：确定性 60 题子集选择、baseline/self-evolve 配对结果收集、净胜分统计、分位数 bootstrap 95% 置信区间，以及触发 CI 停开关的 continue/rollback 决策记录。

这是开发/测试基础设施而非运行时插件：不拥有任何服务，也没有模型可见面。战役运行器采用轻量本地路径（每题 venv、本地 pytest 判定——无需 Docker）；官方每题容器判定保留作为交叉校验。脚手架覆盖战役外围并在数据缺失时如实失败。

不发布运行时不变式伴生；此评估脚手架不持有生产事件流或可变数据——仅消费由带密钥外部运行生成的 campaign 结果文件。


## 目录

- [用法](#usage)
- [结果 schema](#result-schema)
- [环境要求](#environment-requirements)
- [诚实状态](#honest-status)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="usage"></a>
## 用法

在仓库根目录运行。所有产物默认落在 `packages/self-evolve/evaluation/`。

```sh
# 1. Select the deterministic 60-task subset from a SWE-bench manifest.
#    Export the dataset first (networked environment):
#      python -c "from datasets import load_dataset; load_dataset('princeton-nlp/SWE-bench_Verified').to_json('swebench-verified.jsonl')"
pnpm eval:self-evolve subset --manifest swebench-verified.jsonl --seed 20260821 --out packages/self-evolve/evaluation/subset.json

# 2. Run the paired campaign over the subset (light-weight local path, P-B).
#    No Docker: one shared venv per task plus a local pytest verdict. Run from the repo root.
pnpm eval:self-evolve campaign \
  --manifest swebench-verified.jsonl \
  --subset packages/self-evolve/evaluation/subset.json \
  --results packages/self-evolve/evaluation/results.json \
  --stats packages/self-evolve/evaluation/campaign-stats.jsonl \
  --work-dir /tmp/self-evolve-campaign
#    Add `--dry-run` to print the plan; `--arm evolved|baseline` for a single arm;
#    `--skip-existing` resumes a killed run; `--keep-work` keeps per-task checkouts.
#    Collect one paired result row per task into results.json — see the schema below.

# 3. Score and record the decision:
pnpm eval:self-evolve score  --results packages/self-evolve/evaluation/results.json
pnpm eval:self-evolve decide --results packages/self-evolve/evaluation/results.json --write
```

**约束——install 与 arm 工作区**：数据集 `install` 命令只在基础 checkout 上跑一次、装进共享 venv；两个 arm checkout 是此前独立 clone 的，判定在 pristine reset 后的 arm 上执行。对 `install` 为可编辑装包的任务，被测包可能从基础 checkout 而非 arm 的预测解析——这是已知的 local-reproduction 局限，也是判定被如此标注的原因。

`decide --write` 持久化 `eval-decision.json`；`pnpm run verify-self-evolve-eval`（CI 门禁）在记录的建议为 `rollback` 时失败——即"CI 跨零自动停开关"。

<a id="result-schema"></a>
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

<a id="environment-requirements"></a>
## 环境要求

- **清单导出**：Hugging Face（`princeton-nlp/SWE-bench_Verified`）+ `datasets` 包；脚手架本身只消费导出的 JSONL/JSON。
- **战役运行（本地 P-B）**：`git`、`uv`（或经 `--env-tool venv` 用 `python3 -m venv`）、以及 agent 臂所需的 `DEEPSEEK_API_KEY`；无需 Docker。每题用一个共享 venv，并运行数据集 `install` 命令进去；判定是在 arm checkout 里跑的本地 `python -m pytest`，并被标注为 **local-reproduction，而非官方 SWE-bench**。脚手架不代跑 agent；收集到的 `results.json` 就是契约。
- **战役运行（官方交叉校验 P-C）**：`DEEPSEEK_API_KEY` 与支持 docker 的主机（每实例的 SWE-bench 协议）。官方判定可能因依赖/系统漂移而不同于本地判定，仍是正式的证据路径。
- **可复现**：在战役记录中固定子集 seed 与清单；bootstrap seed 只需对决策记录稳定。

<a id="honest-status"></a>
## 诚实状态

脚手架已落地并有单测（子集确定性、评分、区间、决策 I/O）。`campaign` 运行器的 dry-run 计划、git-pathspec 预测排除、以及 merge/verdict 纯逻辑有单测；其子进程路径（git/venv/pytest）由带桩判定的临时仓库覆盖。另接了一个 keyed e2e（`pnpm run test:e2e`，需要 `DEEPSEEK_API_KEY` 与导出的清单 `SELF_EVOLVE_E2E_MANIFEST`）来贯通单个真实任务，但无它们时 self-skip。**本仓库尚未执行任何真实 SWE-bench 任务**——需要 keyed agent 加每题环境，且决策记录文件尚不存在，因此 CI 停开关处于休眠态。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- **本地复现，非官方 SWE-bench**——P-B 判定是在 arm checkout 中本地执行 `python -m pytest`；依赖与系统漂移可能使其不同于官方每实例判定，后者仍是正式证据路径。
- **安装与 arm 工作区的约束**——数据集 `install` 命令在基 checkout 上运行一次并写入共享 venv；对 editable 包安装，被测包可能从基 checkout 而非 arm 的预测解析；判定将以此为前提报告。
- **Keyed 路径尚未在本仓库跑过**——本仓库尚未执行任何真实 SWE-bench 任务。记录的 `eval-decision.json` 尚不存在，因此 CI 停开关处于休眠态。

### 开发备注

无。
