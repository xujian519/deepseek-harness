# Agent Note: Desktop host serves plugin routes under the gateway prefix

Status: implemented

English | [中文](2026-09-10-desktop-api-plugin-routes.zh.md)

## Problem

The desktop host's fetch dispatch sent every `/api/*` pathname to the connection's shared Fetch handler before consulting the portless route table (see the [portless webserver seam note](2026-09-09-desktop-portless-webserver-seam.md)). A composition plugin that registers a route under `/api` was unreachable, and the gateway answered 404 for it.

The external `@dely0/dsh-personal-workbench` plugin registers exact and prefix routes at `/api/workbench/*` on `ctx.webServer`. Its client fetches `/api/workbench/bootstrap`, `/tasks`, `/settings`, `/drafts`, and `/ai-sessions` on every renderer load; each answered 404, and the panel rendered its empty state without reporting an error. The same plugin works against `dsh web`, where the listening server matches one route table exact-first and longest-prefix, so only the desktop dispatch dropped those routes.

## Decision

`desktopRequestOwner(pathname, matched)` in `apps/desktop-host/src/index.ts` classifies each custom-protocol request as `stream`, `portless`, `gateway`, or `assets`. The portless table is consulted first, which keeps the listening server's order. The one route excluded from that consultation is the gateway's own `/api` prefix registration, which the host answers directly through `connection.createSharedFetchHandler(API_PATH)`.

That exclusion follows from the transport rather than from policy: a custom-scheme request carries neither `Host` nor a socket, the two inputs `isTrustedApiRequest` and the browser-authentication check read, so dispatching the request to that registration refuses it.

The portless request face also derives the node face's `Host` from the request URL authority when the Fetch request carries none, which Chromium always does for a custom scheme. The seam's contract — route handlers keep the fence they implement, with the renderer's `app` authority in `webRuntime.trustedHosts` — held only in the boot harness, whose request supplied `Host` by hand.

## Alternatives considered

**Serve the gateway through the connection's portless `/api` registration.** Rejected: that handler fences on `Host` plus a browser-authentication cookie, and the real transport carries neither, so every `/api` request would answer 403.

**Report a loopback authority on the portless request face so listener-written fences pass.** Rejected: the authority of a `dsh-app://` request is `app`, and rewriting it fabricates request metadata for every plugin fence.

**Keep `/api` entirely host-owned and require plugins to mount outside it.** Rejected: it turns a registration the listening server serves into a silent 404.

## Consequences

A composition plugin owns `/api/...` paths on desktop exactly as it does against the listening server. A handler that reads a node request member the portless face does not implement (`req.socket`) still fails there: that face has no listener socket, so such a handler has to recognize the transport itself, as the workbench plugin's loopback fence does in the desktop profile once a socket-less request counts as local.

`apps/desktop-host/tests/dispatch.spec.ts` pins the ownership decision, and `portless-webserver.spec.ts` pins the derived `Host`. The boot harness in `desktop-boot.spec.ts` cannot exercise the ownership decision, because the host dispatch runs only against a deployed desktop profile.
