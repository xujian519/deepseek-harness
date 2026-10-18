---
kind: upgrade-guide
description: "用已归档团队的名字新建团队会被拒绝，避免后续归档覆盖上一代记录。"
---

# 已归档的 PatentTeams 团队名保持占用

[English](guide.md) | 中文

## 变更

`patent_teams_create` 过去允许在团队归档后复用其名字。再次删除新团队时会替换 `archive/<teamId>`，静默销毁上一代归档。现在该调用返回 `TEAM_NAME_ARCHIVED`，并保留已有归档。受影响的是在 `patent_teams_delete` 之后复用团队名的队长；归档团队仍可通过 `patent_teams_archive` 读取。

## 迁移

1. 为新案件选择新的团队名。同一状态根下，已归档团队的名字不再可用。
2. 选择新名前，通过 `patent_teams_archive` 读取旧记录；它是上一轮复盘的保留来源。
3. 确认：用已归档名字调用 `patent_teams_create` 返回 `TEAM_NAME_ARCHIVED`，且 `patent_teams_archive` 仍列出早先的团队。
