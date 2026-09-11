# Agent Note: Remount the workspace sidebar on desktop

Status: implemented

[English](2026-09-10-desktop-workspace-sidebar-remount.md) | 中文

## Problem

桌面组合整体不挂载 `@deepseek-ai/dsh-better-sidebar`，因此桌面 App 既没有底部面板也没有右侧工作台（[理由](../../archived/architecture/2026-09-10-desktop-without-workspace-sidebar.md)）。想要这块工作台的部署会把该行加回来。

只把行加回来并不会得到可用的工作台。只要有任何组合在 Chromium 浏览器里挂载它，侧边栏无端口传输的两个潜在缺陷就会立刻显形：

- `TerminalView` 用 `fetch(url, { method: 'POST', body: <ReadableStream> })` 发起终端双工请求。Chromium 对「请求体是流」的请求强制要求声明 `duplex`，否则 fetch 在离开渲染进程前就被拒绝，每个终端在三次重试阶梯后都报 `terminalConnectFailed`。同样的 cast 已存在于 `packages/client/connection/src/http-bridge.ts`，而桌面壳的 `dsh-app://` 自定义协议并不改变这一要求。
- 三个宿主调用点通过 `ctx.get('sessionPersistence').inspect(...)` 读取会话存储。该成员在持久化服务上已不存在——脱离状态的检查迁到了 `ctx.sessionController.inspect`，并且还能看到已挂接的会话。因此这些调用点直接抛错：终端的冷会话 cwd 兜底对任何未携带 cwd 的请求返回 500（`persistence.inspect is not a function`），侧边对话的冷恢复预设读取同样失败。侧边对话的线程创建更早一步就因为另一个原因失败，症状相同：它通过 `ctx.agents.create` 创建种子子会话时没有传 `inheritedEventCount`，而 `Session` 对带 `isSeeded` 的 header 拒绝这种创建。

两个缺陷都没被发现，因为自 first-party 移植落地以来，没有任何出货组合挂载过这个侧边栏。

## Decision

桌面 overlay 重新插入 `better-sidebar` 行，并修好侧边栏的传输：

- `TerminalView` 在终端请求上声明 `duplex: 'half'`，按连接桥的做法 cast `RequestInit & { duplex: 'half' }`（`lib.dom` 未声明该成员）。
- `sessionCwdOf`、`composePersistedSetup` 与线程信息路由改为读取 `ctx.get('sessionController')` 并调用 `inspect(sessionId)`。cwd 解析链保持其文档化顺序（已挂接 header、调用方摘要、控制器检查、宿主进程 cwd）；当检查拒绝该会话时，链路落到宿主进程 cwd 而不是让请求失败，因为针对未知会话的侧边栏请求不应返回 500。
- `sidechat.start` 在创建种子子会话时传 `inheritedEventCount: SessionLogOffset(inheritance.seed.length)`：来自父会话的前缀才是继承部分，子会话随后追加的 descriptor 事件是它自己的第一行。harness 的 subagent 地址栅栏会拒绝 seq 低于子会话继承事件数的 descriptor（`packages/api/session-controller/src/history.ts`），因此该计数必须止于它之前。

## Alternatives considered

**只隐藏两个面板开关、保留挂载行。** 不可行：这两个开关是面板唯一入口（见[移除记录](../../archived/architecture/2026-09-10-desktop-without-workspace-sidebar.md)），隐藏后面板将无法打开。

**只插入行、不修传输。** 否决：终端正是想要工作台的首要原因，而挂载了却连不上的终端会被读成产品坏了，而不是功能缺失。

**保留 `sessionPersistence`，向 harness 要回一个 `inspect` 成员。** 否决：`ctx.sessionController.inspect` 已经回答了同一个问题，并且还能看到已挂接会话；再复活一套检查面等于重复权威。

**让 cwd 链在检查拒绝会话时显式失败。** 否决：该链存在的目的就是让脱离状态的首次请求仍能解析到正确项目；否则一个陈旧标签页或一个已删除会话会把每条侧边栏路由变成 500。

## Consequences

桌面 App 重新携带代码工作台：底部面板、右侧工作台、`/sidebar/*` 路由、宿主注册的 `sidebar_open` 与可选 `terminal_*` 工具，以及侧边栏对 `交付物` 的 turn-tail 拦截。桌面产品此前那条负向保证——没有工作台、没有侧边栏路由、没有侧边栏工具——不再成立。

两处修复在侧边栏挂载的任何地方都生效，不只桌面：终端在 `dsh web` 里同样连不上，冷会话 cwd 兜底也因为同一原因返回 500。

两个缺陷都是本仓 fork 本地引入的，随 first-party 移植而来；上游没有它们，因此上游同步时遇到的是这处修复作为分歧，而不是冲突。

`packages/client/better-sidebar/README.md` 与桌面组合注释已写明挂载状态；[`2026-08-28` 采纳记录](2026-08-28-adopt-better-sidebar-first-party.zh.md)不再声称桌面省略该行。

## Testing

`npx vitest run packages/client/better-sidebar`（1725 个用例）钉住新行为：终端请求携带 `duplex: 'half'`；种子子会话创建携带 `inheritedEventCount === seed.length - 1`；cwd 链通过控制器解析冷会话、拒绝相对的检查结果 cwd，并在控制器报无 cwd 与拒绝会话两种情况下都回落到宿主进程 cwd。`npx vitest run apps/desktop-host apps/desktop`（135 个用例）保持通过。

在桌面渲染进程上手工端到端跑 `pnpm run dev:desktop`（CDP）：侧边栏挂载出面板宿主与开关，资源管理器列出会话工作区，Markdown 文件在预览中打开，终端连上并对真实 shell 执行 `echo`，而对脱离状态且未带 cwd 的会话发起终端请求会解析出持久化的 cwd（`/Users/xujian/.sati/自媒体运营`）而不是返回 500。`sidechat.start` 的线程创建未对活跃父会话实测：侧边对话要求父会话正在运行，而验证所用的 home 中没有模型凭据。

## Related

- [Desktop composition without the workspace sidebar](../../archived/architecture/2026-09-10-desktop-without-workspace-sidebar.md) — 本次改动反转的移除。
- [Adopt better-sidebar first-party](2026-08-28-adopt-better-sidebar-first-party.zh.md) — 该包为何是 first-party，以及它如何进入桌面发布。
- [Desktop portless push transport](2026-09-09-desktop-portless-push-transport.zh.md) — 终端所用的 fetch 流式传输。
