# Agent Note: Desktop portless webserver seam

Status: implemented

English | [中文](2026-09-09-desktop-portless-webserver-seam.zh.md)

## Problem

The desktop host's fetch dispatch in `apps/desktop-host/src/index.ts` served only three things: `/api/*` (the gateway), `/.dsh/remote-stream` (the NDJSON push carrier), and the packaged web-frontend assets. A composition plugin that mounts HTTP routes — the first-party sidebar, whose five `/sidebar/*` handlers register on `ctx.webServer` — had no portless carrier, because the desktop overlay disables the `webserver` composition row (a real listening socket). The sidebar's host half cannot run without a route table it can register into and a dispatch that serves it.

## Decision

Add a portless HTTP surface as `PortlessWebServer` in `apps/desktop-host/src/portless-webserver.ts`. It is a route registry (`register` for exact/prefix routes, `registerUpgrade` reserved for socket upgrades) plus an adapter that translates the byte-pipe Fetch `Request`/`Response` into the node-style request/response pair the route handlers already use: the request exposes `url`, `method`, `headers`, and a `[Symbol.asyncIterator]` that reads the Fetch body chunks; the response collects `writeHead`/`end` calls into a `Response` with matching status and headers. The host's `fetch` dispatch consults it for every non-`/api`, non-`/.dsh/remote-stream` path, falling through to the asset handler when no route matches. It exposes the `register`/`registerUpgrade` face the sidebar's `apply` reads in `context-types.ts`, so the sidebar's host half mounts unchanged.

WebSocket upgrades cannot be served over the custom protocol: a probe on Electron 44.0.0 confirmed `new WebSocket('dsh-app://app/ws')` throws in the renderer because Chromium's `WebSocket` constructor accepts only `ws`/`wss`/`http`/`https`, and the upgrade never reaches the handler. Upgrade registrations are therefore held but never dispatched here; the push transport is a separate seam, recorded in the [portless better-sidebar proposal](../proposed/architecture/2026-09-09-better-sidebar-portless-desktop.md).

## Alternatives considered

**Reuse the listening `WebServer` from `@deepseek-ai/dsh-host-webserver`.** Rejected: its activation binds a socket, which is exactly what a portless shell removes.

**Give the sidebar a bespoke desktop service instead of the `webServer` face.** Rejected: the sidebar already consumes a narrow `register`/`registerUpgrade` shape, so backing that face keeps its host half byte-identical.

**Carry the push sockets on WebSocket over the custom scheme.** Rejected by the feasibility probe: Chromium refuses to construct a WebSocket for a non-`ws`/`wss` scheme.

## Consequences

Composition plugins can mount HTTP routes portlessly with node-style handlers and are served through the desktop `dsh-app://` transport. Every non-`/api`, non-`/.dsh/remote-stream` request now runs one registry lookup before the packaged-asset fallback, which answers with the same 404-or-asset result when no route claims it. The official composition mounts the first-party sidebar: the host boots the `desktop.cordis.patch.yml` overlay that inserts the `better-sidebar` row, and the boot callback provides `ctx.webServer` (the portless surface) and `ctx.webRuntime` with the renderer's `app` authority as the fence's trusted host, so the sidebar's host half registers its five `/sidebar/*` routes onto the seam. A boot harness in `apps/desktop-host/tests/desktop-boot.spec.ts` activates the sidebar through a real cordis composition against the host-provided services and serves a fenced route. The three push sockets registered via `registerUpgrade` are held but not dispatched — they have no WebSocket carrier on the custom protocol, so re-plumbing them over non-WebSocket channels is the remaining increment. The route handlers own the response lifecycle, so a held-open stream (SSE) must be supplied by the handler as it already is against the listening server.
