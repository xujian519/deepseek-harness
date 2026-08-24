# Agent Note：fork 政策——上游不接受 PR

Status: implemented

[English](2026-08-23-fork-policy-upstream-accepts-no-prs.md) | 中文

## 问题

本仓库是一个 fork：`origin` 是 `xujian519/deepseek-harness`，`upstream` 是 `deepseek-ai/deepseek-harness`。上游不接受 PR，因此 fork 自有工作无法回流，fork 必须在上游基线之上永久承载自己新增或修复的一切，只要这些工作仍然有用。fork 拥有自己的表面（desktop、patent、self-evolve、synapse、plugin-market、openviking、`dsh-timeout-guard` 改名）、自己的免费版 CI 布局，以及一个与上游发布线对齐的工作区统一版本族，而上游发布仍在不断到来，并逐个前向合并（[rc.1 同步](2026-08-21-upstream-v0-1-1-rc-1-sync.zh.md)、[rc.2 同步](2026-08-23-upstream-v0-1-1-rc-2-sync.zh.md)）。缺少一条固定规则时，修复的去向与同步方向都各有一个看似合理却错误的默认：向上游贡献，或把 fork 历史重建到上游 master 之上。

## 决策

fork 就是交付仓库。一切决策、修复、功能与门禁工作都落在这里：贡献者在本仓库自己的分支与 `master` 上开 PR，绝不向上游发起或提议 PR。上游仍未修复的缺陷就在这里修，落在它所属的包中——包括上游自有代码，此时 fork 以本地变更的形式承载差异，并在每次同步时由分类冲突解决重新应用（[rc.2 同步](2026-08-23-upstream-v0-1-1-rc-2-sync.zh.md)记录了该流程）。本可成为上游贡献的修复以 fork 私有改动提交并注明归 fork 所有；它们不进入任何上游通道，也不假设将来会落到上游。

上游同步只走单向前向合并：fetch `upstream`，将 `upstream/master` 以每个发布一个合并提交、附一个 fork 侧 PR 的方式合并进 fork 的 `master`，按类别解决冲突，对合并后的源码树重新生成目录、图谱与翻译配对记录，并把 fork 的版本族抬升到上游版本。绝不以 rebase 或 cherry-pick 把 fork 落到上游之上——改写 fork 已发布的历史不在选项内。fork 与上游共享 `dsh-v*` 标签空间，因此 fork 不推送任何标签。上游的 workflow 变更以归档形式进入 `workflows-disabled/`；fork 的 CI 布局保持自有。

## 备选方案

- **先向上游提交修复。** 否决——上游不接受 PR；等待一个不存在的通道会让 fork 缺陷滞留，而且当 fork 终究要自带该修复时，还会重复劳动。
- **把 fork rebase 到上游 master 上。** 否决——它会改写 fork 已发布的提交历史，打断进行中的分支与 stacked PR，并掩盖同步边界；合并提交把每次同步记录为 fork `master` 上一个可评审的整体。
- **用 cherry-pick 代替合并带入上游变更。** 否决——它丢失发布边界，逐提交反复处理冲突，并且无法在一次处理中调和 fork 的版本族与 CI 布局。
- **把上游代码上的 fork 补丁保存为独立补丁集反复重放。** 否决——冲突已经在每次合并时按类别解决；补丁集会复制这份状态并偏离合并后的源码树。

## 后果

上游修复只在下一次前向合并到达 fork，因此在此之前，某一上游缺陷仍会在 fork 中继续传播，除非 fork 已为同一缺陷自带修复。fork 私有的修复到不了上游用户；当上游日后独立修复同一缺陷时，同步合并解决这份重复。每来一次上游发布，分歧就加深一步，且每次同步都需要再一次冲突评审，rc.1 与 rc.2 同步笔记记录了累积成本。fork 特性分支照常以 fork 自己的 `master` 为基，开放的 fork PR 正常合入。
