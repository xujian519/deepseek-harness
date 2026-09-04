---
description: "An **Electron-backed provider** for the `ctx.directoryPicker` seam. It exposes a new `electron` capability kind and delegates directory selection to `ctx.desktop.showOpenDialog({ properties: ['openDirectory'] })`. This lets the desktop shell reuse the existing directory-picker contract while opening the OS native chooser through Electron Main."
kind: "package-reference"
---

# @deepseek-ai/dsh-desktop-directory-picker

English | [中文](README.zh.md)

## Summary

An **Electron-backed provider** for the `ctx.directoryPicker` seam. It exposes a new `electron` capability kind and delegates directory selection to `ctx.desktop.showOpenDialog({ properties: ['openDirectory'] })`. This lets the desktop shell reuse the existing directory-picker contract while opening the OS native chooser through Electron Main.

The browser half of this package is intentionally absent: the desktop shell displays the Web UI through its own renderer, and the same backend code runs in both contexts. Only the desktop profile mounts this provider; browser and headless profiles keep their existing directory-picker implementations.

No runtime invariant companion is published; the provider owns no state — it delegates every pick to ctx.desktop.showOpenDialog and converts the response to the directory picker's string | null contract at the call boundary.


## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Model Experience

None, as this package only opens a native directory chooser on behalf of the GUI host and registers no prompt text, tool schema, or model result.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Requires `ctx.desktop`** — the provider throws at load if no `ctx.desktop` implementation is mounted; the desktop bundle must therefore mount `@deepseek-ai/dsh-desktop-shell` before this package.
- **Single-directory selection** — the `electron` capability returns one path (the first selected directory) or `null` on cancel. Multi-selection is not exposed through the `DirectoryPicker` contract.

### Dev Note

None.
