# Agent Note：将上游 dsh-v0.1.1-rc.1 同步进 fork

Status: implemented

[English](2026-08-21-upstream-v0-1-1-rc-1-sync.md) | 中文

## 问题

上游发布了 `dsh-v0.1.1-rc.1`（`528c682e06`），相对 fork 已合并的 rc.8 基线（`141eb6fef8`）领先 172 个提交、2303 个文件。fork 在同一基线上承载 107 个 first-parent 自有提交（desktop、patent、self-evolve、plugin-market、`dsh-timeout-guard` 改名），因此直接 merge 在文档、Agent Notes、README、CI workflow、两个源码文件与两个快照上产生了 87 个冲突文件。

## 决策

以单个 merge 提交前向合并（`Merge upstream v0.1.1-rc.1 (528c682e06) into fork`），按类别解决冲突：

- **`remote-events.ts`**：采用上游的 `credentials/reference-updated` 改名；保留 fork 的 `@deepseek-ai/cordis/*` 转发事件名，与 fork rescope 后的 cordis-host-runner emit 一致。
- **`gen-cordis-catalog.ts`**：两侧新增都保留——fork 的 `desktop`／`@deepseek-ai` 行与上游的 `authorization` 行。
- **`.github/workflows`**：fork 只运行 `ci-fork.yml` + `expected-filenames.yml`；上游新增与变更的 workflow（`ci-master.yml`、`release-publish.yml`、`release-vendor-publish.yml`、更新后的 `issue-lifecycle.yml`／`issue-policy.yml`）进入 `workflows-disabled/`，作为原样跟随上游 rc.1 的档案。`ci-workflow.spec.ts` 采用上游断言并保留 fork 的 `workflows-disabled/` 回退（`loadWorkflow`）；`client-build-environment.client.spec.ts` 保留 fork 的目录扫描。
- **Agent Notes / 文档**：fork 已决策处保留 fork（`dsh-timeout-guard` 改名保留；fork 的 `workflows-disabled/` 路径保留）；其余吸收上游（`.zh.md` 链接本地化、ci/ci-master 拆分事实）。目录、模块图、文档图与翻译配对记录按合并后的树重新生成。
- **快照**：pwsh fixture 通过 `migrate:packed-session-fixtures` 迁移；translation-prompt 响应按 rc.1 prompt 重录。
- **版本族**：fork 的 22 个非上游 manifest 从 `0.1.0-rc.8` 对齐到 `0.1.1-rc.1`，使工作区共享一个版本（dsh release family 的要求）。不推送任何 tag——fork 与上游共享 `dsh-v*` tag 空间。
- **self-evolve 投影**：适配 rc.1 的 `ProjectionDefinition` wire 形式（`stateSchema` + `wire.view/viewSchema`、`SessionProjectionStateMap` 声明合并）；该单元按既有 `SessionProjectionMap` 条目保持 client-visible。
- **rescope-vendor**：退役 knip logger-console edit（上游已删除 `@cordisjs` 条目）；豁免 `cordis/before-approval` 事件域监听方与 desktop-package 的 vendor 树路径，使其跳过通用 token 扫描。

## 后果

fork 在自身 seam 完整的前提下跟进上游 rc.1：`dsh-timeout-guard` 命名、desktop/patent/self-evolve 表面与 fork 的 CI 布局全部保留；工作区内 `dsh` 包版本统一为 `0.1.1-rc.1`。上游的 timeout-policy FIXME（"在首个 tagged release 前定夺 dsh-timeout-guard 改名"）仍开放；fork 保留自己的决策，在上游采纳该改名之前，上游每次改动该包都会再次产生冲突。

## 曾考虑的替代方案

- **撤销 fork 的 `dsh-timeout-guard` 改名以跟随上游**：拒绝——fork 是刻意决策（角色命名优于机制命名）并已随附 Agent Note；上游自己的 FIXME 也把该改名称为 "intended"。
- **从零翻译重新生成的目录**：拒绝——上游 rc.1 自带完整中文对侧；fork 以上游中文版为基底重建，再补 fork 独有段落。
- **运行 fork 改编后的 issue workflow**：拒绝——fork 的免费版 CI 布局只运行 `ci-fork.yml`；上游 workflow 保持归档。
