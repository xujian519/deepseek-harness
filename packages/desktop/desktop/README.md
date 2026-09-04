---
description: "The **Service Definition** for the `ctx.desktop` capability seam: OS-level desktop integration exposed to the dsh backend through the Electron main process. It declares typed methods (`showOpenDialog`, `showSaveDialog`, `sendNotification`, `registerMenuItem`, `registerGlobalShortcut`, `setTray`) and Cordis events (`desktop/menu-activated`, `desktop/shortcut-triggered`, `desktop/tray-clicked`, `desktop/file-dropped`, `desktop/notification-clicked`, `desktop/bridge-lost`). Registration methods are asynchronous and reject when the bridge cannot place the item (an accelerator already claimed, a tray unavailable). Providers such as [`@deepseek-ai/dsh-desktop-shell`](../shell/README.md) implement this seam; consumers (`@deepseek-ai/dsh-desktop-directory-picker`, tools, commands) use `ctx.desktop` without depending on Electron."
kind: "package-reference"
---

# @deepseek-ai/dsh-desktop

English | [中文](README.zh.md)

## Summary

The **Service Definition** for the `ctx.desktop` capability seam: OS-level desktop integration exposed to the dsh backend through the Electron main process. It declares typed methods (`showOpenDialog`, `showSaveDialog`, `sendNotification`, `registerMenuItem`, `registerGlobalShortcut`, `setTray`) and Cordis events (`desktop/menu-activated`, `desktop/shortcut-triggered`, `desktop/tray-clicked`, `desktop/file-dropped`, `desktop/notification-clicked`, `desktop/bridge-lost`). Registration methods are asynchronous and reject when the bridge cannot place the item (an accelerator already claimed, a tray unavailable). Providers such as [`@deepseek-ai/dsh-desktop-shell`](../shell/README.md) implement this seam; consumers (`@deepseek-ai/dsh-desktop-directory-picker`, tools, commands) use `ctx.desktop` without depending on Electron.

Menu items registered under the tray's configured menu group (`'tray'` by default, overridable through `DesktopTrayConfig.menuGroup`) populate the tray context menu; other groups become top-level application menus. `DesktopNotification.id` is echoed back in `desktop/notification-clicked` when a notification is clicked; the provider mints one when absent.

No runtime invariant companion is published; the package declares the ctx.desktop Service Definition as pure types plus a closed error vocabulary and owns no runtime state to observe, and providers assert their own bridge state through typed DesktopError failures at the call boundary.


## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Model Experience

None, as this package only defines the `ctx.desktop` capability seam and registers no prompt text, tool schema, or model result.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **File drops deferred** — `desktop/file-dropped` has no Main-side emitter yet (window-level drops do not reach Electron Main; the web surface handles in-app drops itself). A renderer drop channel would widen the sandboxed preload surface and is deferred with that work.
- **Event payload scope** — payloads are intentionally narrow; richer UI state (menu checked/unchecked, tray icons, notification actions) requires future contract revisions.

### Dev Note

None.
