# Agent Note：把 PatentTeams 监视面重建为对话卡片与固定"团队"视图

Status: implemented

[English](2026-08-27-patent-teams-ui-panel.md) | 中文

## 问题

从上游 `@nanmicoder/dsh-agent-teams` 插件移植 `dsh-patent-teams` 时有意丢弃了上游 Web 活动面板（v1 仅工具 + 服务），桌面 app——渲染的是 web-app bundle 的 UI——因此失去了多代理专利协作的唯一窗口。上游面板是 body-portal 浮层，每秒轮询一个 host 快照路由，聊天卡片还有一条独立的 1.5s 轮询；两者都绕过 slot 系统，因为上游 shell 没有角落座位。

## 决策

按仓库的持久重放路径重建监视面，而不是移植轮询架构。`patent-teams/*` 事件早已进入生成的会话词汇表，且（经本栈伴随修复）以 ignorable 信息记录落盘；`event-types.ts` 本就是为浏览器程序预留的零导入类型面。新包 `dsh-client-ui-patent-teams` 注册两个跑同一 reducer（`teams-model.ts`）的 `ConversationNodeDefinition`——一个 target `chat`（keyed `patent-teams` 卡片，即 `ui-workflow-run` 模式），一个 target `patentTeams` 视图源——再加一个 `ConversationViewDefinition`，其按会话隔离的 builder 保持团队创建顺序。固定入口是 `conversation.view` 的 list entry（`id: 'teams'`，order 30），因此每个会话视图——包括经 web roster 自动继承的桌面端——都带着这个 tab，无团队时显示空态。成员实时活跃复用普通会话列表 share，导航证明与 workflow-run 面板一致；零新增 host 面、零轮询、零 portal。

## 备选方案

**移植上游面板形态（角落浮层 + state 路由 + 轮询）。** 否决：fork 已持久化这些事件，Conversation Node 折叠跨重启确定收敛而轮询循环不是；body-portal/`<html data-*>` 礼让 hack 只因上游 shell 缺 slot 而存在——我们没有这个问题。

**`shell.overlay` 角落面板。** 推迟：数据按 captain 会话归属，会话内 tab + 流内卡片保持所有权模型简单；全局角落聚合器需要先有跨会话 host 查询。

**在本 PR 做 keyed `patent_teams_*` toolview。** 调研后放弃：已发布工具行在 `ui-tool` 内部（chrome 不跨包复用），相对流内团队卡片这四个工具的边际价值有限，status 工具的开放 schema 结果会迫使脆弱解析。已在包 README 记为后续工作。

**团队创建时自动切到"团队"tab。** 放弃：会话服务没有按会话读取快照的接口来做切换门控，触发器要么在无团队会话误触发，要么需要新的服务面。

## 后果

聊天流为每个团队显示一张持久卡片（成员、任务、裁决、进度、解散态），"团队"tab 会话级展示同一折叠，两者重启后从日志恢复。后到的有效契约裁决会清除先前的降级字段。桌面 app 零改动。测试：经真实 assembler 的折叠/生命周期 spec、jsdom 组件 spec、以及向会话日志种入事件族的 keyless web e2e（`apps/web/tests/patent-teams-panel.e2e.ts`），对两个面分别快照。
