# Agent Note: Desktop Shell Plugins and Host Bridge

Status: proposed

English | [中文](2026-08-15-desktop-shell-plugins.zh.md)

## Problem

The desktop application needs to expose OS-level capabilities (native dialogs, notifications, menu bar, tray, global shortcuts, file drag-and-drop) to the dsh backend and to the existing Web UI without violating the security model agreed in the desktop deployment proposal:

- The Electron renderer must not access Node.js or Electron APIs directly.
- The dsh backend must not depend on Electron; the same backend runs in headless and browser deployments.
- Native behavior should be composable through Cordis plugins, just like filesystem or shell providers, rather than hardcoded in the Electron main process.

This requires a dedicated capability seam for desktop integration and a private bridge between the dsh backend process and the Electron main process.

## Proposal

### High-level shape

```
Electron Main  (owns OS APIs: dialog, Tray, Menu, globalShortcut, Notification)
     │
     │ JSON-RPC over local socket / named pipe
     │
@deepseek-ai/dsh-desktop-shell/   (Service Provider: ctx.desktop)
     │
     │ Cordis service
     │
dsh backend plugins / UI   (Consumers: ctx.desktop, ctx.directoryPicker, tools, commands)
```

The renderer participates only for events that need a UI surface: Main pushes OS events (file drop, shortcut, tray click) to the backend; the backend already forwards relevant state to the renderer through the existing HTTP/WebSocket API.

### New packages

| Package | Role | ctx key |
| --- | --- | --- |
| `packages/desktop/desktop` | Service Definition for desktop integration | `ctx.desktop` |
| `@deepseek-ai/dsh-desktop-shell` | Service Provider that bridges to Electron Main | registers `ctx.desktop` |
| `@deepseek-ai/dsh-desktop-directory-picker` | `ctx.directoryPicker` provider backed by Electron dialogs | registers `ctx.directoryPicker` |

The `packages/bundle/desktop-app` Cordis bundle mounts `dsh-web-app` plus the three packages above and any future desktop plugins.

### Bridge transport

Use a Unix domain socket on macOS and a named pipe on Windows. The path is provided to the dsh backend through the environment variable `DSH_DESKTOP_BRIDGE_PATH`.

- Electron Main creates the server before spawning the dsh child process.
- `@deepseek-ai/dsh-desktop-shell` reads `DSH_DESKTOP_BRIDGE_PATH` in `apply()` and connects.
- The protocol is JSON-RPC 2.0 with one bidirectional channel:
  - Backend → Main: method calls (`dialog/showOpenDialog`, `notification/send`, `tray/set`, etc.).
  - Main → Backend: notifications (`shortcut/triggered`, `file/dropped`, `tray/clicked`, `menu/activated`).
- Only one backend connects; the socket lives in the app user-data directory with user-only filesystem permissions.

If `DSH_DESKTOP_BRIDGE_PATH` is absent, `@deepseek-ai/dsh-desktop-shell` logs a warning and does not register `ctx.desktop`. This lets the same bundle start in tests without Electron, but the desktop profile always sets the variable.

### `ctx.desktop` Service Definition

```ts
export interface DesktopService {
  /** Show a native open-file / open-directory dialog. */
  showOpenDialog(options: OpenDialogOptions): Promise<OpenDialogResult>
  /** Show a native save-file dialog. */
  showSaveDialog(options: SaveDialogOptions): Promise<SaveDialogResult>
  /** Show a system notification. */
  sendNotification(notification: DesktopNotification): void
  /** Register a menu item under a named group. Returns a disposer. */
  registerMenuItem(group: string, item: DesktopMenuItem): Disposer
  /** Register a global shortcut. Returns a disposer. */
  registerGlobalShortcut(accelerator: string, handler: () => void): Disposer
  /** Configure the tray icon and its context menu. Returns a disposer. */
  setTray(config: TrayConfig): Disposer
}
```

Events are typed Cordis events:

| Event | Direction | Payload |
| --- | --- | --- |
| `desktop/menu-activated` | Main → backend | `{ menuId: string }` |
| `desktop/shortcut-triggered` | Main → backend | `{ accelerator: string }` |
| `desktop/tray-clicked` | Main → backend | `{ button: 'left' \| 'right' }` |
| `desktop/file-dropped` | Main → backend | `{ paths: string[] }` |
| `desktop/notification-clicked` | Main → backend | `{ notificationId: string }` |

Backend plugins register handlers through `ctx.on('desktop/...', ...)`.

### `ctx.directoryPicker` Electron provider

`@deepseek-ai/dsh-desktop-directory-picker` implements the existing `DirectoryPicker` seam with a new capability kind:

```ts
{ kind: 'electron', pick(signal): Promise<string | null> }
```

It delegates to `ctx.desktop.showOpenDialog({ properties: ['openDirectory'] })` and returns the first selected path or `null` on cancel. The browser half reuses `packages/client/ui-directory-picker-native` because the user interaction shape is identical: a native OS chooser opened on behalf of the operator.

The desktop bundle therefore replaces `dsh-host-directory-picker-native` with `dsh-desktop-directory-picker` for the desktop profile, while browser and headless profiles keep their existing providers.

### Electron Main responsibilities

The Electron Main process remains a thin host:

- Create the bridge server on startup.
- Spawn the dsh backend with `DSH_DESKTOP_BRIDGE_PATH`.
- Implement bridge method handlers by calling Electron APIs:
  - `dialog.showOpenDialog` / `dialog.showSaveDialog`
  - `Notification`
  - `Menu.setApplicationMenu` / `Menu.buildFromTemplate`
  - `Tray`
  - `globalShortcut`
- Forward OS events to the backend through the same socket.
- Keep no product state in Main. Menu labels, shortcuts, and tray actions are registered dynamically by backend plugins through `ctx.desktop`.

### Renderer involvement

The renderer does not talk to Main for desktop capabilities except for events that originate in the OS window layer (e.g., HTML5 drag-and-drop). For those, the preload script exposes `desktop:fileDrop`; the renderer forwards the paths to the backend through the existing `ctx.attachments` or workspace API.

No desktop business logic lives in the renderer. Menu clicks and global shortcuts travel Main → backend → renderer through the normal session event stream, preserving the rule that **model-visible facts are logged**.

### Bundle composition

`packages/bundle/desktop-app/cordis.patch.yml` stacks over `dsh-base` and `dsh-web-app`:

- Replace the `directory-picker-native` row with `desktop-directory-picker`.
- Insert `desktop-shell` after the web runtime.
- Keep `surfaceContext` and `printUrl` behaviors from `dsh-web-app`, but the printed URL is suppressed in the packaged app (Electron logs it to its own debug channel instead).

### Lifecycle and error handling

- If the bridge connection drops, `@deepseek-ai/dsh-desktop-shell` emits `desktop/bridge-lost` and clears all dynamic registrations. Main restarts the backend if it exits.
- If a dialog call is made while the bridge is disconnected, the provider rejects with `DesktopError('bridge-disconnected')`. Consumers treat this as a transient failure.
- Main validates every incoming JSON-RPC method name against an allow list; unknown methods return a JSON-RPC error.

## Alternatives considered

**Hardcode menus and shortcuts in Electron Main and call dsh over HTTP.** This would be simpler for the first iteration, but it makes desktop capabilities inaccessible to Cordis plugins and forces product logic into the shell. Rejected because the project architecture is plugin-first.

**Use stdio IPC instead of a socket.** Stdio avoids a network path, but the dsh backend already prints logs to stdout; mixing structured IPC with logs is brittle. A dedicated socket keeps concerns separate and does not require changes to the dsh CLI entry. Rejected.

**Add a private HTTP endpoint on the dsh API gateway.** The renderer already talks HTTP, but exposing desktop operations through the same surface would blur the trust boundary and require authentication to prevent other local processes from triggering dialogs. A private socket is easier to secure by filesystem permissions. Rejected.

**Implement OS dialogs in the renderer using Electron remote or unsafe preload APIs.** This would break the security model (`contextIsolation`, `sandbox`) and allow renderer compromise to drive native dialogs. Rejected.

## Acceptance criteria

- `packages/desktop/desktop` defines `ctx.desktop` with typed methods and events.
- `@deepseek-ai/dsh-desktop-shell` connects to Electron Main over a local socket and registers `ctx.desktop`.
- `@deepseek-ai/dsh-desktop-directory-picker` provides an `electron` kind for `ctx.directoryPicker`.
- The desktop bundle can replace `directory-picker-native` and mount `desktop-shell` without changing core packages.
- Main can show a directory picker, send a notification, and receive a global-shortcut event from the backend.
- Bridge disconnection is handled and observable.

## Risks

- **Socket portability.** Named pipes on Windows behave slightly differently from Unix domain sockets; the bridge client must use Node.js `net.createConnection` with the correct path format.
- **Process ordering.** Main must create the server before spawning dsh, and the backend plugin must find the path in its environment. Race conditions during startup need explicit logging.
- **Renderer bridge surface.** Although small, the file-drop IPC channel could accept arbitrary paths from Main if Main is tricked. Main must validate dragged paths against filesystem access policy before sending them.
- **Native dialogs without a window parent.** Dialogs shown without a `BrowserWindow` parent may appear behind other windows on some platforms; pass the main window handle when available.
