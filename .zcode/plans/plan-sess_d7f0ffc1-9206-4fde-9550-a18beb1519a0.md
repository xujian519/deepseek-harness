# 专利团队 UI 复活方案：对话卡片 + 固定"团队"Tab

## 背景与已定决策

- 桌面 app 看不到专利团队 UI 的原因：`dsh-patent-teams` 从上游 `@nanmicoder/dsh-agent-teams` 移植时有意不移植 Web 面板（`b26ce980a1`），README 明言 "No Web UI"。
- 调研关键发现：**9 种 `patent-teams/*` 会话事件已在 fork 词汇表内并已落盘**（生成器自动扫描 `packages/*/*/src`）；`Session.append` 的 `ignorable: true` 写入面已存在（`012e897ace`）；仓库已有完美模板 **ui-workflow-run**（把 `tool-workflow/*` 事件折叠成对话流卡片的 Conversation Node 机制），且 [event-types.ts](packages/patent/patent-teams/src/event-types.ts) 头注释本来就是为 browser program 预留的零导入类型面。
- 用户已定：UI 形态 = **对话流卡片 + 会话内固定"团队"tab + 精简 toolview**（全走既有 slot/折叠机制，零新增 host 面）；泛化另立方案，本方案命名 `ui-patent-teams`（诚实反映折叠的是 `patent-teams/*` 事件）。
- 数据流选择：放弃上游的"磁盘真相 → host state 路由 → 1s 轮询"三层，改走仓库正道——**会话事件确定性折叠**（与 tool-workflow 同机制）。事件 payload 已覆盖面板所需全部信息（成员含 `memberId` 可跳子会话、任务含依赖/状态/校验裁决、消息含收发方）；成员实时 running/idle 状态复用既有 `subagentsByParent` 镜像（`api.subagents.list` RPC 已存在）。

## PR 1 — fix(patent-teams)：事件无条件 ignorable 写入（小，先行）

**文件**：[packages/patent/patent-teams/src/events.ts](packages/patent/patent-teams/src/events.ts)

- 删除 `KNOWN_SESSION_EVENT_TYPES` 运行时探测、`skippedEventTypes` set、`import * as dshSession`；`appendTeamEvent` 改为无条件 `session.append(type, data, { ignorable: true })`（try/warn 保留）。
- 语义依据：磁盘状态是团队真相源，会话事件是纯信息性记录，正是 `ignorable` 的设计对象；同时覆盖"作为发布插件装在 upstream harness"的场景（读取侧对未知类型 + `ignorable` 放行）。fork 内行为不变（现在就落盘）。
- 同步改写 `tests/events.spec.ts`（现 spec 靠"从 live set 移除类型"模拟旧 harness，改后直接断言 `event.ignorable === true` 与读取侧接受）与 events.ts 头部 JSDoc（删除"在等 writer surface"的过时表述）。
- 短 Agent Note（bug-fix 类，说明为何 ignorable 正确）。

## PR 2 — feat(client)：新包 `@deepseek-ai/dsh-client-ui-patent-teams`

### 包结构（`packages/client/ui-patent-teams/`，照 ui-jobs/ui-workflow-run 模板）

| 文件 | 内容 |
|---|---|
| `package.json` | exports `.`/`./invariant`/`./client`/`./src/*`/`./package.json`；`dsh.client`: `{ inject: [dsh-client-runtime, dsh-client-locale, dsh-client-ui-conversation, dsh-client-ui-primitives], platform: 'web' }`；peer+dev 依赖按 client 包规则；`dsh-patent-teams` 仅 devDependencies（type-only 事件 payload，经 `./src/event-types.ts` 引入，不进 bundle） |
| `tsconfig.json` / `tsdown.config.ts` | extends `tsconfig.base.client.json` + 各 workspace references；`clientBundle('@deepseek-ai/dsh-client-ui-patent-teams', [...])` |
| `src/index.ts` / `src/invariant.ts` | 空 node-half apply；invariant companion |
| `src/client/teams-model.ts` | **纯函数折叠核心**（无 React）：`TeamRecord` 状态 + 9 种事件的 reducer + `projectCard`/`projectView` 投影（成员、任务状态/依赖/校验徽章、进度 x/y、消息计数）。仿上游 `activity-model.ts` 的纯函数分层 |
| `src/client/teams-definition.ts` | `ConversationNodeDefinition`：kind `'patent-teams'`、target `'chat'`、match 9 种事件 → `{id: teamId, start: team-created}`，fold 复用 teams-model；`ChatNodeDataMap` 声明合并 `'patent-teams'`（照 [workflow-definition.ts](packages/client/ui-workflow-run/src/client/workflow-definition.ts)） |
| `src/client/TeamsCard.tsx` | 对话流卡片渲染器：团队名 + 成员 chip（点击 `sessions.open(memberId)` 跳成员子会话）+ 进度摘要 + 终态徽章；视觉对齐 WorkflowRunPanel，token-only CSS Modules |
| `src/client/teams-view.ts` | `ConversationViewDefinition`：target `'patentTeams'` + `ConversationViewSnapshotMap` 声明合并（照 [document-deliverables.ts](packages/client/ui-document-studio/src/client/document-deliverables.ts) 的 builder 模式） |
| `src/client/TeamsView.tsx` | 固定 tab 面板：当前会话的团队区块（成员实时状态 = `useSessions(subagentsByParent[sessionId])` + 挂载/可见期间 `sessions.refreshSubagents` 刷新；任务列表带依赖/状态/validated·gated 徽章）；无团队时空态 |
| `src/client/toolviews.tsx` | `tool.call.toolview` keyed 注册 4 个高信号工具的紧凑行：`patent_teams_status`/`create`/`create_task`/`update_task`（其余留 GenericToolCard） |
| `src/client/locales.ts` | zh 为 key 集 source of truth + en；`LocaleNamespaceMap` 合并 `'patentTeams'`；产品文案中文 |
| `src/client/index.ts` | apply：locale.register + conversationEvents.register + conversationViews.register + `slots.inject('conversation.chat.node', key: 'patent-teams')` + `slots.inject('conversation.view', { id: 'teams', order: 30, label })`（trajectory=10、document=20 之后）+ 4 个 toolview inject；含 patent preset 会话有团队时自动切到团队 tab（复用 document-studio 的 retry 窗口模式） |
| `tests/` | teams-model 纯函数 spec（全事件序列、多团队、member-removed、delete 归档终态）+ browser-plugin halves spec（真 SlotRegistry、dispose 清理、字典 parity）+ TeamsCard/TeamsView jsdom spec（role/aria） |

### 接线（3 处，缺一不可）

1. `packages/bundle/web-app/cordis.patch.yml` browser roster 加 `- id: ui-patent-teams / name: '@deepseek-ai/dsh-client-ui-patent-teams'`（带一行数据源注释，照 ui-jobs 格式）
2. `packages/bundle/web-app/package.json` 加 workspace 依赖
3. `tsconfig.client.json` 加 references

桌面 app **零改动**自动继承（desktop 层只 patch web 层）。

### 快照与文档（仓库硬性要求）

- `apps/web/tests/patent-teams-panel.e2e.ts`：`launchWebScaffold` + 直接向 session log 种入脚本化的 `patent-teams/*` 事件序列（无需挂 host 插件——事件在词汇表内，折叠纯客户端），`captureStableAria` 抓卡片 + tab + 空态，golden 于 `snapshots/patent-teams-panel/*.expected.md`（keyless）。
- 包 README 三件套（含 Model Experience + Known Limitations 节，过 `verify-package-readme-limitations`）。
- Agent Note：`implemented/feature/2026-08-27-patent-teams-ui-panel`（覆盖两个 PR：为何事件折叠而非上游轮询、为何 ignorable、固定入口选型）。

## 检查（focused，按 dsh-pre-push-checks）

两个包的 vitest → `pnpm --filter @deepseek-ai/dsh-client-ui-patent-teams bundle` → `DSH_SNAPSHOT=replay pnpm run test:web`（-t 过滤新用例）→ `pnpm run doc-sync` → typecheck/lint → workspace constraints。不跑全量。

## 范围外（另立方案）

- 泛化：晋升 `experimental/agent-team` 骨架、patent-workflow/tools 耦合抽成可选 hook、事件改名——UI 落地后做；本包的折叠定义届时机械跟改。
- 跨会话/应用级团队聚合页（需新 host RPC）、上游式任务 DAG 可视化（可作为 TeamsView 后续增强）。

## 风险与对策

- **实时状态刷新**：`subagentsByParent` 镜像由 ui-subagent 的菜单打开驱动刷新；TeamsView 在挂载/可见期间主动 `refreshSubagents`（有界节流），v1 接受。
- **bundle 纯度门禁**：patent-teams 类型必须 type-only import（value import 会构建报错）。
- **事件覆盖**：`events.ts` 契约"每次团队状态变更都 append"；折叠反映工具驱动的真相，磁盘仍是权威源（不变）。

PR 栈：PR1 ← PR2（PR2 包含 PR1 的 events 改动依赖）。