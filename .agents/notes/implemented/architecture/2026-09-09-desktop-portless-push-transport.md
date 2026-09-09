# Agent Note: Desktop portless push transport

Status: implemented

English | [中文](2026-09-09-desktop-portless-push-transport.zh.md)

## Problem

The desktop shell's renderer cannot construct a `WebSocket` for the custom `dsh-app://` scheme (Chromium accepts only `ws`/`wss`/`http`/`https`), so the three better-sidebar transports registered over `registerUpgrade` were held but never dispatched. The terminal (bidirectional), the agent-terminals list push, and the agent-opens request push all relied on that upgrade path and therefore did not reach the desktop renderer.

## Decision

Re-plumb the three transports over the portless streaming surface. Extend `PortlessWebServer` with a `registerStream` route whose handler returns a Fetch `Response` carrying a `ReadableStream` body, which the host dispatch forwards chunk by chunk (the writeHead/end route face is unchanged). On the plugin side, a `SidebarTransport` abstraction replaces the WebSocket in the pty pumps and push attachments.

- The **terminal** is a duplex request: the request body carries client→host input frames (raw text, plus JSON `{type:'resize'|'close'|'park'}`), the response body carries host→client output (transcript replay, live data, exit notice). Failure moves from WS close codes to HTTP statuses: 400 for missing parameters, 404 for an unknown agent uuid, 503 with the `pty-deps-missing` marker for a degraded node-pty install, 500 for an unexpected resolution error. A close frame's immediate release is preserved from the body-end grace via a `closeFrameReceived` flag (the last `scheduleClose` wins).
- The **agent-terminals** and **agent-opens** pushes are one-way newline-delimited JSON streams: the client POSTs a subscription and reads NDJSON lines, one JSON payload per frame, mirroring the `/.dsh/remote-stream` convention.

The client consumes the streams with fetch instead of WebSocket: `subscribeSessionPush` reads the NDJSON body and reconnects with a 2 s backoff capped at `FAILURE_LIMIT`; `TerminalView` POSTs an input stream and reads the output stream, mapping a 503 deps-marker to a repair-details fetch and a 4xx/5xx to a surfaced reason.

## Alternatives considered

**Split the terminal into two one-way requests (an input POST plus an output stream).** Rejected: the duplex request is the faithful shape of the original socket, and the desktop transport already streams the request body and the response body independently, so no custom framing is needed for the terminal.

**Reuse `/.dsh/remote-stream` for the pushes.** Rejected in part: that channel is bound to the gateway's `wireStream` endpoints, while the sidebar's push feeds come from its own registries; a per-plugin `registerStream` route keeps the same host-to-renderer streaming model without coupling to the gateway.

**Keep WebSocket but probe a different scheme.** Rejected: Chromium's `WebSocket` constructor refuses non-`ws`/`wss`/`http`/`https` schemes, so no custom-scheme WebSocket exists to carry the frames.

## Consequences

The desktop renderer now receives the three sidebar transports over streaming fetch bodies. The terminal is full-duplex over one request; the agent pushes are NDJSON streams with the same reconnect semantics as before. The `SidebarTransport` face keeps the pty pumps behavior-identical (transcript replay, resize/close/park frames, the reconnect-grace countdown, the agent-owned-lifetime kill rules), so the model-facing terminal tools are unchanged. The `ws` dependency leaves the plugin's source. A `registerStream` route and a writeHead/end route share path uniqueness on the portless surface.
