---
description: "The **Electron-main bridge provider** for the [`ctx.desktop`](../desktop/README.md) capability seam. `DesktopShell` is a Cordis Service Provider that reads `DSH_DESKTOP_BRIDGE_PATH` from its environment, connects to the Electron main process over a local socket through [`BridgeClient`](./src/bridge-client.ts), and registers `ctx.desktop`. If the bridge path is absent, the plugin loads but `ctx.desktop` is unavailable and every method rejects with `DesktopError('bridge-disconnected')`; this lets the same bundle start in tests without Electron."
kind: "package-reference"
---

# @deepseek-ai/dsh-desktop-shell

English | [中文](README.zh.md)

## Summary

The **Electron-main bridge provider** for the [`ctx.desktop`](../desktop/README.md) capability seam. `DesktopShell` is a Cordis Service Provider that reads `DSH_DESKTOP_BRIDGE_PATH` from its environment, connects to the Electron main process over a local socket through [`BridgeClient`](./src/bridge-client.ts), and registers `ctx.desktop`. If the bridge path is absent, the plugin loads but `ctx.desktop` is unavailable and every method rejects with `DesktopError('bridge-disconnected')`; this lets the same bundle start in tests without Electron.

No runtime invariant companion is published; the provider deliberately loads without DSH_DESKTOP_BRIDGE_PATH so tests and headless boots can compose the same bundle, and a disconnected bridge is reported through typed DesktopError('bridge-disconnected') failures at the call boundary.


## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Model Experience

None, as this package only bridges `ctx.desktop` calls to Electron Main and registers no prompt text, tool schema, or model result.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **File drops deferred** — `desktop/file-dropped` stays a contract event with no Main-side emitter: window-level drops do not reach Electron Main, and the web surface already handles in-app drops (the workspace surface's `acceptDrop`). A renderer drop channel would widen the sandboxed preload surface and is deferred with that work.
- **Single backend connection** — the bridge server accepts one concurrent backend socket and rejects additional connections; reconnection is client-driven with exponential backoff and live-registration replay.

### Dev Note

None.
