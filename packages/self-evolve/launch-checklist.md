# P1.10 实机评估启动清单（草稿 · 待评审）

> **内部工作追踪文档（非参考，不参与双语/doc-sync）**：用于 P1.10 评估的排期与验收记录。权威参考——子系统见 [`docs/subsystems/self-evolve.md`](../../docs/subsystems/self-evolve.md)（含 `.zh.md`），各包契约见各自双语 README。

> **改判（2026-08-22）**：用户决定**放弃离线实测**，改用实际使用观察。本清单转为"未来需要正式证据时的执行指南"，不再按 M1–M6 推进；无需再拍板 §8 的各项开放项。观察方案见 [`./spec.md`](./spec.md) §"证据策略改判"。
>
> **2026-08-22 状态**：T3 战役运行器已实现（`pnpm eval:self-evolve campaign`，本地无 Docker 路径 P-B）；证据路径与 CI 停开关保留。
>
> 目标：在 60 题 SWE-bench_Verified 离线子集上完成 baseline vs self-evolve 配对双跑，产出净胜分 95% 置信区间与 continue/rollback 决策记录，激活 CI 停开关（`verify-self-evolve-eval`，已注册于 `scripts/run-gates.ts` 的 `ciSharedStaticGates`）。
>
> 脚手架（`packages/test-support/self-evolve-eval`）负责子集选择、评分、区间、决策与门禁；**它不代跑 agent**（[README Honest status](../test-support/self-evolve-eval/README.md)）。因此本清单除环境与命令外，还包含一份当前缺失的"战役运行器"工程项（T3），需先实现再开跑。

---

## 0. 判定规则（先读，再定预算）

- 主统计量：配对通过率差 `winRateDelta = (evolvedPassed − baselinePassed) / N`。
- 区间：`bootstrapCi` 1 万次重采样的 2.5%/97.5% 分位（`--seed` 固定可复现）。
- 决策（[decision.ts](../test-support/self-evolve-eval/src/decision.ts)）：
  - `continue` 仅当 **区间低界严格 > 0**；
  - 区间跨零（随机性无法排除）或 ≤ 0（损伤证据）→ `rollback`。
- **预期敏感性**：N=60 时每任务占 1/60 ≈ 1.67%，区间颗粒度粗。粗略测算：无输同赢时约需 **净胜 ≥ 4** 才可能低界 > 0（≈ 边际），**净胜 ≥ 5** 才较稳；若存在输单（losses），所需净胜更高。小效应大概率"跨零 → rollback"——这是 spec 的证伪优先设计（回滚条件），不是评估失败。
- 停开关语义：`eval-decision.json` 记录 `rollback` 时 CI 门禁红灯（保持红直到处置），记录缺失时门禁绿灯（"switch dormant"）——**注意：决策文件必须入库才会生效于仓库 CI**。

---

## 1. 环境要求

| 项 | 要求 | 说明 |
|---|---|---|
| 主机 | Linux 或 macOS；≥16 GB RAM；磁盘 ≥30 GB 空闲 | 仅官方镜像判定路径需要这个量级；轻量路径（§7，无 Docker）峰值 ≈5–10 GB |
| Docker | Docker Engine（或 Docker Desktop） | **仅官方判定路径必需**（每任务 `swebench/swebench_verified:<instance_id>` 镜像，60 题 10–25 GB）；轻量路径不需要 |
| Node/pnpm | `node ^22.19 || >=24` + pnpm（本仓库要求） | `pnpm install` 后经 `pnpm dsh` 源码启动（tsx），无需先 build |
| API Key | `DEEPSEEK_API_KEY` 写入仓库根 `.env`（或导出）；可选 `DEEPSEEK_BASE_URL` | 决策记录中记录所用模型名与配置 |
| Python | `pip install swebench datasets`（验证 harness 与数据集导出） | 若完全复用官方 `swebench` harness 做验证，则此为其必需依赖 |
| 网络 | GitHub（repo 检出）、Docker Hub（镜像）、Hugging Face（数据集，建议 `HF_TOKEN`） | 导出时记录数据集 revision 用于复现 |
| 本仓库 | 检出**含 P1-10 脚手架**的 master（>= `d1836d45`），`pnpm install` 通过 | 子集/评分/决策全部经 `pnpm eval:self-evolve` |

**环境自检（开跑前 15 分钟）**：`pnpm install` + `pnpm dsh --profile headless "echo ok"`（需 key）+ `pnpm exec vitest run packages/test-support/self-evolve-eval`（111 用例全绿，2026-08-23 实测）+ `docker pull swebench/swebench_verified:<一个子集镜像>` 成功（该镜像仅 P-C 官方判定路径需要）。

---

## 2. 两臂定义（控制变量）

| 臂 | 组成 | 关键点 |
|---|---|---|
| **baseline** | 标准 headless 组装（不含 `self-evolve-app`） | 与 evolved 唯一的差异 = self-evolve 开关 |
| **evolved** | 同 headless + `self-evolve-app` bundle overlay | **必须同时配置** `workspaceVerifier.buildCommand`——不配则 held-in 恒走弱路径 → 永不产生 commit，evolved≈baseline，测到的只是 overhead 而非收益（bundle 的 [`cordis.patch.yml`](../bundle/self-evolve-app/cordis.patch.yml) 默认注释掉该项） |

- 每任务 buildCommand 建议：该仓库的快速健康检查（如 `python -m compileall <src>` 或项目自身测试搜集命令），需在**干净检出**上通过；同一任务两臂用同一命令（其实只影响 evolved 臂）。
- 其余控制项：同一模型、同一最大轮数/预算上限、同一 `problem_statement`、同一 task 工作区（同 base_commit + 同 test_patch）。建议每任务轮换两臂顺序（或固定并记录），消除系统性偏差。
- 上限建议：per-run turn 上限（如 30 次）或 token 上限；超限按"未解决"计（fail），**不要**用重试救活超限轮。

---

## 3. 命令序列

> **可直接执行的完整版本（含每步验收标准）见 [`evaluation/RUNBOOK.md`](evaluation/RUNBOOK.md)（中文 [`evaluation/RUNBOOK.zh.md`](evaluation/RUNBOOK.zh.md)）。本节为要点版命令序列，与之保持一致；如有出入以 RUNBOOK 为准。**

### Step 1 — 数据集导出（一次性，网络环境）

```sh
python -c "from datasets import load_dataset; \
  load_dataset('princeton-nlp/SWE-bench_Verified').to_json('swebench-verified.jsonl')"
sha256sum swebench-verified.jsonl   # 记录 manifest sha256 + HF revision 到 campaign 记录
```

### Step 2 — 确定性子集

```sh
pnpm eval:self-evolve subset \
  --manifest swebench-verified.jsonl \
  --seed 20260821 \
  --out packages/self-evolve/evaluation/subset.json
```

验收：恰好 60 项；重跑一次且 `sha256sum` 不变（确定性）；字段齐全（`instanceId/repo/baseCommit/failToPass/passToPass`，无空 failToPass 的剔除项——`subset` 只做归一化，需人工看一眼极简任务占比）。

### Step 3 — 战役双跑（本地轻量路径 P-B，运行器已实现）

运行器已实现为 `pnpm eval:self-evolve campaign`（`packages/test-support/self-evolve-eval`）：逐任务准备（`base_commit` 检出 + test_patch + uv venv + 数据集 `install`）→ 每臂一次 `dsh --profile headless`（evolved 臂附生成的 overlay，`workspaceVerifier.buildCommand` 默认 `{python} -m compileall -q .`）→ 收集 prediction（排除 `.dsh/` 与测试补丁文件）→ 本地 `python -m pytest <FAIL_TO_PASS/PASS_TO_PASS>` 判定 → 合入 `results.json`（每臂落盘，可续跑）。

```sh
# 冒烟（建议先 5 题，--task-limit 5；--dry-run 先看计划）
pnpm eval:self-evolve campaign --manifest swebench-verified.jsonl \
  --subset packages/self-evolve/evaluation/subset.json --arm both \
  --task-limit 5 --concurrency 2 --env-tool uv

# 全量 60 题（两臂）；被中止后加 --skip-existing 续跑
pnpm eval:self-evolve campaign --manifest swebench-verified.jsonl \
  --subset packages/self-evolve/evaluation/subset.json --arm both
```

语义：dsh 进程崩溃（非零退出）重试一次（基建）；判定失败为终局；环境/清单失败为可重试 error 行（无 boolean），`validateResults` 拒绝不完整文件——不完整战役不会静默计分。全量 120 次 agent 运行（P-B 本地 venv 路径，无 Docker）：预计机时显著低于官方镜像路径，仍建议 2–4 并行 worker（`--concurrency`）。

### Step 4 — 评分、决策、门禁、入库

```sh
pnpm eval:self-evolve score  --results packages/self-evolve/evaluation/results.json
pnpm eval:self-evolve decide --results packages/self-evolve/evaluation/results.json --write
pnpm run verify-self-evolve-eval    # continue → 绿灯；rollback → 红灯（停开关激活）
```

入库：`subset.json`、`results.json`、`eval-decision.json`、评估报告 `REPORT.md` 一并提交（停开关要进 CI 就必须让决策文件在仓库中）。`results.json` 建议追加顶层 `meta` 块：模型名、两臂配置摘要（含 buildCommand）、运行时间窗、manifest sha256/HF revision——`validateResults` 只校验必需字段，额外字段保留在文件中不影响评分。**verdict 表述**：本地复现判定（P-B），如需官方 SWE-bench 基准，另走 §7 P-C 抽检/全量。

---

## 4. 里程碑与产物验收

| # | 里程碑 | 验收标准 |
|---|---|---|
| M1 | 环境就绪 | §1 自检全部通过 |
| M2 | 子集生成 | `subset.json` 60 项、确定性（sha256 稳定）、campaign 记录含 manifest 指纹 |
| M3 | 5 题冒烟 | 两臂全链路 5/5 有 verdict；patch 收集与本地 pytest 判定人工核对 1 例 |
| M4 | 全量双跑 | `results.json` 60 行、taskId 与 subset 一一对应、无多余、**0 个 error 行**（若有，必须在报告中人工解释并按未通过计） |
| M5 | 决策与门禁 | `eval-decision.json` 生成；`pnpm run verify-self-evolve-eval` 与推荐一致；REPORT.md 含每任务 win/loss/tie 表、成本与耗时统计、环境与复现信息 |
| M6 | 状态回填 | `check_list.md` P1-10 ☑、`tasks.md` P1.10 ☑、`spec.md` §P1 对应项勾选、`self-evolve-eval` README "Honest status" 更新为已运行（附实际结果） |

**rollback 情形下 M5/M6 的处置**（按 spec 回滚条件）：记录决策 + 回滚动作——self-evolve 默认关闭、仅保留 L1-skill、不做 P2/P3/P4（该动作及其证据同样要入库并回填文档）。

---

## 5. 工程项 T3：战役运行器（已实现，P-B 本地路径）

**状态：已实现**（本次工作，位于 `packages/test-support/self-evolve-eval`，`pnpm eval:self-evolve campaign`）。覆盖：per-task 工作区准备（git clone + test_patch + venv + `install`）、两臂 headless 调用（evolved overlay 自动生成）、prediction 收集（排除 `.dsh/` 与测试补丁文件）、本地 pytest 判定、results.json 增量合入与断点续跑、统计流水（`campaign-stats.jsonl`）、dry-run。单测覆盖纯逻辑（补丁解析、overlay 渲染、臂合并、计划、清单索引）；git 路径排除与 CLI dry-run 已实测。

**未覆盖（属 P-C 官方判定路径）**：官方 `swebench` harness `run_evaluation` 封装——本地判定（P-B）与官方镜像判定的抽检对齐仍需一台有 Docker 的机器/CI 完成（§7 路径 P-C）。

## 6. 风险与降级

- **成本失控**：5 题冒烟先估每题 token/时间，再按比例核算 120 题；per-run 硬上限（`--timeout-min`）。
- **验证器判错（SWE-bench 假阳/假阴）**：P-B 本地 verdict 与官方镜像有差异风险——保留每次 pytest 日志（`<workdir>/<task>/logs/<arm>-verify.log`）+ 抽检对齐（§7 P-C a）；报告按"本地复现判定"表述，不冒充官方基准。
- **数据泄漏**：test_patch 的测试文件清理 + prediction 排除测试文件；不要用"已通过"任务的解答影响后续任务。
- **时间预算**：M3 半天、M4 机时 1–2 天（P-B 并行）、M5 半天；T3 已完成（本次）。

## 7. 轻量替代路径（无 Docker / 小体积，推荐先行）

> 结论：体积大头是**每实例 docker 镜像（10–25 GB）**，不是数据或代码。若评估目的是 "本插件效果的方向性证据 + 全链路可复现"，可以用**本地 venv + 仓库内直接跑 FAIL_TO_PASS** 替代官方镜像验证；代价是判定基准与官方 SWE-bench 协议有环境差异（见下"一致性"）。最终需要官方基准的正式结论时，仍建议把全量 60 题放云/CI 一次性跑（路径 P-C）。

### 路径 P-B：uv venv 本地复现（推荐）

- **替换对象**：`swebench/swebench_verified:<instance>` docker 镜像 → `uv` 每任务 venv。
  - `uv venv` 从全局 wheel 缓存**硬链接**创建：60 个 venv 真实新增磁盘 ≈ 每任务 0.2–0.6 GB（重依赖仓略高）+ 全局缓存 3–6 GB（一次性）；repo 检出每任务 0.05–0.5 GB，验证完即删。**峰值 ≈ 5–10 GB，无需 Docker。**
  - Python 版本按实例提取（镜像内 python 3.8–3.11 不等）；`uv python install <ver>` 自动下二进制（~100 MB/版本）。
- **每实例安装**：数据行含官方 harness 用的 `install`/`test_cmd` 字段（以实际导出为准；缺失时 fallback 仓库 requirements/README）。**子集脚手架只保留 6 字段，运行器必须同时保留原始 JSONL 行**。
- **agent 与验证同一环境**：工作区 = repo@base_commit + test_patch，venv 激活后 shell 直接 `python -m pytest <FAIL_TO_PASS ids>` —— 这也成为 evolved 臂 `workspaceVerifier.buildCommand`（轻量版可先 `python -m compileall` 或测试搜集）。
- **判定**：应用 prediction + test_patch → FAIL_TO_PASS 全绿且 PASS_TO_PASS 无红 → passed。
- **一致性处理（必须写进报告）**：本地 venv 与官方镜像存在依赖/系统层偏差，verdict 可能不同。缓解：a) 用 3–5 个任务在任一有 Docker 的机器（或后续云/CI）跑一次官方判定，与本地判定比对（期望一致率 ≥90%，记录差异原因）；b) **两臂使用同一环境**，系统性偏差对配对 delta 影响有限——结论写为"本地复现环境下的净胜信号"，不冒充官方 SWE-bench 判定。
- **先小后大**：`subset --count 15–20` 跑 pilot（半天），验证全链路 + 估成本 + 拿方向性数据；**注意 N<60 大概率"跨零→rollback"**，pilot 只用于工程验证与预算，不作为 P1-10 正式证据。

### 路径 P-C：云 / CI 一次性官方判定（正式证据路径）

- GitHub Actions matrix：`ubuntu-latest` 自带 Docker，60×2 切 120 个 job（每 job 拉 1 镜像 + 跑 1 题）；免费额度 2000 分钟/月 ≈ 不够（120 × ~20 分钟 ≈ 2400 分钟），需付费/自托管 runner。
- 或临时云主机（8 核 / 100 GB 磁盘，约 ¥1–2/h × 20–40 h ≈ ¥50–100，一次性）。
- 适合：需要"官方 SWE-bench 判定"的最终 60 题结论，或抽检对齐（上文 a）。

### 路径 P-A：只做机制 smoke（最省，不代表评估）

- 用 harness 自身 held-in 信号（build 健康 + git 净增量）近似"通过"——验证插件机制而非 SWE-bench 净胜，**不能作为 P1-10 证据**，仅作 e2e 冒烟。

### 推荐顺序

P-B pilot（15–20 题，半天，验证 T3 运行器）→ P-B 本地 60 题全量（1–2 天机时）→ 如需要官方基准，P-C 补官方判定或抽检对齐。

---

## 8. 需要拍板的开放项

1. ~~T3 运行器~~ **已解决**：随 `self-evolve-eval` 脚手架实现（`pnpm eval:self-evolve campaign`）。
2. ~~buildCommand 取值~~ **已解决**：默认 `{python} -m compileall -q .`；`--build-command` flag **已实现**（`pnpm eval:self-evolve campaign --build-command <template>`，2026-08-23 经 campaign 测试覆盖确认）。
3. 是否接受"两臂轮换顺序"与 5 题冒烟先行（推荐）。
4. **采用哪条路径**：已确认 **P-B**（uv venv 本地轻量，先 15–20 题 pilot 再全量）；是否保留 P-C（云/CI）作为"官方判定"的最终证据路径。
5. 本清单文档语言：当前为中文单语草稿；若随里程碑入库，需按仓库文档规范补英文配对与 doc-sync 登记（或移入不参与 doc-sync 的脚本/notes 区域）。
