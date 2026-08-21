# Agent Note：self-evolve 工作区验证器（P1.9b）

Status: implemented

[English](2026-08-21-self-evolve-workspace-verifier.md) | 中文

## 问题

held-in 双验证器缺一只真实的眼睛。`BasicSelfEvolveEngine.collectWorkspaceSignal` 是返回 `null` 的占位钩子，因此 `requireDualVerification`（默认 true）恒走弱路径 0.3，`minAcceptConfidence`（0.5）不可达，基础 bundle 能挖掘模式、提出编辑却永远无法提交。早前的加固笔记（[提交重复与 lint 加固](../bug-fix/2026-08-18-self-evolve-commit-and-lint-hardening.zh.md)）刻意选择"如实记录"而非实现该验证器，把它推迟到 P1.10 评估证据之后。占位路径上还叠着两个契约缺陷：`{ dirtyLines, noDirtyFallback }` 形状无法表达 build 失败（旧的 `buildPassed = noDirtyFallback || dirtyLines ≤ tolerance` 在 `noDirtyFallback` 下无条件放行，且没有测试曾把它置真）；`validateProposal` 用 `Promise.all` 并行采集重放与工作区信号，工作区检查永远看不到重放之后留下的状态。

## 决策

在基础提供方实现工作区验证器（P1.9b），挂在显式配置策略之后，并修复两个契约缺陷：

- **契约**：`WorkspaceSignal = { dirtyLines, noDirtyFallback, buildHealthy: boolean | null }`；`_verifyHeldInCase` 同时要求重放、build 健康与脏容差，并在诊断中区分 `build-failed` 与 `workspace-dirty`。`captureWorkspaceBaseline` 记录重放前的 git 状态；`collectWorkspaceSignal(agent, proposal, signal, baseline)` 测量重放的净脏增量。
- **脏度量**：`git diff HEAD --numstat --relative`（设计稿 `git diff --stat` 的机器可解析形式）加未跟踪文件行数，排除 harness 自营的 `.dsh/` 路径——无论项目是否 gitignore `.dsh/` 结果都确定。增量下限为 0：用户工作区预存的在途改动不会冤枉门禁，重放也不能借预存脏掩盖自己的足迹。
- **build 健康**：配置的 `workspaceVerifier.buildCommand` 以会话 cwd 经 `ctx.shell` 运行（shell 语义、超时与 executor 沙箱策略都由它承担）；非零退出或超时即不健康。
- **退化矩阵**：验证器被禁用、shell 服务缺失、工作区非 git 仓库且无 build 回退、或未配置 `buildCommand` 时，信号为 `null`（弱路径）。`noDirtyFallback: true` 是非 git 工作区的 build 单边回退。
- **接线**：`validateProposal` 现在先采基线、再跑重放、后采工作区信号——顺序执行，信号反映重放后的真实状态。

## 备选方案

**以独立 provider 包交付。** 否决：钩子本就在基类上，新包要为一约 50 行逻辑背全套脚手架（manifest、invariant、双语 README、tsdown、catalog）。基础提供方通过可选 `ctx.get('shell')` 保持轻量。

**保留旧契约，把 build 失败编码成膨胀的脏计数。** 否决：撒谎的信号会以捏造的回归原因污染负面结果知识库。

**默认 `workspaceVerifier.enabled: false`。** 否决：改为 `true` 配安全退化矩阵——未配置 `buildCommand` 时信号仍不可用，循环行为与此前逐字节一致，任何部署都不会被静默改变；flag 留给显式关闭。

## 后果

- 当 profile 配置 `workspaceVerifier.buildCommand` 且项目是 git 工作树时，held-in 门可以真正通过；默认组合仍然零提交。
- `parseDirtyDelta` 已导出并有单测；真实 git 集成测试覆盖基线/增量、非 git 回退、build 失败、build 超时、未跟踪行数计数与 `.dsh/` 排除、`enabled: false` 与缺 `buildCommand` 弱路径（provider spec：143 测试）。
- `self-evolve-basic` 新增 `workspaceVerifier` 配置字段；`validateProposal` 改为先重放后工作区检查。
- 工具提示片段与 README 双语对更新为：工作区检查仅在 profile 配置 build 命令时生效。
- 仍推迟：P1.10 评估、L3/L4 提案生成、P4.3 相似度去重、keyed 端到端验证。
