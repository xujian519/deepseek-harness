# Agent Note: Desktop shell tray, print-to-PDF, and preload chunk limit

Status: implemented

English | [中文](2026-09-09-desktop-shell-tray-and-print.zh.md)

## Problem

The desktop shell had no tray and no printing, both of which the consolidated shell must carry. The print capability also has an established client contract: the Web UI detects `window.desktop.printHtmlToPdf` and degrades when it is absent, so the shell must expose the bridge under that exact name. Finally, extending a preload with a shared import silently broke every preload bridge, which needed a structural rule before more preload code lands.

## Decision

The shell owns a system tray built from the repository `assets/` icons: macOS uses the template image, the context menu carries locale-owned Show and Quit entries, and closing the last window hides the application while a tray exists and no quit started. Printing is the hidden-window HTML-to-PDF helper; the main renderer validates the closed channel (non-empty HTML, 4 MiB ceiling, string suggested name) before the print window runs, and the bridge is exposed as `window.desktop`, the name the client's `DesktopPrintBridge` contract already detects; the `dshDesktop` protocol marker stays for the carrier check.

Electron sandboxed preloads cannot require a shared chunk: tsdown splits shared modules across multiple entries, one `require("./ipc-*.cjs")` inside a preload fails, and Electron skips the whole preload with no visible error. Each preload therefore imports its channels from a single-owner file (`channels-app.ts` for the main renderer, `channels-shell.ts` for the plugin window), which rollup inlines into that entry, and `ipc.ts` aggregates both files so the main process registers handlers on the same names. A channel test locks the aggregate to the two sources.

## Alternatives considered

**Exposing the print bridge as `window.dshDesktop.printHtmlToPdf`.** The client UI would need a second feature-detect name; the existing `window.desktop` contract is the single surface the renderer already probes.

**Disabling chunk splitting in the bundler.** tsdown 0.22 has no JS splitting switch, and rollup always extracts modules shared by multiple entries; single-owner channel files avoid the shared module entirely.

## Consequences

Closing the last window keeps the application in the tray and the tray Show entry restores it; the menu and tooltip copy follows the packaged product name. The full save-dialog pass requires a human click and stays covered by the helper's unit tests, while the IPC validation paths (invalid payload, empty HTML, size ceiling) are exercised end to end in the development shell.
