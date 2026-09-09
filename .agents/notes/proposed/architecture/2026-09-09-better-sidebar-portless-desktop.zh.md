# Agent Note: 侧边栏无端口桌面适配

Status: proposed

[English](2026-09-09-better-sidebar-portless-desktop.md) | 中文

## Problem

第一方侧边栏（`@deepseek-ai/dsh-better-sidebar`）是唯一一项无法在官方无端口 Electron 壳里运行的桌面功能。它只挂载在 Patent 壳使用的 `desktop-app` bundle 里；官方桌面组合（`apps/desktop-host` + 在 `web-app` bundle 之上的 `desktop.cordis.patch.yml` overlay）没有包含它。

原因在于传输方式。侧边栏的宿主半侧（`packages/client/better-sidebar/src/index.ts`）把整个面挂在 `ctx.webServer` 上——这是浏览器 profile 消费的 HTTP 服务器：五条 HTTP 路由（`/sidebar/api`、`/sidebar/upload`、`/sidebar/bundle`、`/sidebar/file`、`/sidebar/html`）和三条 WebSocket 升级（`/sidebar/ws/terminal`、`/sidebar/ws/agent-terminals`、`/sidebar/ws/agent-opens`）。每个请求都用 `ctx.webRuntime.trustedHosts` 做围栏。客户端半侧用 `new WebSocket('/sidebar/ws/…', location.origin)` 打开这些 socket，并把 `/sidebar/…` 当作同源相对 URL 拉取。

官方壳既没有 HTTP 服务器，也没有 WebSocket。它的渲染进程加载 `dsh-app://app/index.html`；Electron 主进程的 `protocol.handle` 把每个请求经帧化字节管道转发给 `apps/desktop-host` 子进程，该子进程在 `apps/desktop-host/src/index.ts` 里的 `fetch` 分发只处理 `/api/*`、`/.dsh/remote-stream` 和打包好的 web-frontend 静态资产。overlay 显式 `disabled` 了 `webserver`、`web-runtime`、`web-startup` 与 `synapse`。因此侧边栏没有可挂载的 `ctx.webServer`，也没有供它推送的 WebSocket 面。

本笔记记录这项无端口适配，以及据此敲定的可行性结论。

## Proposal

把侧边栏搬到现有字节管道传输上，而不是 HTTP/WebSocket 面。由于 HTTP 路由与推送 socket 的可行性不一样，两者要分开处理。

### HTTP 路由原样走 `dsh-app://` fetch

在随附的 Electron 44.0.0 二进制上跑过一个最小 `protocol.handle('dsh-app', …)` 探针，确认 `fetch('dsh-app://app/hello')` 能抵达 handler 并返回响应体（`{status:200,text:"hi-from-handler"}`）。因此五条 GET/POST 路由无需改变传输：给桌面宿主加一张可供插件注册的路由表，并让它的 `fetch` 分发在遇到既非 `/api/*`、又非 `/.dsh/remote-stream`、也非静态资产的路径时去查询这张表。

通过侧边栏已经在消费的 `webServer` 面来提供这张表（`packages/client/better-sidebar/src/context-types.ts` 里的 `register({kind,path,handler})` 形状），但改由桌面宿主的 dispatch 撑底，替代监听 socket。这样侧边栏的宿主半侧原样挂载；只有 `ctx.webServer` 背后的服务在浏览器与桌面组合之间不同。

### 推送 socket 脱离 WebSocket

同一个探针也表明 `new WebSocket('dsh-app://app/ws')` 会抛 `SyntaxError: The URL's scheme must be either 'http', 'https', 'ws', or 'wss'. 'dsh-app' is not allowed.`，且升级请求从未抵达 handler。Chromium 的 `WebSocket` 构造器只接受 `ws`/`wss`/`http`/`https`，与壳注册的 scheme 特权（`standard`、`secure`、`supportFetchAPI`、`stream`）无关。因此自定义 scheme 上跑 WebSocket 不可行。

在桌面构建里用非 WebSocket 通道替代三条推送 socket：

- 宿主 → 客户端推送（`/sidebar/ws/agent-terminals`、`/sidebar/ws/agent-opens`）可以复用壳已经在用的、以换行分隔的流载体：渲染进程 POST `/.dsh/remote-stream`，宿主从 `ctx.gateway.wireStream.open(...)` 逐行产出 NDJSON（`apps/desktop-host/src/index.ts`）。这类推送是单向的，来自一个 registry，服务端推送流正好匹配。
- 终端（`/sidebar/ws/terminal`）是双向的：客户端输入与 resize 帧上行，pty 输出下行。单条服务端推送流承载不了客户端 → 服务端那一半。让终端控制消息（input、resize、close）走 `/api` 端点（壳已转发 `/api/*`），pty 输出沿同一或姊妹推送流下行；或者为了桌面传输新增一条专用的、在字节管道上的双向帧通道。

客户端半侧必须停止调用 `new WebSocket('/sidebar/ws/…', location.origin)`（`Sidebar.tsx:103`、`TerminalView.tsx:213`），改用桌面传输的推送/控制原语；`packages/client/connection/src/client/index.ts` 里的 `__DSH_TRANSPORT__` 钩子正是为"宿主掌握另一种物理传输"准备的既有接缝。

### 安全边界

当前的围栏是 `ctx.webRuntime.trustedHosts`，但桌面组合没有 web-runtime。无端口 HTTP 面必须改用桌面壳自己的边界做围栏：桌面渲染进程从 `dsh-app://app` 加载，宿主通过传输钩子声明 `ownsHost: true`，而 `ctx.connection.isLoopback` 已经报告了特权面。任何路由 handler 都应基于该边界，而不是一张从 bind 派生出来的 Host 头清单。

## Alternatives considered

**WebSocket 走自定义 scheme。** 由可行性探针把关并被否决：渲染进程在构造 socket 之前就抛错，升级请求也到不了 handler。这是 Chromium 的硬约束，不是配置缺口。

**把 Patent 壳保留为侧边栏的家。** 被否决：它会把这项桌面功能搁浅在一个待退役的壳上（见退役计划），并让该功能留在无端口壳内唯一基于端口的传输上。

**把侧边栏宿主改写成一个专门面向桌面的服务，而非 `webServer` 面。** 被否决：侧边栏已经消费的是很窄的 `register`/`registerUpgrade` 面，用桌面路由表给 `ctx.webServer` 撑底可以让宿主半侧字节级不变；只有 `registerUpgrade` 需要桌面替代。

**终端走专用的双向字节管道帧通道，而非 `/api` 控制 + 推送流。** 更可能的代价是给 `apps/desktop-host` 新增一种协议帧及其解码器/测试面；另一方案复用现有 `/api` RPC 与 `remote-stream` 接线，但会新增按会话的控制端点。两者都可行；Proposal 倾向先复用 `/api` 加一条推送流，只有延迟或分帧确实要求时才回退到专用通道。

## Acceptance criteria

- 官方桌面组合挂载 `@deepseek-ai/dsh-better-sidebar` 且不监听端口即可启动。
- 五条 `/sidebar/*` GET/POST 路由能经 `dsh-app://` 应答，围栏语义与之前一致。
- 三条原推送 socket 送达相同事件；终端输入/输出经非 WebSocket 传输往返。
- 桌面壳的无密钥 recorded-session 快照套件新增对侧边栏面的覆盖，且既有 web 侧边栏快照继续原样通过。

## Risks

- 侧边栏是客户端树里唯一的 WebSocket 消费方；重新接线会碰到它的客户端连接代码、宿主 `registerUpgrade` 调用点以及桌面传输，因此这是跨多包、有真实回归面的改动。
- 推送流加 `/api` 控制端点不等于一条 WebSocket：重连语义、有序性与围绕 pty 输出的背压都要重新推导，而非从 `ws` 继承。
- 信任模型发生含义变化（trusted-hosts 清单 → 宿主拥有的边界），所以每条路由的安全审计都要重做，而不是照搬。
- 终端在"流 + 控制 RPC"上各自的延迟与半关闭行为可能差异大到需要专用帧通道，进一步扩大改动。
