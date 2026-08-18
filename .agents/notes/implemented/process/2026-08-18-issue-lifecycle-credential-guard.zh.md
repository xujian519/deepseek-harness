# Agent Note: Issue lifecycle 凭据守卫

Status: implemented

[English](2026-08-18-issue-lifecycle-credential-guard.md) | 中文

## 问题

[Issue lifecycle](../../../../.github/workflows/issue-lifecycle.yml) 作业使用 GitHub App token 写入 ProjectV2 状态与 issue 审计评论。它从 `vars.DSH_ISSUE_APP_CLIENT_ID` 和 `secrets.DSH_ISSUE_APP_PRIVATE_KEY` 读取 App 的 client ID 与私钥。当这些值缺失时——例如在未安装同一 App 的 fork 上——`actions/create-github-app-token` 会在任何生命周期逻辑执行前失败，导致每个 Issue 与 pull-request 事件都触发一次 CI 失败。

[由事件直接指定的 PR 评审状态命令](../../../../.agents/notes/implemented/process/2026-08-10-event-directed-pr-review-status.md) 假设 App token 可用，但并未说明如何提供或检测它。

## 决策

`lifecycle` 作业现在在 client ID 或私钥为空时直接跳过自身。该守卫位于作业级 `if`，在 checkout 步骤之前求值，因此工作流不会尝试创建 token 就直接成功返回。原有的 `pull_request_review.submitted` 且 `changes_requested` 的事件过滤条件仍嵌套在凭据守卫之内，行为不变。

## 考虑过的替代方案

**以更清晰的错误消息失败。** 可以用独立步骤检测缺失的凭据并输出可读注解，但这仍会把 fork 上的每次事件驱动运行标记为失败。凭据变量是仓库级配置，不是代码缺陷，因此对可复用工作流来说，大声失败并非正确默认。

**使用 `GITHUB_TOKEN` 作为回退。** 默认 token 缺少生命周期脚本所需的组织 ProjectV2 与跨仓库权限，提升其权限会扩大所有 fork 的爆炸半径。继续以 GitHub App 作为唯一写入路径，保持了最小权限设计。

**仅把守卫放在 `Create project token` 步骤。** 这样作业会在没有可用 token 的情况下继续运行，并迫使后续每个步骤都判断 token 是否存在。作业级跳过让工作流更易读，也避免了部分执行的歧义。

## 后果

未配置 `DSH_ISSUE_APP_CLIENT_ID` / `DSH_ISSUE_APP_PRIVATE_KEY` 的 fork 与仓库不会再看到 Issue lifecycle 运行失败；它们只是不执行生命周期自动化。主仓库仍需配置这两个值，否则预期的自动化会被静默禁用。该守卫由 [工作流测试](../../../../scripts/ci-workflow.spec.ts) 锁定，防止未来误删。
