# Agent Note: Desktop portless webserver seam

Status: implemented

English | [中文](2026-09-09-desktop-portless-webserver-seam.zh.md)

## Problem

The desktop host's fetch dispatch in `apps/desktop-host/src/index.ts` served only three things: `/api/*` (the gateway), `/.dsh/remote-stream` (the NDJSON push carrier), and the packaged web-frontend assets. A composition plugin that mounts HTTP routes — the first-party sidebar, whose five `/sidebar/*` handlers register on `ctx.webServer` — had no portless carrier, because the desktop overlay disables the `webserver` composition row (a real listening socket). The sidebar's host half cannot run without a route table it can register into and a dispatch that serves it.

## Decision

Add a portless HTTP surface as `PortlessWebServer` in `apps/desktop-host/src/portless-webserver.ts`. It is a route registry (`register` for exact/prefix routes, `registerUpgrade` reserved for socket upgrades) plus an adapter that translates the byte-pipe Fetch `Request`/`Response` into the node-style request/response pair the route handlers already use: the request exposes `url`, `method`, `headers`, and a `[Symbol.asyncIterator]` that reads the Fetch body chunks — with `Host` derived from the request URL authority, which a custom-scheme request does not carry itself; the response collects `writeHead`/`end` calls into a `Response` with matching status and headers. The host's `fetch` dispatch consults it for every path except `/.dsh/remote-stream`, ahead of the `/api` gateway the host answers directly (see the [API namespace note](2026-09-10-desktop-api-plugin-routes.md)), and falls through to the asset handler when no route matches. It exposes the `register`/`registerUpgrade` face the sidebar's `apply` reads in `context-types.ts`, so a plugin that consumes that narrow shape mounts unchanged.

WebSocket upgrades cannot be served over the custom protocol: a probe on Electron 44.0.0 confirmed `new WebSocket('dsh-app://app/ws')` throws in the renderer because Chromium's `WebSocket` constructor accepts only `ws`/`wss`/`http`/`https`, and the upgrade never reaches the handler. Upgrade registrations are therefore held but never dispatched here; the push transport is a separate seam, recorded in the [desktop portless push transport note](2026-09-09-desktop-portless-push-transport.md).

## Alternatives considered

**Reuse the listening `WebServer` from `@deepseek-ai/dsh-host-webserver`.** Rejected: its activation binds a socket, which is exactly what a portless shell removes.

**Give the sidebar a bespoke desktop service instead of the `webServer` face.** Rejected: the sidebar already consumes a narrow `register`/`registerUpgrade` shape, so backing that face keeps its host half byte-identical.

**Carry the push sockets on WebSocket over the custom scheme.** Rejected by the feasibility probe: Chromium refuses to construct a WebSocket for a non-`ws`/`wss` scheme.

**Fence the routes on the shell's owned-host boundary instead of `webRuntime.trustedHosts`.** Not taken: the desktop boot provides `webRuntime` with the renderer's `app` authority, so route handlers keep the fence they already implement and no handler grows a second trust rule.

## Consequences

Composition plugins can mount HTTP routes portlessly with node-style handlers and are served through the desktop `dsh-app://` transport. Every request except `/.dsh/remote-stream` runs one registry lookup ahead of the paths the host owns, which keep their gateway-or-asset answer when no route claims the pathname. The desktop composition claims the seam's routes: the host boots the `desktop.cordis.patch.yml` overlay and the boot callback provides `ctx.webServer` (the portless surface) and `ctx.webRuntime` with the renderer's `app` authority as the fence's trusted host, so a composition plugin that registers routes is served here — the client-modules roster's `/plugins` prefix route among them. The sidebar no longer mounts on desktop (see the [desktop-without-workspace-sidebar note](2026-09-10-desktop-without-workspace-sidebar.md)); a boot harness in `apps/desktop-host/tests/desktop-boot.spec.ts` keeps it as the fixture plugin that proves a real cordis composition can register and serve a fenced route against the host-provided services. The three push sockets registered via `registerUpgrade` are held but not dispatched — they have no WebSocket carrier on the custom protocol, so the [desktop portless push transport note](2026-09-09-desktop-portless-push-transport.md) re-plumbs them over `registerStream`. The route handlers own the response lifecycle, so a held-open stream (SSE) must be supplied by the handler as it already is against the listening server.
