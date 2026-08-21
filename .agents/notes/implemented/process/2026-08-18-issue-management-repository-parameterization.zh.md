# Agent Note: Issue management 仓库参数化

Status: implemented

[English](2026-08-18-issue-management-repository-parameterization.md) | 中文

## 问题

[Issue lifecycle](../../../../.github/workflows-disabled/issue-lifecycle.yml) 工作流与 [Issue policy](../../../../.github/workflows-disabled/issue-policy.yml) 工作流都委托 [policy.mjs](../../../../.github/issue-management/policy.mjs) 执行。此前：

- `issue-lifecycle.yml` 在创建 GitHub App token 时硬编码了 `owner: deepseek-harness` 和 `repositories: deepseek-harness`。
- `policy.mjs` 通过 [config.json](../../../../.github/issue-management/config.json) 硬编码了仓库的 owner 和 name。

这导致即使 fork 配置了同一个 App，token 和 API 调用仍然会指向上游仓库，进而在 fork 上触发 404 失败，使 issue-management 自动化无法移植。

## 决策

从 `GITHUB_REPOSITORY` 环境变量（格式 `owner/repo`）读取仓库身份，用于所有 REST API 调用、GraphQL issue 查询以及 issue/PR 引用解析。`config.json` 仅作为 GitHub Project 组织（`projectOrganization`）和项目编号的来源，因为 Project 是 lifecycle 自动化写入的独立组织级资源。

`issue-lifecycle.yml` 现在把 `github.repository_owner` 和 `github.event.repository.name` 传给 `actions/create-github-app-token`，token 的作用域变为当前仓库而非上游仓库。

## 备选方案

**完全移除 `config.json`。** 项目编号、标题、优先级字段、lifecycle actor 和 statuses 仍需要共享配置文件。保留 `config.json` 并新增 `projectOrganization`，可以显式区分仓库与 Project。

**在 `policy.mjs` 中全部使用 `github.repository`。** 这在 Actions 中可行，但在本地测试或手动运行时 `GITHUB_REPOSITORY` 不存在。回退到 `config.organization`/`config.repository` 保留了在 Actions 外部运行脚本的能力。

**仅在 fork 中拆分 GraphQL 变量。** 为 fork 检测增加条件逻辑会让脚本依赖 `GITHUB_REPOSITORY_OWNER` 比较，测试更困难。使用独立的 `$projectOrganization`、`$repoOwner` 和 `$repoName` 变量是无条件的，且自解释。

## 影响

Issue management 脚本现在跟随其运行的仓库。主仓库（`deepseek-harness/deepseek-harness`）仍使用自己的 Project，因为 `projectOrganization` 仍指向 `deepseek-harness`。安装同一个 App 的 fork 不再需要修改源码来指向自己的 issues 和 pull requests；它们只需要满足或关闭 [Issue lifecycle credential guard](2026-08-18-issue-lifecycle-credential-guard.zh.md) 中的 credential guard。
