# Agent Note: Re-port the desktop shell surface onto the desktop composition overlay

Status: implemented

English | [中文](2026-09-18-desktop-shell-surface-after-the-sync.zh.md)

## Problem

The [upstream sync](../process/2026-09-18-upstream-v0.1.6-alpha.2-sync.md) took upstream's desktop rewrite, which replaced the composition: `apps/desktop-host/config/desktop.cordis.patch.yml` was deleted, `runProfile` was called with `patchFiles: []`, and `main.ts` was rebuilt around an authenticated loopback Web document. The fork's shell surface went with it — the `ctx.desktop` provider had no Loader row, the Electron bridge had no server (so tray customization, plugin menus, global shortcuts, and notifications were unreachable), and `print.ts` had neither an IPC channel nor a preload exposure, leaving the Web UI's `window.desktop.printHtmlToPdf` probe to the browser print dialog.

Two facts constrain the re-port. The application window is served the same Web UI over `dsh-app://app`, a protocol handler that reads the packaged dist and forwards every other request to the Host's authenticated loopback URL, so `assertDesktopSender(event, ['app'])` already admits the Web renderer. And the profile resolution table carries only names reachable from its anchor's dependency closure, while the Host anchors on the dsh CLI package — whose closure holds none of the desktop-only mounts.

## Decision

The surface returns as a composition overlay plus Electron-side wiring, not as a revived portless transport.

- `apps/desktop-host/config/desktop.cordis.patch.yml` is the desktop composition: it mounts `desktop-shell` (the `ctx.desktop` provider) and `macos-tools` (gated to darwin), and keeps `better-sidebar` named but disabled per the [sidebar decision](2026-09-15-desktop-unmounts-workspace-sidebar.md). Every other row is the Web surface unchanged: the pre-sync disables of `webserver`, `web-runtime`, `web-startup`, `synapse`, `client-hmr`, and the directory picker belong to the removed portless transport, and `directory-picker-auto` already resolves the native backend on a loopback, non-SSH host with a display.
- `ResolvedProfileRuntime.resolutionAnchor` (optional) seeds the profile resolution table; `installAnchor` keeps locating the installation for bundle resolution and package operations.
- `main.ts` owns the bridge again: it starts `BridgeServer` before spawning the Host, passes `DSH_DESKTOP_BRIDGE_PATH` through the child environment, registers the shell menu base and the tray, hides the window on close while the tray owns the application, and disposes the bridge with the quit sequence.
- Print-to-PDF returns as `dsh-desktop:print-to-pdf` behind the same owning-window and `dsh-app://app` checks as the directory picker, exposed as `window.desktop.printHtmlToPdf`.

## Alternatives considered

**Reuse the pre-sync overlay unchanged.** Rejected: its first rows disable `web-startup`, `webserver`, and `web-runtime`, which the synced Host needs to serve the application document at all.

**Point `installAnchor` at the desktop-host package instead of adding a second anchor.** Rejected: the plugin manager parses that path as the installation manifest and resolves bundles and core packages through it, so the desktop profile would lose its core package resolution.

**Mount the shell packages by path in the overlay.** Rejected: the overlay names Loader rows, and the resolution table is what makes a name importable.

## Consequences

The desktop application carries the shell surface again: plugin menus, tray entries, global shortcuts, notifications, and native PDF export. The `ctx.desktop` provider still loads without `DSH_DESKTOP_BRIDGE_PATH` and rejects every method with `DesktopError('bridge-disconnected')`, so headless and test boots compose the same overlay.

The single-anchor rule gains one documented exception: an application whose overlay mounts packages outside its installation's closure names its own package as the resolution anchor. Applications that omit the field keep the previous resolution exactly.

`better-sidebar` is a desktop composition row again, so the package must stay declared by the Host for the row to resolve if a later layer re-enables it.
