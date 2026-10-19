# Self-Evolve P1.10 评估 Runbook

[English](RUNBOOK.md) | 中文

运行 60 题离线配对 baseline-vs-self-evolve 评估，记录 continue/rollback 决策，并激活 CI 停开关。

## 诚实状态

- **衡量什么**：在确定性 SWE-bench_Verified 子集上的配对净胜信号——baseline harness 对比挂载 `self-evolve-app` bundle 的同一 harness（每任务 `uv` venv、本地 `pytest` FAIL_TO_PASS 判定，**P-B 轻量路径，无 Docker**）。
- **不是什么**：这是**本地复现**判定，**不是官方 SWE-bench 打分**。报告请表述为"本地复现环境下的净胜信号"；任何"生死攸关"的结论都应再用 Docker/云跑一次交叉校验（路径 P-C）。
- **门禁只感受决策记录**：`verify-self-evolve-eval` 在 `packages/self-evolve/evaluation/eval-decision.json` 记录为 `rollback` 时失败。脚手架从不伪造结果；数据缺失时如实失败。
- **当前 blocker（尚无决策记录）**：本代码树尚未跑过 campaign，因此 `results.json` 与 `eval-decision.json` 都不存在，`verify-self-evolve-eval` 保持休眠。实跑需要 operator 具备：（a）两条 arm 都可用的 `DEEPSEEK_API_KEY`；（b）本地导出的 SWE-bench_Verified（`swebench-verified.jsonl`，联网、一次性）；（c）`uv` 生成的每任务 Python 环境；（d）逐行阅读 `install` 命令后显式决定是否传 `--allow-dataset-install`。在此之前，评估路径没有任何绿灯，也不应被暗示有。

## 0. 前置自检 — 环境自检

从仓库根目录运行。下面所有命令假设在此目录。

```sh
# 工具链
node -v                                  # ^22.19 || >=24
pnpm  -v                                  # 任意较新版本
git   --version
uv    --version                           # 若用 --env-tool uv（默认）；否则走 python3 -m venv

# Agent key
test -f .env || echo "WARN: 无根 .env — 请导出 DEEPSEEK_API_KEY（可选 DEEPSEEK_BASE_URL）"

# 数据集导出依赖（仅步骤 1 需要）
python -c "import datasets; print(datasets.__version__)" || echo "WARN: 安装 'pip install datasets'"

# 脚手架自检（评估单测必须全绿）
pnpm exec vitest run packages/test-support/self-evolve-eval
#   预期: Test Files 9 passed (9), Tests 157 passed (157)
```

> 若找不到 `pnpm`/`node`，先 prepend nvm/homebrew bin 目录，例如 `export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:/opt/homebrew/bin:$PATH"`。

## 1. 导出任务清单（联网，一次性）

```sh
python -c "from datasets import load_dataset; \
  load_dataset('princeton-nlp/SWE-bench_Verified').to_json('swebench-verified.jsonl')"
sha256sum swebench-verified.jsonl        # 将此 sha256 与 HF revision 记入 REPORT.md
```

## 2. 选出确定性的 60 题子集

```sh
pnpm eval:self-evolve subset \
  --manifest swebench-verified.jsonl \
  --seed 20260821 \
  --count 60 --reserve 60 \
  --out packages/self-evolve/evaluation/subset.json \
  --reserve-out packages/self-evolve/evaluation/reserve.json
```

验收：恰好 60 项；重跑得到字节一致的 `subset.json`（确定性）；每行含 `instanceId/repo/baseCommit/failToPass/passToPass` 且 `failToPass` 非空。命令还会打印 `subsetDigest=…`，请随本次运行一并记录。

留存池（reserve）是**与子集不相交**的另一批任务。把它留给确认轮：针对同一子集的反馈反复提出候选，会让搜索自适应地过拟合该子集（[REUSE](https://arxiv.org/abs/2609.33180)），因此子集被消费超过一次后，应把它退役，改用留存池评估下一个候选。

## 3. Smoke 试点 — 5 任务、双臂（先 dry-run）

先打计划（不读清单）：

```sh
pnpm eval:self-evolve campaign \
  --manifest swebench-verified.jsonl \
  --subset packages/self-evolve/evaluation/subset.json \
  --results packages/self-evolve/evaluation/results.json \
  --stats  packages/self-evolve/evaluation/campaign-stats.jsonl \
  --work-dir /tmp/self-evolve-campaign \
  --arm both --env-tool uv --task-limit 2 --dry-run
```

再真正跑试点：

```sh
pnpm eval:self-evolve campaign \
  --manifest swebench-verified.jsonl \
  --subset packages/self-evolve/evaluation/subset.json \
  --results packages/self-evolve/evaluation/results.json \
  --stats  packages/self-evolve/evaluation/campaign-stats.jsonl \
  --work-dir /tmp/self-evolve-campaign \
  --arm both --env-tool uv --task-limit 5 --concurrency 2
```

验收：5/5 任务产出 `baselinePassed`/`evolvedPassed` 判定；人工核对 1 例收集到的 patch 及其本地 `pytest` 判定是否正确。

## 4. 全量 60×2 战役（可断点续跑）

```sh
pnpm eval:self-evolve campaign \
  --manifest swebench-verified.jsonl \
  --subset packages/self-evolve/evaluation/subset.json \
  --results packages/self-evolve/evaluation/results.json \
  --stats  packages/self-evolve/evaluation/campaign-stats.jsonl \
  --work-dir /tmp/self-evolve-campaign \
  --arm both --env-tool uv --concurrency 4
```

- 中断后加 `--skip-existing` 续跑。
- 数据集 `install` 命令只有在传入 `--allow-dataset-install` 时才会执行。被跳过的行会在该任务的 `setup.log` 中记录为 `dataset install skipped (allowDatasetInstall=false, cwd=…)`，因此遗漏可审计；请先读完 `subset.json` 中每行的 `install` 命令再传该标志，因为它会在共享 venv 中运行第三方代码。
- 默认值：`--dsh-entry apps/cli/src/bin.ts`、`--tsx-import tsx/esm`、 `--build-command '{python} -m compileall -q .'`、`--python 3.11`、 `--agent-timeout 1800000`、`--verify-timeout 1800000`。
- 其他超时：`--setup-timeout 300000`、`--install-timeout 600000`。
- **`{python}` 占位符会替换为每任务 venv 的 python**，因此 `--build-command` 控制 evolved 臂的 held-in workspace verifier。请用真实的项目健康命令（如 `{python} -m compileall -q <src>` 或该仓库自身的测试搜集命令）——无副作用的编译命令 会让 verifier 的 build 维度几乎无信息量。

验收：`results.json` 恰好 60 行、与 `subset.json` 一一对应、每任务配有双臂，且 **0 个 infra error 行**（`--skip-existing` 合并不得留下无判定的行）。

## 5. 评分、决策、查门禁

```sh
pnpm eval:self-evolve score  --results packages/self-evolve/evaluation/results.json
pnpm eval:self-evolve decide --results packages/self-evolve/evaluation/results.json \
  --subset packages/self-evolve/evaluation/subset.json \
  --prior-reuses 0 \
  --write
pnpm run verify-self-evolve-eval
```

决策规则（spec P1-10）：`continue` 需要**同时**满足——双侧精确 McNemar p 值低于显著性水平，**且**实测 `winRateDelta` 达到预注册的最小效应量（`--min-effect`，默认 0.05）。其余一律 `rollback`。在这个子集规模下，配对二值结果上的百分位 bootstrap 功效不足，不足以充当门禁，而"区间不含零"会放行小到没有实际意义的效应；区间仍会被记录，但只作描述，不再作为判据。

重用会收紧显著性水平：`--prior-reuses N` 把显著性水平除以 `N + 1`，因为针对同一个固定子集反复提出候选会抬高假晋升率。请传入同一 `subsetDigest` 上已记录的决策次数。`--write` 持久化 `eval-decision.json`（默认路径），这正是门禁读取的文件；`--subset` 记录本次决策覆盖的子集摘要。

## 6. 入库产物

提交到 `packages/self-evolve/evaluation/`：

- `subset.json` — 确定性任务选择。
- `results.json` — 配对逐任务判定（建议顶层加 `meta` 块：模型名、两臂配置摘要含 `buildCommand`、运行时间窗、manifest sha256/HF revision）。
- `campaign-stats.jsonl` — 逐臂运行统计。
- `eval-decision.json` — continue/rollback 记录。**必须入库才会在仓库 CI 生效。**
- `REPORT.md` — 逐任务 win/loss/tie 表、成本与耗时统计、环境与复现信息；表述为 **本地复现**，而非官方 SWE-bench。

## Rollback 的含义（若记录为 `rollback`）

按 spec 回滚范围：保持 self-evolve bundle **默认关闭**，仅保留 L1-skill，不做 P2/P3/P4。在同一 PR 中记录决策、回滚动作与证据，并同步更新 `check_list.md`/`tasks.md`/`spec.md`。回滚是 spec 的证伪优先设计在生效——不是评估失败。

## Caveats

- **install 与臂工作区**：数据集 `install` 先从基座检出一次性安装进共享 venv；两臂是 独立克隆，因此可编辑包安装时被测包可能从基座检出解析，而非从臂的 prediction。 这是已知的本地复现折中，也是判定表述为"如此报告"的原因。
- **判定不重试**：run 只对 agent 进程**崩溃**重试一次（基建），永不重试已落定的判定。 要重做某任务，只能刻意重跑该任务的两臂。