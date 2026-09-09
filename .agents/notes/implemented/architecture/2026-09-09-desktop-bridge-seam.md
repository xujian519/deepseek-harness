# Agent Note: Desktop bridge seam and the seam package rename

Status: implemented

English | [中文](2026-09-09-desktop-bridge-seam.zh.md)

## Problem

The desktop composition must reach shell-owned OS capabilities — dialogs, notifications, application-menu items, global shortcuts, and tray customization — from backend plugins, and the desktop-patent shell already proved a JSON-RPC bridge design for it. Consolidating that bridge into the official shell hit a blocker: the `ctx.desktop` Service Definition package was named `@deepseek-ai/dsh-desktop`, the exact name upstream v0.1.5 gives the official Electron shell, so workspace resolution handed the backend the shell's `main.js` and its Electron imports crashed the host process.

## Decision

The Service Definition package is renamed `@deepseek-ai/dsh-desktop-seam`; the official shell keeps `@deepseek-ai/dsh-desktop`. The bridge server runs in Electron Main and owns a Unix socket (or Windows named pipe) named per pid in the OS temp directory — a repository-nested userData path exceeds the ~104-byte Unix socket path cap in development, and stale sockets from dead processes are unlinked at startup. The host child receives the path once, at boot, as `DSH_DESKTOP_BRIDGE_PATH` through its otherwise-scrubbed environment. The socket accepts exactly one backend connection: a second is closed immediately, which makes host restarts and the client's reconnect-and-replay safe. The bridge holds no authentication; the peer is the shell's own child process, so the single-connection rule is the boundary, and the tray instance stays owned by the shell — the bridge receives it for tooltip, context-menu, and click-notification customization only. Backend-registered menu groups rebuild the application menu behind the shell's own base entries, which the shell supplies as a template. The desktop composition gains a `desktop-shell` row through the host overlay; the Electron-dialog directory picker stays out of the default composition, which keeps the native picker.

## Alternatives considered

**Carrying bridge traffic over the lifecycle IPC or the framed byte pipes.** Both channels are versioned and purpose-built (child lifecycle, Fetch transport); mixing OS-control traffic into them couples unrelated protocols and widens the pipe trust surface.

**Letting the bridge create its own tray.** Two tray instances would fight over the status item; the shell must show a tray before the backend connects, so ownership stays with the shell and the bridge receives the instance.

**Keeping the Service Definition name and renaming the official shell.** The upstream name is owned by the official shell; every future sync would fight the rename.

## Consequences

Backend plugins call `ctx.desktop` methods and receive `desktop/*` events; a missing bridge path degrades to warn-only, keeping headless compositions bootable. The seam rename is source-compatible for consumers who follow the package, and the channel test plus the bridge suite cover the aggregate, allow-list, tray handover, and menu baselines.
