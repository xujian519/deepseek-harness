# Agent Note: Self-evolve P1-10 战役运行器采用本地 venv 路径（无 Docker）

Status: implemented

[English](2026-08-22-self-evolve-p1-10-campaign-runner.md) | 中文

## Problem

P1-10 需要一次 60 题 SWE-bench_Verified 的配对离线战役：baseline 与 self-evolve 两臂、逐任务 FAIL_TO_PASS/PASS_TO_PASS 判定。评估脚手架（`@deepseek-ai/dsh-self-evolve-eval`）刻意不代跑 agent，而官方 SWE-bench 协议需要每实例 docker 镜像（`swebench/swebench_verified:<instance>`）——60 题子集约 10–25 GB 镜像，本地战役预算无法承载。缺失的是这样一个编排器：准备每任务环境、经 `dsh --profile headless` 跑两臂、收集 agent 补丁、判定 verdict、把配对行合入 `results.json`。[脚手架 note](../feature/2026-08-21-self-evolve-p110-eval-scaffold.zh.md) 恰把这个运行器推迟到 keyed 后续、并拒绝了包内 docker 路径；本 note 在本地路径上取代该拒绝，同时把 docker 路径留在本包之外。

## Decision

把战役运行器实现为现有脚手架的 `campaign` CLI 子命令，采用**本地轻量路径（P-B）**替代 docker：

- 每任务：在 `base_commit` 检出仓库、把 `test_patch` 应用到两个独立的臂检出、准备一个共享 venv（`uv venv --seed`，`--env-tool venv` 回退）、把数据集 `install` 命令装进该 venv，然后每臂运行一次 agent（`node --import tsx/esm apps/cli/src/bin.ts --profile headless [--patch <生成的 overlay>] "<problem_statement>"`）。evolved overlay 镜像 `packages/bundle/self-evolve-app/cordis.patch.yml` 并附加逐任务 `workspaceVerifier.buildCommand`（默认 `{python} -m compileall -q .`）——不配则 held-in 验证器退化到弱路径，evolved 臂永不 commit。
- 预测 = 暂存 diff，排除 `.dsh/` 与测试补丁拥有的全部文件（测试文件改动永远不进判定）。
- 判定 = 在干净 reset（base commit + test_patch + 重新应用预测）后的任务 venv 中 `python -m pytest <FAIL_TO_PASS> <PASS_TO_PASS>`。
- 语义：dsh 进程崩溃（非零退出）重试一次——属基础设施而非证据；agent 超时与判定失败均为终局。环境/清单失败成为无 boolean 的可重试 error 行，`validateResults` 在评分时拒绝它们——不完整战役永不静默计分。每臂完成后行即落盘，`--skip-existing` 可续跑被中止的运行。

## Alternatives considered

**官方 docker 协议（路径 P-C）**——官方每实例镜像判定；保留为抽检/正式证据路径，因为本地 venv 判定可能与官方镜像不同（依赖与系统漂移）。配对设计限制了该漂移对净胜差的影响：两臂共用同一环境。

**dsh 容器化**——在 SWE-bench 镜像内跑 dsh（把 node/dsh/key 装进镜像）又慢又重；弃用。

**仅 harness 内部 smoke（路径 P-A）**——用 held-in 信号当"通过"判定只能验证插件机制，不能作为 P1-10 证据；未采纳。

## Consequences

- 运行器无需 Docker：本地路径峰值磁盘 ≈ 5–10 GB，每任务 venv 从全局 `uv` 缓存创建；60 题战役可容纳在一台 keyed 主机上。
- 判定如实表述为"本地复现"，而非官方 SWE-bench；报告必须声明这一点，官方抽检仍属路径 P-C。
- 脚手架诚实状态不变：本仓库尚未执行真实 60 题战役。运行器已作为 `campaign` CLI 子命令接线；其 dry-run 计划、git 路径排除、merge/verdict 纯逻辑，以及子进程路径（在带桩判定的临时仓库里跑 git/venv/pytest）已做单测。另有一个 keyed e2e（`pnpm run test:e2e`）贯通单个真实任务，缺 `DEEPSEEK_API_KEY`/`SELF_EVOLVE_E2E_MANIFEST` 时 self-skip。
