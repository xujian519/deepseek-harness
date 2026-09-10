# Agent Note: 桌面宿主服务网关前缀下的插件路由

Status: implemented

[English](2026-09-10-desktop-api-plugin-routes.md) | 中文

## 问题

桌面宿主的 fetch 分发在咨询无端口路由表之前，就把每个 `/api/*` 路径交给了 connection 的共享 Fetch handler（参见[无端口 webserver 接缝](2026-09-09-desktop-portless-webserver-seam.zh.md)）。因此在 `/api` 下注册路由的组合插件无法被触达，网关对它们回答 404。

外部插件 `@dely0/dsh-personal-workbench` 在 `ctx.webServer` 上注册了 `/api/workbench/*` 的 exact 与 prefix 路由。它的客户端在每次渲染进程加载时请求 `/api/workbench/bootstrap`、`/tasks`、`/settings`、`/drafts` 与 `/ai-sessions`；每个都返回 404，面板随之渲染空状态且不报错。同一插件在 `dsh web` 下正常，因为监听服务器对同一张路由表按 exact 优先、最长前缀匹配，只有桌面分发丢掉了这些路由。

## 决定

`apps/desktop-host/src/index.ts` 里的 `desktopRequestOwner(pathname, matched)` 把每个自定义协议请求归类为 `stream`、`portless`、`gateway` 或 `assets`。先咨询无端口路由表，与监听服务器的次序一致。唯一被排除在这次咨询之外的是网关自己的 `/api` 前缀注册，它由宿主经 `connection.createSharedFetchHandler(API_PATH)` 直接应答。

这一排除来自传输本身而非策略：自定义协议请求既不带 `Host`，也没有 socket，而这两项正是 `isTrustedApiRequest` 与浏览器鉴权检查读取的输入，把请求交给那条注册会让它一律拒绝。

无端口请求面还会在 Fetch 请求未携带 `Host` 时，用请求 URL 的权威补出 node 请求面的 `Host`——对自定义协议，Chromium 始终如此。该接缝的既定契约——路由 handler 保留自己实现的围栏，渲染进程的 `app` 权威位于 `webRuntime.trustedHosts`——此前只在 boot 桩里成立，因为那里的请求是手工带上 `Host` 的。

## 考虑过的替代方案

**让网关经 connection 的无端口 `/api` 注册来服务。** 否决：该 handler 的围栏读 `Host` 与浏览器鉴权 cookie，而真实传输两者都没有，于是每个 `/api` 请求都会得到 403。

**在无端口请求面上报出回环权威，让按监听服务器写的围栏通过。** 否决：`dsh-app://` 请求的权威是 `app`，改写它就是为所有插件的围栏伪造请求元数据。

**让 `/api` 完全由宿主独占，要求插件挂到别处。** 否决：这会把监听服务器本来服务的注册变成静默 404。

## 后果

组合插件在桌面端拥有 `/api/...` 路径的方式与在监听服务器上完全一致。读取无端口面未实现的 node 请求成员（`req.socket`）的 handler 在桌面端仍会失败：该面没有监听 socket，这类 handler 必须自行识别传输，正如桌面 profile 中一旦把无 socket 请求视为本机，工作台插件的回环围栏所做的那样。

`apps/desktop-host/tests/dispatch.spec.ts` 固定了归属判定，`portless-webserver.spec.ts` 固定了 `Host` 的推导。`desktop-boot.spec.ts` 里的 boot 桩无法覆盖归属判定，因为宿主分发只在部署好的桌面 profile 上运行。
