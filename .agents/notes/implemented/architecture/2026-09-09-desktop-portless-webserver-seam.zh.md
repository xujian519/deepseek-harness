# Agent Note: 桌面无端口 webserver 接缝

Status: implemented

[English](2026-09-09-desktop-portless-webserver-seam.md) | 中文

## Problem

`apps/desktop-host/src/index.ts` 里的桌面宿主 fetch 分发只服务三样东西：`/api/*`（网关）、`/.dsh/remote-stream`（NDJSON 推送载体）以及打包好的 web-frontend 静态资产。一个要挂载 HTTP 路由的组合插件——第一方侧边栏，其五条 `/sidebar/*` handler 注册在 `ctx.webServer` 上——没有无端口载体，因为桌面 overlay 禁用了 `webserver` 组合行（真正的监听 socket）。侧边栏的宿主半侧没有一张可注册的路由表和一个服务它的分发，就无法运行。

## Decision

在 `apps/desktop-host/src/portless-webserver.ts` 新增无端口 HTTP 面 `PortlessWebServer`。它是一张路由注册表（`register` 用于 exact/prefix 路由，`registerUpgrade` 为 socket 升级预留）外加一个适配器，把字节管道的 Fetch `Request`/`Response` 转成路由 handler 已经在用的 node 风格请求/响应对：请求暴露 `url`、`method`、`headers` 以及一个读取 Fetch body 分块的 `[Symbol.asyncIterator]`；响应把 `writeHead`/`end` 调用收集成带对应状态与头的 `Response`。宿主的 `fetch` 分发在每个非 `/api`、非 `/.dsh/remote-stream` 路径上都咨询它，没有路由匹配就回落到静态资产 handler。它暴露侧边栏 `apply` 在 `context-types.ts` 读取的 `register`/`registerUpgrade` 面，因此侧边栏宿主半侧原样挂载。

WebSocket 升级无法在自定义协议上服务：Electron 44.0.0 上的探针确认 `new WebSocket('dsh-app://app/ws')` 在渲染进程抛错，因为 Chromium 的 `WebSocket` 构造器只接受 `ws`/`wss`/`http`/`https`，且升级请求从不抵达 handler。因此升级注册被保留但不会在此分发；推送传输是另一条接缝，记录在[无端口侧边栏提案](../proposed/architecture/2026-09-09-better-sidebar-portless-desktop.md)。

## Alternatives considered

**复用 `@deepseek-ai/dsh-host-webserver` 的监听 `WebServer`。** 被否决：它的激活会 bind 一个 socket，这正是无端口壳要去掉的。

**给侧边栏一个专属桌面服务，而非 `webServer` 面。** 被否决：侧边栏已经消费的是一个窄的 `register`/`registerUpgrade` 形状，撑住该面可让其宿主半侧字节级不变。

**把推送 socket 搬到自定义 scheme 上的 WebSocket。** 被可行性探针否决：Chromium 拒绝为非 `ws`/`wss` scheme 构造 WebSocket。

## Consequences

组合插件可以无端口挂载 HTTP 路由（node 风格 handler）并经桌面 `dsh-app://` 传输服务。每个非 `/api`、非 `/.dsh/remote-stream` 请求现在会在回落到打包资产之前多跑一次注册表查询；没有路由认领时，结果仍是原来的 404 或资产。五条 `/sidebar/*` 路由是预期的消费方，但侧边栏包尚未挂进官方组合，所以注册表当前为空；挂载它、向组合提供 `ctx.webServer`/`ctx.webRuntime`，以及把终端与 agent 推送 socket 改接到非 WebSocket 载体，是后续增量。路由 handler 拥有响应生命周期，所以被保持打开的输出流（SSE）仍须像在监听服务器上那样由 handler 自行提供。
