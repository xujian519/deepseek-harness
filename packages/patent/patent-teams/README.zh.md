---
description: "面向专利工作流的持久多智能体团队：一个由可续聊子代理组成的队长领导团队，配依赖感知任务、邮箱消息与事件驱动共享任务调度器。上游 `@nanmicoder/dsh-agent-teams` 插件的正式工作区移植版，重新定位于专利域（`patent_teams_*` 工具、`.patent-teams/` 状态目录、`patent-teams/*` 会话事件），并成形为服务定义（`ctx.patentTeams`），工具为其唯一 Consumer。"
kind: "package-reference"
---

# dsh-patent-teams

[English](README.md) | 中文

## 概述

面向专利工作流的持久多智能体团队：一个由可续聊子代理组成的队长领导团队，配依赖感知任务、邮箱消息与事件驱动共享任务调度器。上游 `@nanmicoder/dsh-agent-teams` 插件的正式工作区移植版，重新定位于专利域（`patent_teams_*` 工具、`.patent-teams/` 状态目录、`patent-teams/*` 会话事件），并成形为服务定义（`ctx.patentTeams`），工具为其唯一 Consumer。

## 目录

- [挂载内容](#what-it-mounts)
- [配置](#configuration)
- [状态模型](#state-model)
- [会话事件](#session-events)
- [Model Experience](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)

<a id="what-it-mounts"></a>
## 挂载内容

- `ctx.patentTeams` — `PatentTeamsService`：团队增删改查、带 attempt 撤销的任务状态机、成员生命周期（spawn/interrupt/retire）、邮箱持久化、删除时归档、调度器 kick。
- 十一个 `patent_teams_*` 工具：`create`、`add_member`、`remove_member`、`create_task`、`reassign_task`、`claim_task`、`update_task`、`send_message`、`status`、`archive`、`delete`。
- 一段系统提示用法段落（`patent-teams:usage`，默认 order 117），教授队长协议。

<a id="configuration"></a>
## 配置

```yaml
- id: patent-teams
  config:
    stateDir: .patent-teams      # team state root under the captain's workspace
    memberProvider: spawn        # ctx.subagents provider (continuable + persona + toolFilter)
    memberModel: deepseek-v4     # optional model override for every member
    memberMaxDepth: 1            # member delegation depth cap (0 forbids delegation)
    maxMembers: 8                # team size cap
    promptSectionOrder: 117      # usage-section order
```

<a id="state-model"></a>
## 状态模型

团队状态存放于 `<workspace>/<stateDir>/<teamId>/`：

- `team.json` — 持久 `TeamState` 记录（成员、任务、任务序号）。
- `inbox/<agentKey>.jsonl` — 每代理一个 JSONL 邮箱（`captain` 或成员名）。

团队记录的变更在进程内按团队锁内执行并以原子方式持久化（同目录临时文件 + rename，Windows `EPERM` 时退化为直接写回）；信箱追加为单行 `O_APPEND` 写入，`add_member` 在锁外解析成员路由并启动子代理（状态准入与持久化仍在锁内复验），单次 spawn 不会阻塞团队的其他工具。任务状态转换由 `TASK_TRANSITIONS` 校验；每次认领携带 `attempt_id` 能力，重试/转派后即失效，迟到的成员更新会被拒绝。`patent_teams_delete` 将团队目录归档到 `archive/` 而非删除，保留任务与邮箱供后续复查；`patent_teams_archive` 只读地读回归档（工作区级列表 + 单团队详情）。

<a id="session-events"></a>
## 会话事件

每次状态变更都会向队长会话追加一条 `patent-teams/*` 事件（类型与载荷见 `event-types.ts`）：`team-created`、`member-added`、`member-removed`、`task-created`、`task-updated`、`message-sent`、`team-deleted`。包的 invariant 伴随插件在加载与追加时校验每个载荷。

<a id="model-experience"></a>
## Model Experience

### 请求上下文与条件

#### 模型所见

插件挂载时，用法段落是固定的系统提示贡献，另加[工具目录](../../../docs/tool-catalog.zh.md)中的十一个工具 schema。

##### 本字段逐字文本（如需）

```markdown
When the user asks to run something with PatentTeams (e.g. "use PatentTeams to do X"), you are the captain of a multi-agent team. Follow this protocol:
1. Call patent_teams_create with a team name and the goal as description. You become the captain and may lead one team at a time.
2. Call patent_teams_add_member once per role the goal needs (researcher, engineer, reviewer, ...). Members are durable subagents: they wait for your messages, then work a full turn. By default a member on your current provider/model snapshots your current reasoning effort; a member routed to a different provider or model automatically uses that target model's default effort. Never ask the user to choose these per member; only pass provider/model when the user explicitly requests a different route for that role, and reasoning_effort only when the user explicitly requests a particular effort ("default" explicitly selects the target model's default).
3. Break the goal into tasks with patent_teams_create_task and wire dependencies. Assign role-specific work when useful; unassigned ready work belongs to the shared pool. The scheduler automatically claims one ready task for each truly idle member and wakes it, including across later rounds.
4. Lead by delegation: monitor with patent_teams_status, send guidance with patent_teams_send_message, and let idle teammates execute ready work. Do not duplicate a teammate's work merely because its turn is slow.
5. If work is blocked, stale, or needs takeover, always call patent_teams_reassign_task first. Reassign to another idle member, or use assignee=captain before doing it yourself. Reassignment revokes the old attempt and waits for that member to quiesce, preventing late results from overwriting the new attempt.
6. Tasks carry attempt_id capabilities. Members must use the current attempt_id for updates; stale-attempt errors mean ownership changed. Poll status until every required task is terminal and every member is idle/ready.
7. Present the team's results to the user, then patent_teams_delete the team unless the user wants to keep working with it. Deleted teams stay reviewable read-only through patent_teams_archive.

Tools: patent_teams_create, patent_teams_add_member, patent_teams_remove_member, patent_teams_create_task, patent_teams_reassign_task, patent_teams_claim_task, patent_teams_update_task, patent_teams_send_message, patent_teams_status, patent_teams_archive, patent_teams_delete
```

#### Token 影响

固定：一个用法段落（约 2.4 KB）加十一个工具 schema。数据相关部分（团队状态载荷、任务指派提示、成员报告）有界：状态渲染最多 10 条邮箱警告，任务输出在状态与归档渲染中截断至 300 字符，收件箱预览 200。

#### KV Cache 影响

前缀稳定：用法段落对给定挂载恒定，不使系统提示前缀失效。会话事件与团队状态从不进入提示；仅按需以工具结果形式进入。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

- **Web UI 为独立投影** — 上游插件的活动面板与美术资源路由未移植；`dsh-client-ui-patent-teams` 将 `patent-teams/*` 会话事件折叠为对话卡片与"团队"视图，磁盘文件与 `patent_teams_status` 仍是权威查看路径。
- **单进程串行** — 状态为文件持久化，在单个 DSH 进程内串行操作；多进程同时修改同一团队不保证一致。成员状态观察者维护进程内成员索引（由 `add_member`、`remove_member`、`delete` 维护），无关代理的状态事件不再触发状态目录全量扫描。
- **一队长一活跃团队** — 队长须先结束当前团队才能创建新团队。
- **实时投递尽力而为** — 接收方代理离线时消息留存在邮箱，在下一状态边界重试。

### 开发备注

无。
