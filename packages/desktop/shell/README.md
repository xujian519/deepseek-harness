# @deepseek-ai/dsh-desktop-shell

English | [中文](README.zh.md)

The **Electron-main bridge provider** for the [`ctx.desktop`](../desktop/README.md) capability seam. `DesktopShell` is a Cordis Service Provider that reads `DSH_DESKTOP_BRIDGE_PATH` from its environment, connects to the Electron main process over a local socket through [`BridgeClient`](./src/bridge-client.ts), and registers `ctx.desktop`. If the bridge path is absent, the plugin loads but `ctx.desktop` is unavailable and every method rejects with `DesktopError('bridge-disconnected')`; this lets the same bundle start in tests without Electron.

## Model Experience

None, as this package only bridges `ctx.desktop` calls to Electron Main and registers no prompt text, tool schema, or model result.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Main-process stubs** — the bridge server in Electron Main currently wires `showOpenDialog` and `showSaveDialog` to Electron's `dialog` API. Notifications, menus, global shortcuts, and drag-and-drop are stubbed and must be implemented in Main; the tray exists as a static Main-process icon, and the programmable `setTray` bridge contract is still a stub.
- **No automatic reconnection** — `desktop/bridge-lost` is emitted when the socket closes, but the provider does not retry the connection; lifecycle recovery is owned by the Electron main process.
- **Single backend connection** — the bridge server accepts one concurrent backend socket and rejects additional connections.
