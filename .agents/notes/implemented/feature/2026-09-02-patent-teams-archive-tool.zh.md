# Agent Note：可查询的团队归档与 state 辅助函数清理

Status: implemented

[English](2026-09-02-patent-teams-archive-tool.md) | 中文

## 问题

`patent_teams_delete` 把团队目录归档到 `archive/` 并声称"供后续复查"，但没有任何途径能读回归档：`readArchivedTeam` 与 `listArchivedTeamIds` 没有运行时消费者。`state.ts` 中另有四个死辅助函数：`readTeamSync` 的唯一调用方在 v0.1.2-alpha.4 同步中随成员路由迁入创建请求的持久描述符而消失；`removeTeamDir` 被"删除即归档"语义取代；`taskVisualState`/`taskDepthsById` 投影的是客户端移植时刻意未实现的上游活动面板。

## 决策

- 用第十一个只读工具 `patent_teams_archive` 闭合归档回路：不带参数时列出调用者工作区的全部归档团队（id、名称、成员与任务计数）；带 `team_id` 时返回该团队归档后的成员与任务。任何调用 agent 都可读取（归档按工作区限定）；读取不改任何状态，因此不追加会话事件；渲染与 `patent_teams_status` 一致地把任务输出截断至 300 字符。
- 删除四个死辅助函数及其测试。原先借助 `removeTeamDir` 模拟团队消失的测试夹具改为直接调用 `node:fs/promises` 的 `rm`。
- 船长用法段落补充该工具名，并说明已删除团队仍可只读复查。

## 备选方案

**连归档读取函数一并删除，降级 README 承诺。** 否决：删除即归档已被文档化并由 `patent_teams_delete` 渲染；在两个现成函数之上补一条读取缝，比撤回已发布的承诺代价更小。

**通过 `patent_teams_status` 暴露归档。** 否决：status 以活跃团队的参与者为授权范围；归档团队没有参与者，该查询本来就需要另一条授权路径。

**Web UI 归档浏览器。** 随既有的跨会话聚合限制一并推迟：它需要新的宿主查询面，而工具现在就能满足复查需求。

## 后果

- `patent_teams_*` 工具增至十一个；生成的工具目录、双语 README、用法段落逐字文本同步更新，并为 `docs/tool-catalog` 与包 README 重录配对哈希。
- 固定用法段落增至约 2.4 KB；README 此前声称的 0.9 KB 对应的已是更长的文本，现在数字与实测一致。
- 归档团队记录不含删除时间戳；归档行只报告 `created_at` 一个时间戳。
- 目前尚无任何 `patent_teams_*` 工具的录制会话快照；本次变更由包内测试覆盖，继承这一已知缺口而非补录首个用例。

## 测试

包内 `vitest run` 全绿（287 个测试）：`service.spec.ts` 新增归档用例（列表、详情、未知 id、空工作区），`tools.spec.ts` 新增工具路由与渲染用例，`index.spec.ts` 与 `loader-composition.spec.ts` 更新工具清单；`gen-tool-catalog` 重新生成双语目录并重录配对哈希。
