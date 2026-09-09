# Agent Note: macOS native tools in the official desktop composition

Status: implemented

English | [中文](2026-09-09-desktop-macos-tools.zh.md)

## Problem

The official desktop shell (`apps/desktop` plus the private `apps/desktop-host` process) composes the browser `web-app` bundle and the host overlay patch; it does not use the `desktop-app` bundle that the patent shell mounts. As a result the model-facing macOS native tools package (`@deepseek-ai/dsh-macos-tools`) never reached the official desktop, even though the desktop profile owns the native shell surface and the model would otherwise call these tools through system CLIs.

## Decision

Add `@deepseek-ai/dsh-macos-tools` to the desktop-host's package dependencies and insert a `macos-tools` row in the `desktop.cordis.patch.yml` host overlay, gated to darwin (`disabled: !!js process.platform !== 'darwin'`). The overlay already inserts the desktop-shell provider and the native directory picker, so the tools row lands beside them at the same composition layer. Every executable macos-tools spawns is macOS-specific, so the gate keeps non-darwin desktop builds from loading it.

## Alternatives considered

**Mount it through the `desktop-app` bundle.** The official shell composes `web-app` and the overlay, not that bundle; reusing it would drag in the patent shell's extra rows and its `dsh-desktop-app` bundle dependency.

**Gate it at the package level.** The platform check belongs at the composition layer where the row is declared, so a non-darwin build never resolves the row at all.

## Consequences

On darwin the desktop model sees the seven `macos_*` tools (open/reveal, browser URLs, clipboard, notifications, speech, app control). Host effects beyond the session resolve one-time approval through `ctx.approval` and fail closed when no channel answers, so a composition without an approval service still boots. The bundle README's "mounts it on darwin only" now also describes the official desktop.
