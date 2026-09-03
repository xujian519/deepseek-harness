# Agent Note: 工作台案件桥接（workbench_link_patent_case）

Status: implemented

[English](2026-09-03-workbench-case-bridge.md) | 中文

## Problem

专利工作台（patent preset + `packages/patent/*`）没有任务/日历作业面，而独立挂载的个人工作台插件（`@dely0/dsh-personal-workbench`）基于自己的 `case.db` 拥有一套成熟的作业面。把专利案件接进去需要对工作台数据的写权，但外部包不导出数据层（exports 仅 `.` / `./client` / `./package.json`）且宿主半不提供 Cordis 服务——import 其内部或直开其 SQLite 都会在插件之外造成第二个写者；同时案件审计链（`_matter-log.md`，唯一事实源）绝不能从任务侧变得可写。

## Decision

- `@deepseek-ai/dsh-patent-tools` 注册第 27 个模型工具 `workbench_link_patent_case`：幂等桥接，只经工作台的 loopback HTTP API（`/api/workbench/*`）写任务。基址解析顺序：Config `workbenchBaseUrl` → 进程内 `webServer` 服务端口（web 组合）→ 都不可用时执行期以 `setup_required` 失败（非 web profile 无工作台可言）。
- 桥接幂等确保六个 `type` 字典项（`patent_case`、`patent_stage_l1..l5`，经 `POST /api/workbench/dictionaries`），找到或创建根任务（标题=案号、`source='patent'`、`workspace_path`=案件目录）与 L1–L5 五个阶段子任务，并把阶段进展投影为子任务状态。全部幂等：find-or-create、状态有变才 PATCH。
- 投影单向：`_matter-log.md` → 任务状态。解析是行级启发式：一行同时含 `\bL[1-5]\b` 与完成词（完成/通过/✅/已交付/归档）记 `done`、进行词（进行/开始/推进/启动）记 `doing`，后行覆盖前行；显式 `stages` 入参优先于启发式。反向（工作台→案件文件）不实现；工具不写案件目录任何文件。
- 根任务状态永不 PATCH：工作台的状态 PATCH 会级联完成未完成子任务，bridge 只 PATCH 阶段子任务，根任务保持不动。
- `tasks.source='patent'` 标记桥接任务：该列是自由文本、非字典校验，无需上游改动即可与 `manual` / `nl` / `recurring` 并列。
- 提示词分工（一处一事实）：插件注入的指南段保留工作台通用协作规则（草稿确认、验收闭环、共享记忆、排程提案——`announceToAgent` 保持开，standard 会话也有引导）；patent preset persona 新增「个人工作台协作」小节只承载专利增量——桥接用法、`_matter-log.md` 唯一事实源、反向不写。

## Alternatives considered

- 把两段提示词合并成一份：机械合并会让 standard 会话失去工作台引导，且复述插件规则——按一处一事实原则放弃。
- `agent/status` idle 自动 pull（设计文档的第二个触发器）：需要会话事件接线加 `task_sessions` 绑定查询，收益低于成本——唯一触发器是工具调用本身（pull 模型）；设计文档已标注为待办。
- import 外部包数据层或直写其 SQLite：exports 面与缺失的 `ctx.provide` 使两者都是第二账本隐患——HTTP 路径保持唯一写者（跑插件的 `dsh web` 宿主）。

## Consequences

- `case.db` 永远只有一个写进程（web 宿主）；bridge 只是又一个 API 客户端，上游只要保持 HTTP 面不变，升级不会使 bridge 失步。
- 案件进度只在有人（按 persona 指引的模型）调用桥接后才出现在工作台 UI；工作台不会自行感知案件目录变化。
- patent-tools 新增对 `@deepseek-ai/dsh-host-webserver` 的 peer/dev 依赖（`webServer` 服务声明合并所需）。

## Testing

- 单测（`packages/patent/patent-tools/tests/workbench-link-patent-case.spec.ts`，15 例）：启发式解析（last-wins、一行多阶段、无匹配）；内存 workbench 模拟器覆盖首次链接、幂等重链、进度 pull、显式覆盖、dryRun 零写、案件目录只读、fail-closed（空案号 `invalid_tool_input`、缺基址 `setup_required`、HTTP 失败与 wire 畸形 `tool_execution_failed`）。`registration.spec.ts` 更新为精确 27 工具断言。
- `web-wb` profile 真环境端到端（真实插件 + 真实 `~/.dsh/workbench/case.db`）：新案号建根 + 五阶段且投影落库（L1=done、L2=doing），重链零写，工作台 UI 任务树展开案件行后呈现阶段与状态。全程记录于 `docs/dsh-workbench-integration-design.md` 的 Phase 5 验收清单。
