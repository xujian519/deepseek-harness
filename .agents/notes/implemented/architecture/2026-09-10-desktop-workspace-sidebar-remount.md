# Agent Note: Remount the workspace sidebar on desktop

Status: implemented

English | [中文](2026-09-10-desktop-workspace-sidebar-remount.zh.md)

## Problem

The desktop composition omitted `@deepseek-ai/dsh-better-sidebar` outright, so the desktop app carried neither the bottom panel nor the right workbench ([rationale](../../archived/architecture/2026-09-10-desktop-without-workspace-sidebar.md)). A deployment that wants the workbench inside the desktop app inserts the row back.

Re-inserting the row alone does not produce a working workbench. Two latent defects in the sidebar's portless transports surface as soon as anything mounts it in a Chromium browser:

- `TerminalView` posts its duplex terminal request as `fetch(url, { method: 'POST', body: <ReadableStream> })`. Chromium refuses a streaming request body unless the request declares `duplex`, so the fetch rejects before it leaves the renderer and every terminal reports `terminalConnectFailed` after its three-attempt ladder. The same cast already exists in `packages/client/connection/src/http-bridge.ts`, and the desktop shell's custom `dsh-app://` scheme does not change the requirement.
- Three host call sites inspect session storage through `ctx.get('sessionPersistence').inspect(...)`. That member no longer exists on the persistence service — detached inspection moved to `ctx.sessionController.inspect`, which also reports attached sessions. The callers therefore threw: the terminal's cold-session cwd fallback answered 500 (`persistence.inspect is not a function`) for any request that carried no cwd, and the side chat's cold-resume preset read failed. The side-chat thread creation died one step earlier for an unrelated reason, feeding the same symptom: it creates a seeded child through `ctx.agents.create` without `inheritedEventCount`, which `Session` refuses for an `isSeeded` header.

Nothing caught either defect, because no shipped composition had mounted the sidebar since the first-party port landed.

## Decision

The desktop overlay inserts the `better-sidebar` row again, and the sidebar's transports are repaired:

- `TerminalView` declares `duplex: 'half'` on the terminal request, casting `RequestInit & { duplex: 'half' }` the way the connection bridge does (`lib.dom` does not declare the member).
- `sessionCwdOf`, `composePersistedSetup`, and the thread-info route read `ctx.get('sessionController')` and call `inspect(sessionId)`. The cwd chain keeps its documented order (attached header, caller summary, controller inspection, host process cwd); an inspection that refuses the session falls through to the host process cwd instead of failing the request, because a sidebar request for an unknown session must not answer 500.
- `sidechat.start` passes `inheritedEventCount: SessionLogOffset(inheritance.seed.length)` when creating the seeded child: the parent-derived prefix is the inherited portion, and the descriptor event the child appends is its own first row. The harness's subagent address fence rejects a descriptor whose seq sits below the child's inherited event count (`packages/api/session-controller/src/history.ts`), so the count must stop before it.

## Alternatives considered

**Hide the two panel toggles and keep the row mounted.** Not available: the toggles are the only entry to the panels (see the [removal note](../../archived/architecture/2026-09-10-desktop-without-workspace-sidebar.md)), so the panels would become unreachable.

**Insert the row without repairing the transports.** Rejected: the terminal is the primary reason the workbench is wanted, and a mounted terminal that cannot connect reads as a broken product rather than a missing feature.

**Keep `sessionPersistence` and ask the harness for an `inspect` member.** Rejected: `ctx.sessionController.inspect` already answers the same question and additionally sees attached sessions, so reviving a second inspection surface would duplicate the authority.

**Let the cwd chain fail loudly when inspection refuses the session.** Rejected: the chain exists so a detached first request still resolves the right project; a stale tab or a deleted session would otherwise turn every sidebar route into a 500.

## Consequences

The desktop app carries the code workbench again: the bottom panel, the right workbench, the `/sidebar/*` routes, the host-registered `sidebar_open` and opt-in `terminal_*` tools, and the sidebar's `交付物` turn-tail interception. The desktop product's previous negative guarantee — no workbench, no sidebar routes, no sidebar tools — no longer holds.

The two repairs apply wherever the sidebar mounts, not only on desktop: the terminal was unreachable in `dsh web` too, and the cold-session cwd fallback answered 500 there for the same reason.

Both defects were fork-local, introduced with the first-party port; upstream does not carry them, so an upstream sync meets the fix as a divergence rather than a conflict.

`packages/client/better-sidebar/README.md` and the desktop composition comment name the mount state; the [`2026-08-28` adoption note](2026-08-28-adopt-better-sidebar-first-party.md) no longer claims the desktop omits the row.

## Testing

`npx vitest run packages/client/better-sidebar` (1725 tests) pins the new behavior: the terminal request carries `duplex: 'half'`; the seeded child creation carries `inheritedEventCount === seed.length - 1`; the cwd chain resolves a cold session through the controller, rejects a relative inspected cwd, and falls back to the host process cwd both when the controller reports no cwd and when it refuses the session. `npx vitest run apps/desktop-host apps/desktop` (135 tests) stays green.

Manual end-to-end run of `pnpm run dev:desktop` over the desktop renderer (CDP): the sidebar mounts with its panel host and toggles, the explorer lists the session's workspace, a Markdown file opens in the preview, the terminal connects and runs `echo` against a real shell, and a terminal request for a detached session with no cwd resolves the persisted cwd (`/Users/xujian/.sati/自媒体运营`) instead of answering 500. Thread creation through `sidechat.start` was not exercised against a live parent: the side chat requires a running parent agent, and the verification home held no model credential.

## Related

- [Desktop composition without the workspace sidebar](../../archived/architecture/2026-09-10-desktop-without-workspace-sidebar.md) — the removal this change reverses.
- [Adopt better-sidebar first-party](2026-08-28-adopt-better-sidebar-first-party.md) — why the package is first-party and how it reaches desktop releases.
- [Desktop portless push transport](2026-09-09-desktop-portless-push-transport.md) — the fetch streaming transport the terminal uses.
