# Agent Note: Portless Better-Sidebar Desktop Adaptation

Status: proposed

English | [中文](2026-09-09-better-sidebar-portless-desktop.zh.md)

## Problem

The first-party sidebar (`@deepseek-ai/dsh-better-sidebar`) is the one remaining desktop feature that cannot run in the official portless Electron shell. It is mounted only in the `desktop-app` bundle the Patent shell uses; the official desktop composition (`apps/desktop-host` + the `desktop.cordis.patch.yml` overlay over the `web-app` bundle) omits it.

The reason is transport. The host half of the sidebar (`packages/client/better-sidebar/src/index.ts`) mounts its surface on `ctx.webServer`, which is the HTTP server consumed by the browser profile: five HTTP routes (`/sidebar/api`, `/sidebar/upload`, `/sidebar/bundle`, `/sidebar/file`, `/sidebar/html`) and three WebSocket upgrades (`/sidebar/ws/terminal`, `/sidebar/ws/agent-terminals`, `/sidebar/ws/agent-opens`). Each request is fenced against `ctx.webRuntime.trustedHosts`. The client half opens those sockets with `new WebSocket('/sidebar/ws/…', location.origin)` and fetches `/sidebar/…` as same-origin relative URLs.

The official shell has no HTTP server and no WebSocket. Its renderer loads `dsh-app://app/index.html`; Electron's `protocol.handle` forwards every request over framed byte pipes to the `apps/desktop-host` child, whose `fetch` dispatch in `apps/desktop-host/src/index.ts` handles only `/api/*`, `/.dsh/remote-stream`, and the packaged web-frontend assets. The overlay disables `webserver`, `web-runtime`, `web-startup`, and `synapse`. So there is no `ctx.webServer` for the sidebar to register on, and there is no WebSocket surface for its pushes.

This note records the portless adaptation and the feasibility verdict that shaped it.

## Proposal

Carry the sidebar over the existing byte-pipe transport instead of the HTTP/WebSocket surface. This splits into the HTTP routes and the push sockets because they are not equally portable.

### HTTP routes ride `dsh-app://` fetch unchanged

A minimal `protocol.handle('dsh-app', …)` probe on the shipped Electron 44.0.0 binary confirmed that `fetch('dsh-app://app/hello')` reaches the handler and returns a body (`{status:200,text:"hi-from-handler"}`). The five GET/POST routes therefore need no transport change: give the desktop host a route table that plugins register into, and have its `fetch` dispatch consult that table for paths that are not `/api/*`, not `/.dsh/remote-stream`, and not static assets.

Provide that table through the `webServer` face the sidebar already consumes (the `register({kind,path,handler})` shape in `packages/client/better-sidebar/src/context-types.ts`), backed by the desktop host's dispatch instead of a listening socket. The host half of the sidebar then mounts unchanged; only the service behind `ctx.webServer` differs between the browser and desktop compositions.

### Push sockets move off WebSocket

The same probe also showed that `new WebSocket('dsh-app://app/ws')` throws `SyntaxError: The URL's scheme must be either 'http', 'https', 'ws', or 'wss'. 'dsh-app' is not allowed.` and the upgrade never reaches the handler. Chromium's `WebSocket` constructor accepts only `ws`/`wss`/`http`/`https`, independent of the scheme privileges (`standard`, `secure`, `supportFetchAPI`, `stream`) the shell registers. WebSocket over the custom scheme is therefore not an option.

Replace the three push sockets with a non-WebSocket channel in the desktop build:

- Host → client push (`/sidebar/ws/agent-terminals`, `/sidebar/ws/agent-opens`) can ride the existing line-delimited stream carrier the shell already uses: the renderer POSTs `/.dsh/remote-stream`, and the host yields NDJSON lines from `ctx.gateway.wireStream.open(...)` (`apps/desktop-host/src/index.ts`). These are one-way pushes from a registry, so a server-push stream is a direct fit.
- Terminal (`/sidebar/ws/terminal`) is bidirectional: client input and resize frames go up while pty output comes down. A single server-push stream cannot carry the client→server half. Route terminal control messages (input, resize, close) through an `/api` endpoint (the shell already forwards `/api/*`), and stream pty output down the same or a sibling push stream, or add a dedicated bidirectional frame channel over the byte pipes for the desktop transport.

The client half must stop calling `new WebSocket('/sidebar/ws/…', location.origin)` (`Sidebar.tsx:103`, `TerminalView.tsx:213`) and instead use the desktop transport's push/control primitives; the `__DSH_TRANSPORT__` hook in `packages/client/connection/src/client/index.ts` is the existing seam for a shell that owns a different physical transport.

### Security boundary

The current fence is `ctx.webRuntime.trustedHosts`, but the desktop composition has no web-runtime. The portless HTTP surface must fence on the desktop shell's boundary instead: the desktop renderer loads from `dsh-app://app`, the host declares `ownsHost: true` through the transport hook, and `ctx.connection.isLoopback` already reports the privileged surface. Any route handler must key off that boundary, not a host header list derived from a bind.

## Alternatives considered

**WebSocket over the custom scheme.** Gated by the feasibility probe and rejected: the renderer throws before the socket is constructed, and the upgrade never reaches the handler. This is a hard Chromium constraint, not a configuration gap.

**Keep the Patent shell as the home of the sidebar.** Rejected because it leaves the desktop feature stranded on a shell slated for retirement (see the retirement plan), and because it keeps one feature on a port-based transport inside an otherwise portless shell.

**Rewrite the sidebar host to a bespoke desktop service instead of the `webServer` face.** Rejected: the sidebar already consumes the narrow `register`/`registerUpgrade` face, so backing `ctx.webServer` with the desktop route table keeps the host half byte-identical; only `registerUpgrade` needs a desktop alternative.

**Terminal over a dedicated bidirectional byte-pipe frame channel rather than `/api` control + push stream.** The likelier cost is a new protocol frame on `apps/desktop-host` plus its decoder/test surface; the alternative reuses the existing `/api` RPC and `remote-stream` wiring but adds a per-session control endpoint. Either is viable; the proposal leans to reusing `/api` plus a push stream first and falling back to a dedicated channel only if latency or framing demands it.

## Acceptance criteria

- The official desktop composition mounts `@deepseek-ai/dsh-better-sidebar` and boots without a listening port.
- The five `/sidebar/*` GET/POST routes answer over `dsh-app://` with the same fence semantics as before.
- The three former push sockets deliver the same events; terminal input and output round-trip through the non-WebSocket transport.
- The desktop shell's keyless recorded-session snapshot suite gains coverage for the sidebar surface, and existing web-sidebar snapshots continue to pass unchanged.

## Risks

- The sidebar is the only WebSocket consumer in the client tree; re-plumbing it touches its client connection code, its host `registerUpgrade` call sites, and the desktop transport, so this is a multi-package change with real regression surface.
- A push stream and an `/api` control endpoint are not one WebSocket: reconnect semantics, ordering, and backpressure around pty output must be re-derived rather than inherited from `ws`.
- The trust model changes meaning (trusted-hosts list → owned-host boundary), so every route's security review has to be redone rather than carried over.
- Terminal latency and half-close behavior over a stream plus control RPC may differ enough to need the dedicated frame channel, expanding the change further.
