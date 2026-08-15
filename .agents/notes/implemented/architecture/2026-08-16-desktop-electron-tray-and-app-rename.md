# Agent Note: Desktop Electron Tray and App Package Rename

Status: implemented

English | [中文](2026-08-16-desktop-electron-tray-and-app-rename.zh.md)

## Problem

The desktop shell shipped without branded assets or a system tray, and its app workspace shared the package name `@deepseek-ai/dsh-desktop` with the new Service Definition, so pnpm `--filter` matched two workspaces and the desktop packaging scripts failed.

## Decision

### Assets

Adopt the icon set from `steven-kid/deepseek-harness-desktop` (MIT) into `apps/desktop/assets/`. electron-builder.yml wires the macOS, Windows, and Linux application icons. The tray PNGs are packaged inside `app.asar`.

### System tray

Add a system tray in Electron Main:

- macOS uses `trayTemplate.png` as a template image; other platforms use `tray.png`.
- Closing the last window hides it while the tray exists; quitting from the tray menu sets a quit flag and exits.
- The tray menu offers Show and Quit.
- Platform decisions (icon file, template flag, hide-on-close) live in `src/tray.ts` and are unit tested without an Electron host.

### App package rename

Rename the Electron app workspace from `@deepseek-ai/dsh-desktop` to `@deepseek-ai/dsh-desktop-electron`. The Service Definition keeps `@deepseek-ai/dsh-desktop`; the bundle keeps `@deepseek-ai/dsh-desktop-app`.

## Alternatives considered

**Rename the Service Definition instead.** Rejected: the Service Definition is the canonical seam name referenced by catalogs and consumers.

**Rename the app to `@deepseek-ai/dsh-desktop-app`.** Rejected: that name is already the desktop bundle.

**Skip the tray and use only the app icon.** Rejected: the user requested the full tray behavior.

## Consequences

- `apps/desktop/assets/` contains the nine adopted asset files.
- electron-builder.yml wires the app icons and packages the tray PNGs.
- Electron Main creates a tray and keeps the app alive when the window is closed.
- The app workspace is `@deepseek-ai/dsh-desktop-electron`; root scripts, workspace constraints, and app docs were updated in the same change.
- `src/tray.ts` and its tests cover the platform decisions.

## Remaining risks

- The tray could not be launched in a headless sandbox; behavior is verified by unit tests and by inspecting the packaged `app.asar`, not by a live GUI session.
- `nativeImage.createFromPath` reads the tray icon from inside `app.asar`; a real GUI launch should confirm the tray renders.
