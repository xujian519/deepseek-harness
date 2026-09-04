---
description: "The dsh desktop-surface bundle. [`cordis.patch.yml`](cordis.patch.yml) rides over [`dsh-web-app`](../web-app/README.md): it restates the web runtime values for the desktop profile, inserts this package's `desktop-runtime` glue plugin, mounts the desktop shell service (`@deepseek-ai/dsh-desktop-shell`), pins `openBrowser: false` so the Electron window stays the sole UI viewer, and disables the web runtime's auto directory chooser in favor of the Electron-dialog provider (`@deepseek-ai/dsh-desktop-directory-picker`) paired with the native client surface (`@deepseek-ai/dsh-client-ui-directory-picker-native`) that drives `host.pickDirectory`. The desktop profile (`dsh --profile desktop`) stacks `dsh-base`, `dsh-web-app`, and this bundle."
kind: "package-bundle"
---

# `@deepseek-ai/dsh-desktop-app`

English | [中文](README.zh.md)

## Summary

The dsh desktop-surface bundle. [`cordis.patch.yml`](cordis.patch.yml) rides over [`dsh-web-app`](../web-app/README.md): it restates the web runtime values for the desktop profile, inserts this package's `desktop-runtime` glue plugin, mounts the desktop shell service (`@deepseek-ai/dsh-desktop-shell`), pins `openBrowser: false` so the Electron window stays the sole UI viewer, and disables the web runtime's auto directory chooser in favor of the Electron-dialog provider (`@deepseek-ai/dsh-desktop-directory-picker`) paired with the native client surface (`@deepseek-ai/dsh-client-ui-directory-picker-native`) that drives `host.pickDirectory`. The desktop profile (`dsh --profile desktop`) stacks `dsh-base`, `dsh-web-app`, and this bundle.

No runtime invariant companion is published; the bundle patch and glue plugin hold no mutable state of their own, and every contribution lands in an owning registry.


## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Model Experience

None, as the glue plugin holds the composition seat without contributing model-visible text; the web-surface prompt and `DSH_WEB_URL` runtime variable are owned by [`dsh-web-app`](../web-app/README.md), which this bundle layers over unchanged.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **The desktop bridge surface is partial** — the shell service (`ctx.desktop`) and the Electron directory picker are landed; the Main-process bridge methods for menu, tray, global shortcuts, and notifications are still stubs, and the push-event chain (`desktop/menu-activated`, `desktop/tray-clicked`, …) has no caller yet. Further `packages/desktop/*` plugins fill these seats.

### Dev Note

None.
