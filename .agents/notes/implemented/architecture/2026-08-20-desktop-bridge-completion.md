# Agent Note: Complete the ctx.desktop bridge

Status: implemented

English | [中文](2026-08-20-desktop-bridge-completion.zh.md)

## Problem

The `ctx.desktop` capability seam declared a full contract (dialogs, notifications, menus, global shortcuts, tray, six events), but Electron Main implemented only the dialogs and the shell provider never reconnected after a bridge loss. The advertised capabilities did not match behavior.

## Decision

**Main side** (`apps/desktop/src/bridge-server.ts`): notifications now post through Electron's `Notification` API and echo clicks back as `desktop/notification-clicked`; a menu model maps registered groups to application menus and the tray's configured group (default `'tray'`) to the tray context menu; global shortcuts register through Electron with conflicts surfacing as JSON-RPC errors; `setTray`/`clearTray` rebuild the tray tooltip and menu; tray clicks push `desktop/tray-clicked`. `main.ts` delegates tray creation to the bridge.

**Contract** (`packages/desktop/desktop`): `registerMenuItem`, `registerGlobalShortcut`, and `setTray` became async so placement failures (a claimed accelerator, no tray) surface to callers; `DesktopNotification` carries an optional `id` echoed on click; `DesktopTrayConfig` carries an optional `menuGroup`.

**Resilience** (`packages/desktop/shell`): `BridgeClient` reconnects with bounded exponential backoff after an unexpected close, and the shell replays its live menu/shortcut/tray registrations. A first-connect failure still reports a bridge loss; reconnect attempts do not.

**`desktop/file-dropped` stays deferred**: window-level drops do not reach Electron Main, the web surface already handles in-app drops, and a renderer channel would widen the sandboxed preload surface.

## Consequences

The shell's advertised desktop capabilities match behavior; a Main restart no longer orphans the backend's registrations; shortcut and tray failures are observable instead of silent.

## Alternatives considered

- Keeping the registration methods fire-and-forget to preserve sync disposers: rejected — shortcut conflicts and tray absence are real failures callers must see.
- Implementing `desktop/file-dropped` via a preload channel: rejected — it widens the sandboxed renderer surface for a use case the web surface already serves.
