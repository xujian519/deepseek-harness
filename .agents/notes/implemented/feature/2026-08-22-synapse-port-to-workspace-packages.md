# Synapse 会话地图插件复刻：宿主/客户端双包接入 web profile

**Date:** 2026-08-22

**Status:** implemented

## Context

用户要求把独立 Web 插件 dsh-synapse（非线会话地图：把同一工作区的会话、追问与分支变成可浏览画布）复刻进本仓库，并基于实际使用/测试做优化。上游插件（liangmianya/dsh-synapse v0.3.0）是纯 JS 单包：函数插件 synapse（inject webServer/sessions）+ window.__ModuleLoader__ 客户端插件 + 静态 app.js/styles.css，通过 profile patch 注入 web 组合。

## Decision

复刻为两个一等工作区包，而不是整包搬运，因为本仓库的编译面划分（tsconfig.client.json / tsconfig.host.json）不允许一个 packages/client/* 包同时编译宿主侧会话代码：

1. packages/web/synapse（@deepseek-ai/dsh-host-synapse）——宿主半侧：/synapse 页面 + 静态资源 + /synapse/api JSON API + WorkspaceStore 投影（v1–v4 迁移、跨进程写锁、800ms 防抖合并保存），注入 webServer/sessions，订阅 session/created 与 session/event 并回放 ctx.sessions.list()。
2. packages/client/synapse（@deepseek-ai/dsh-client-synapse）——浏览器半侧：dsh.client 行，注入客户端 sessions/workspaces 服务；渲染 对话/会话地图 切换 + /synapse/ iframe，桥接 create/fork/send/open/activate/live-reply/theme。节点半侧为空 Loader 入口。

画布 UI（app.js/styles.css）原样静态托管为包资产（iframe 内自足，不进入 React 栈）。配置保持上游语义：dataFile（默认 dshHomePath('synapse/workspaces.json')）、autoProjection、projectionWorkspaceTitle、trustedHosts（Host 头 DNS 加固，loopback 默认放行）。

接入面：web-app cordis.patch.yml 两行（host 行 synapse、client 行 synapse-client——同一 id 会被补丁按 id 覆盖所以必须不同）、web-app package.json 依赖、tsconfig.host.json/tsconfig.client.json 引用、pnpm lockfile。

## Adaptations (live-test findings, 2026-08-22)

- **画布基线来自 SessionPersistence（revision 键），不是 live SessionStore**：本仓库 web 宿主对恢复的会话保持冷态（session.list 是持久化读取；live store 只含已挂载会话），上游的 ctx.sessions.list() 基线在启动时为空。replayPersistedBaseline 用 sessionPersistence.listSnapshots()+inspect()，按 revision 去重，启动时 + 2s 容错重扫 + 浏览器 syncSessions 时刷新。
- **回放起点规则**：fork 子会话跳过持久化日志中的种子前缀（最后一个 session/end-seed 之后的 live 段）；根会话的 end-seed 只是持久化快照边界，回放 0 起。
- **投影只收人类提问**：user/message 事件带 source.kind，agent-instructions / plugin(dsh-system-prompt) / skill-catalog 等注入被过滤；缺失 source 的旧日志按人类处理；runtime-context 前缀过滤保留为兼容。
- 空会话（无 user/message）不进画布（与浏览器行同步的 blank 跳过一致）。

- session.title / session.blank 在本仓库不在 Session 上：标题从最后一个 session/title 事件折叠（sessionTitle/sessionTitleOf），blank 从无 user/message 推导；fork lineage 用 header.parentSession/header.seedLength（firstLiveSeq 同理）。
- 新会话创建改用客户端工作区流转：ctx.workspaces.startSession（空白会话复用）+ 当前会话监听，替代 sessions.create（不在 ISessions 契约上）。
- session/event 事件 key 由 dsh-session 核心类型合并（session/title 等由 session-title 声明合并），投影代码用宽松读取 + 边界校验。
- client 服务名 sessions/workspaces（client runtime），宿主侧 sessions（SessionStore）分别注入。

## Consequences

- 行为与上游一致：投影去重（sourceSeq）、工具过程按 callId 折叠、fork 竞态单节点、归档隐藏、画布归档不删 DSH 会话。
- 两处诚实适配：新会话首条消息依赖 startSession 后的当前会话流转；v3 迁移工具卡片按顺序配对（上游同）。
- 已知限制写入两个包 README：地图 UI 是静态脚本不受快照门禁、单实例写锁、iframe 内不含主题令牌。

## Validation

- 单包 tsc 干净；pnpm run typecheck（两个聚合）待跑。
- vitest：host 包 23 例（store/projection/assets vm 切片/apply API），client 包 5 例（jsdom 冒烟）。
- 第二轮（2026-08-22 续）：详情视图接入真实 session history——宿主新增 GET /synapse/api/sessions/<id>/history（projectHistory 纯函数：全文不截断、工具过程折叠、注入上下文标 kind 'context'，数据源 SessionPersistence.inspect），画布 app.js 实现 loadThreadHistory 并优先渲染历史，threadMessage 增加 '上下文' 标签；双实例冲突从'警告后覆盖'升级为'重载磁盘 + 告警 + 丢弃本地增量'（save 前 mtime 校验；投影可重建、手动布局是损失）。实机验证：history API 返回 7 条完整消息（含 3 条 context 注入），浏览器详情视图标签 你/上下文/错误 正确。