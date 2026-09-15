# Agent Note: The desktop shell owns the platform editing surface through menu roles

Status: implemented

English | [中文](2026-09-15-desktop-shell-edit-menu-role.zh.md)

## Problem

The Electron shell installed a single-menu application template in [`apps/desktop/src/main.ts`](../../../../apps/desktop/src/main.ts) carrying only Plugins, Check for Updates, and Quit. Electron does not wire the platform editing accelerators on its own: on macOS Cmd+C, Cmd+V, Cmd+X, Cmd+A, and Cmd+Z reach a focused webContents only through NSMenu entries registered by `role: 'editMenu'`, so the desktop shell silently lost copy/paste everywhere except native form controls. Windows and Linux keep the accelerator path for editable fields through Chromium's internal bindings but lose it on read-only selections — the chat transcript and code blocks the product is built around.

The same shell had no `webContents.on('context-menu', ...)` listener, so right-click yielded nothing on any platform. `setWindowOpenHandler(() => ({ action: 'deny' }))` and a `will-navigate` handler that called `preventDefault()` on every non-`dsh-app:` URL together dropped every external link click with no fallback to `shell.openExternal`.

A fourth gap sat on the bridge: [`BridgeServer.registerGlobalShortcut`](../../../../apps/desktop/src/bridge-server.ts) forwarded any accelerator a backend plugin asked for to `globalShortcut.register`, which claims the binding system-wide. A plugin registering `Cmd+C` would have stolen copy from every other application on the desktop until the shell unloaded it.

The pre-existing test suite did not catch any of this. [`apps/desktop/tests/bridge-server.spec.ts`](../../../../apps/desktop/tests/bridge-server.spec.ts) asserted only the first menu entry's label and the rebuild counter, and [`main-startup.spec.ts`](../../../../apps/desktop/tests/main-startup.spec.ts) never emitted `context-menu` or invoked the captured `setWindowOpenHandler` callback.

## Decision

- **The base application menu carries the platform editing, view, and window roles.** `appMenuTemplate` in `main.ts` appends `{ role: 'editMenu' }`, `{ role: 'viewMenu' }`, and `{ role: 'windowMenu' }` after the shell-owned application menu. `BridgeServer.setAppMenuBase` receives the same template, so backend-registered menu groups sit alongside the roles rather than replacing them. Locale-owned copy does not apply: Electron supplies the localized labels for role entries.
- **Each `BrowserWindow` draws its own context menu from the pointer state.** `createWindow` attaches a `context-menu` listener that builds `{ role: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll' }` for an editable target, `{ role: 'copy' | 'selectAll' }` for a non-empty selection, and no menu at all otherwise. An empty popup would appear as a blank rectangle; the listener stays silent so the platform treats the right-click as unhandled.
- **Renderer-initiated external navigation hands off to the OS browser.** A module-local `openExternalIfHttp` accepts only `http:` and `https:` URLs and calls `shell.openExternal`. Both `setWindowOpenHandler` and `will-navigate` route through it, so `target=_blank`, `window.open`, and plain `<a href="https://...">` all reach the user's default browser. Other schemes stay denied: the shell never opens a second `BrowserWindow`, and `dsh-recovery:` keeps its dedicated handling in `will-navigate`.
- **The bridge refuses accelerators that own the platform editing surface.** `RESERVED_ACCELERATOR_PATTERN` in `bridge-server.ts` matches `CmdOrCtrl | Cmd | Command | Ctrl | Control` optionally followed by `Shift | Alt | Option` and one of `C V X A Z`. `registerGlobalShortcut` throws before touching `globalShortcut.register`, so the refusal lands before any OS-side claim exists to unwind. Other editing keys — arrows, Home/End, Delete, function keys — stay available because the shell menu does not claim them system-wide.

## Alternatives considered

- **Adopt `electron-context-menu` for the pointer path.** Rejected: the dependency would widen the desktop shell's runtime surface for behavior that four role entries already cover. [Dependency policy](../process/2026-07-26-dependencies-over-hand-rolling.md) prefers maintained packages only when they genuinely delete owned code and tests; here the owned code is one module-local helper and one `context-menu` listener, and the owned tests are a handful of `it` blocks — small enough that the dependency would add more surface than it removes.
- **Intercept `keydown` in the renderer and call `navigator.clipboard` directly.** Rejected: it bypasses the native menu path, so macOS users get no menu-item highlight, no visible accelerator beside the label, and no system-provided localization; it also duplicates behavior Chromium already exposes through role entries.
- **Refuse every accelerator that collides with a menu role.** Rejected: menu roles reserve dozens of accelerators (F5, F11, Cmd+M, Cmd+W, and more), and a broad refusal would break legitimate plugin bindings for window and view controls that a plugin may want to trigger from the backend. The refusal instead targets two narrow families: the five letter bindings (C/V/X/A/Z) under a primary Cmd/Ctrl/Super/Meta modifier, and the Windows traditional editing keys (Insert/Delete) under any modifier stack. `Shift+C` stays available because it is just an uppercase C, not a clipboard operation.
- **Handle file drops in the same pass.** Deferred: `desktop/file-dropped` remains without a Main-side emitter, as [desktop-seam README](../../../../packages/desktop/desktop-seam/README.md) already records. Wiring drops requires a renderer-side drop channel that widens the sandboxed preload surface and belongs to its own change.

## Consequences

The desktop menu bar now shows Application, Edit, View, and Window on macOS, and the equivalent top-level menus on Windows and Linux. Every accelerator the platform reserves for those roles works against the focused webContents, including the chat transcript and code blocks that had no clipboard path before. Right-click yields the standard editing popup on editable fields and a copy-only popup on selections. External links open in the OS browser instead of disappearing.

Backend plugins that previously reserved a letter editing binding (`Cmd+C`, `Cmd+V`, `Cmd+X`, `Cmd+A`, `Cmd+Z`, or any modifier stack on top of them) or a Windows traditional editing key (`Ctrl+Insert`, `Shift+Insert`, `Shift+Delete`) through `ctx.desktop.registerGlobalShortcut` now receive a rejected promise carrying `accelerator ${value} is reserved for system editing`. No plugin in this repository registers one of those accelerators today; the refusal is a forward-looking guard.

## Testing

[`apps/desktop/tests/main-startup.spec.ts`](../../../../apps/desktop/tests/main-startup.spec.ts) adds six cases: the installed application menu contains `editMenu`, `viewMenu`, and `windowMenu`; `setWindowOpenHandler` denies the window and forwards `https:` to `shell.openExternal` while leaving `dsh-app:` inside the shell; `will-navigate` for an external URL both prevents default and forwards to the OS browser; a `context-menu` event with a non-empty selection builds a copy-only popup and calls `popup({ window })`; the same event with `isEditable: true` builds the full editing popup; and an empty selection over a non-editable target builds nothing. The harness captures `Menu.buildFromTemplate` results, `Menu.setApplicationMenu` templates, `shell.openExternal` calls, and the `setWindowOpenHandler` callback so tests read them directly rather than inferring from mock counts.

[`apps/desktop/tests/bridge-server.spec.ts`](../../../../apps/desktop/tests/bridge-server.spec.ts) adds two parameterized cases. The first walks fourteen reserved accelerators — `Cmd+C`, `Cmd+V`, `Cmd+X`, `Cmd+A`, `Cmd+Z`, `CmdOrCtrl+Shift+Z`, `Ctrl+V`, `Control+Alt+C`, `Cmd+Shift+Alt+C`, `Super+V`, `Meta+X`, `Ctrl+Insert`, `Shift+Insert`, `Shift+Delete` — and asserts both the JSON-RPC error and that `globalShortcut.register` was never reached. The second walks six accepted accelerators — `Shift+C`, `Alt+F4`, `Cmd+K`, `Ctrl+P`, `F5`, `Insert` — and asserts the registration succeeds, guarding the pattern against over-broad refusal.

## Related

[Client UI copy is locale-owned](2026-08-23-locale-owned-client-ui-copy.md) explains why the role entries bypass the desktop `messages` dictionary: Electron, not the shell, supplies their localized labels. The [desktop-seam README](../../../../packages/desktop/desktop-seam/README.md) records the still-deferred `desktop/file-dropped` emitter that this change does not touch.
