---
description: "The desktop group map: the Desktop OS-integration Service Definition, the Electron shell provider, and the directory-picker bridge that keep the renderer sandboxed while dialogs, notifications, and tray stay native."
kind: "package-group"
---

# packages/desktop

English | [中文](README.zh.md)

## Summary

The desktop group owns the Desktop OS-integration seam (`ctx.desktop`): the `desktop` package declares the service, the Electron main process in `apps/desktop` owns the native side (dialogs, notifications, menus, global shortcuts, tray, drag-and-drop), and `shell` bridges the two over a local JSON-RPC socket so the renderer stays sandboxed. `directory-picker` registers the Electron-backed workspace-directory chooser on the backend half of the same bridge. The desktop profile composes these through the `desktop-app` bundle; nothing in the group talks to the network.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | Service |
|---|---|---|
| [`desktop/`](desktop/README.md) | `Desktop` Service Definition: dialogs, notifications, menus, shortcuts, tray contracts. | `desktop` |
| [`shell/`](shell/README.md) | Electron-side provider: bridges native capabilities to the backend over a local socket. | (provider) |
| [`directory-picker/`](directory-picker/README.md) | Registers the Electron workspace-directory chooser on the backend bridge. | (provider) |

## Related documentation

- [Desktop subsystem](../../docs/subsystems/desktop.md) — bridge protocol, lifecycle, and packaging contracts.

## Dev Note

None.
