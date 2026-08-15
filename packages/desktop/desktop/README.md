# @deepseek-ai/dsh-desktop

English | [中文](README.zh.md)

The **Service Definition** for the `ctx.desktop` capability seam: OS-level desktop integration exposed to the dsh backend through the Electron main process. It declares typed methods (`showOpenDialog`, `showSaveDialog`, `sendNotification`, `registerMenuItem`, `registerGlobalShortcut`, `setTray`) and Cordis events (`desktop/menu-activated`, `desktop/shortcut-triggered`, `desktop/tray-clicked`, `desktop/file-dropped`, `desktop/notification-clicked`, `desktop/bridge-lost`). Providers such as [`@deepseek-ai/dsh-desktop-shell`](../shell/README.md) implement this seam; consumers (`@deepseek-ai/dsh-desktop-directory-picker`, tools, commands) use `ctx.desktop` without depending on Electron.

## Model Experience

None, as this package only defines the `ctx.desktop` capability seam and registers no prompt text, tool schema, or model result.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Skeleton only** — the Service Definition specifies the contract; actual Electron API integrations live in the provider packages and Electron Main.
- **Event payload scope** — payloads are intentionally narrow; richer UI state (menu checked/unchecked, tray icons, notification actions) requires future contract revisions.
