# Agent Note: 桌面无端口 webserver 接缝

Status: implemented

[English](2026-09-09-desktop-portless-webserver-seam.md) | 中文

## Problem

`apps/desktop-host/src/index.ts` 里的桌面宿主 fetch 分发只服务三样东西：`/api/*`（网关）、`/.dsh/remote-stream`（NDJSON 推送载体）以及打包好的 web-frontend 静态资产。一个要挂载 HTTP 路由的组合插件——第一方侧边栏，其五条 `/sidebar/*` handler 注册在 `ctx.webServer` 上——没有无端口载体，因为桌面 overlay 禁用了 `webserver` 组合行（真正的监听 socket）。侧边栏的宿主半侧没有一张可注册的路由表和一个服务它的分发，就无法运行。

## Decision

在 `apps/desktop-host/src/portless-webserver.ts` 新增无端口 HTTP 面 `PortlessWebServer`。它是一张路由注册表（`register` 用于 exact/prefix 路由，`registerUpgrade` 为 socket 升级预留）外加一个适配器，把字节管道的 Fetch `Request`/`Response` 转成路由 handler 已经在用的 node 风格请求/响应对：请求暴露 `url`、`method`、`headers` 以及一个读取 Fetch body 分块的 `[Symbol.asyncIterator]`，其 `Host` 由请求 URL 的权威推导（自定义协议请求自身不携带该头）；响应把 `writeHead`/`end` 调用收集成带对应状态与头的 `Response`。宿主的 `fetch` 分发对除 `/.dsh/remote-stream` 之外的每个路径都先咨询它，位于宿主直接应答的 `/api` 网关之前（见 [API 命名空间说明](2026-09-10-desktop-api-plugin-routes.zh.md)），没有路由匹配就回落到静态资产 handler。它暴露侧边栏 `apply` 在 `context-types.ts` 读取的 `register`/`registerUpgrade` 面，因此消费这一窄形状的插件原样挂载。

WebSocket 升级无法在自定义协议上服务：Electron 44.0.0 上的探针确认 `new WebSocket('dsh-app://app/ws')` 在渲染进程抛错，因为 Chromium 的 `WebSocket` 构造器只接受 `ws`/`wss`/`http`/`https`，且升级请求从不抵达 handler。因此升级注册被保留但不会在此分发；推送传输是另一条接缝，记录在[桌面无端口推送传输](2026-09-09-desktop-portless-push-transport.zh.md)。

## Alternatives considered

**复用 `@deepseek-ai/dsh-host-webserver` 的监听 `WebServer`。** 被否决：它的激活会 bind 一个 socket，这正是无端口壳要去掉的。

**给侧边栏一个专属桌面服务，而非 `webServer` 面。** 被否决：侧边栏已经消费的是一个窄的 `register`/`registerUpgrade` 形状，撑住该面可让其宿主半侧字节级不变。

**把路由围栏建立在壳持有的 host 边界上，而非 `webRuntime.trustedHosts`。** 未采用：桌面 boot 提供的 `webRuntime` 携带渲染进程的 `app` 权威，因此路由 handler 沿用它们本就实现的围栏，不会有 handler 长出第二套信任规则。

**把推送 socket 搬到自定义 scheme 上的 WebSocket。** 被可行性探针否决：Chromium 拒绝为非 `ws`/`wss` scheme 构造 WebSocket。

## Consequences

组合插件可以无端口挂载 HTTP 路由（node 风格 handler）并经桌面 `dsh-app://` 传输服务。除 `/.dsh/remote-stream` 之外的每个请求现在会在宿主自有路径之前多跑一次注册表查询；没有路由认领该路径时，宿主自有路径仍给出原来的网关或资产应答。桌面组合认领了该接缝上的路由：宿主沿用 `desktop.cordis.patch.yml` overlay，boot 回调提供 `ctx.webServer`（无端口面）与 `ctx.webRuntime`，并把渲染进程的 `app` 权威当作围栏的可信主机，因此任何注册路由的组合插件都在此被服务——其中包括 client-modules 花名册的 `/plugins` 前缀路由。桌面组合已重新挂载侧边栏，它的五条 `/sidebar/*` handler 也在此被服务（见[重新挂载记录](2026-09-10-desktop-workspace-sidebar-remount.zh.md)）；`apps/desktop-host/tests/desktop-boot.spec.ts` 里的 boot 桩继续把它当作 fixture 插件，用来证明真实 cordis 组合能在宿主提供的服务上注册并服务一条带围栏的路由。经 `registerUpgrade` 注册的三条推送 socket 被保留但不分发——它们在自定义协议上没有 WebSocket 载体，因此[桌面无端口推送传输](2026-09-09-desktop-portless-push-transport.zh.md)把它们改接到 `registerStream` 上。路由 handler 拥有响应生命周期，所以被保持打开的输出流（SSE）仍须像在监听服务器上那样由 handler 自行提供。
