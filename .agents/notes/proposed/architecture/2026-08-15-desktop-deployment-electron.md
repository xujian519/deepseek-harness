# Agent Note: Desktop Deployment with Electron

Status: proposed

English | [中文](2026-08-15-desktop-deployment-electron.zh.md)

## Problem

DeepSeek Harness needs a first-class desktop application on macOS and Windows that:

- works without a pre-installed Node.js runtime;
- reuses the existing browser UI built in `apps/web` and `packages/client/*`;
- supports both online model providers and future offline/local providers;
- exposes desktop-level affordances: application menu, Dock/taskbar tray, global shortcuts, native file dialogs, file drag-and-drop, and system notifications;
- stays within a 4 GB uncompressed bundle ceiling;
- does not require an app-store submission.

The current product is a Node.js Cordis application served by `dsh --profile web` and consumed by a browser. The desktop version must preserve this host/client split while adding a local native shell.

## Proposal

### Runtime architecture

The desktop application is an Electron shell around the existing dsh host/client pair:

- **Electron Main process** owns the application lifecycle, starts a private dsh Node.js child process, and exposes a minimal, allow-listed IPC surface to the renderer.
- **dsh backend child process** runs the standard `dsh --profile desktop` (or `--profile web` with a desktop overlay) on a dynamically chosen localhost port. It is identical to the server used by the browser UI, so every tool, seam, and session behavior is preserved.
- **Electron Renderer process** loads `http://127.0.0.1:<port>` and renders the existing React UI. It has no Node.js integration; all native access goes through the preload script.

This keeps the desktop product on the same architecture as the web product and lets Cordis continue to own composition, plugins, and capability seams.

### New package layout

Add one application entry and one Cordis bundle, plus a small family of desktop-specific host plugins:

```
apps/desktop/                          # Electron entry and build scripts
  src/
    main.ts                            # app lifecycle + dsh child process
    preload.ts                         # allow-listed IPC bridge
    renderer.ts                        # mounts AppWebEntry with desktop hooks
  resources/                           # assembled by the build
    backend/                           # pnpm deploy of apps/cli + node_modules
    node/                              # platform Node.js binary
  electron-builder.yml
  package.json

packages/bundle/desktop-app/           # Cordis bundle: web-app + desktop plugins
  cordis.patch.yml

@deepseek-ai/dsh-desktop-shell/                # registers desktop host services
  src/
    index.ts
    menu.ts                            # menu + Dock/tray abstraction
    dialog.ts                          # native file/folder dialogs
    shortcut.ts                        # global shortcuts
    notification.ts                    # system notifications
    drag-drop.ts                       # file drop ingestion
```

Each `packages/desktop/*` plugin registers on the Cordis context and communicates with the Electron Main process through the existing API proxy or through the new renderer IPC bridge. The renderer receives desktop events and forwards them to the host through the same HTTP/WebSocket channel used by the browser UI.

### Backend packaging

Because users do not have Node.js installed, the Electron application must ship its own runtime and the dsh backend:

1. `pnpm run build:desktop` builds the host libs, the web dist, and the desktop shell.
2. `pnpm run package:desktop:prepare` runs `scripts/desktop-package.ts` for the packager host OS into `apps/desktop/resources/<os>/`:
   - `pnpm --filter @deepseek-ai/dsh deploy --legacy --prod` materializes the standalone backend. The deploy rewrites the workspace state with its production/filter context, so the script re-runs a plain `pnpm install` to restore the state every later pnpm command expects.
   - The script hoists every virtual-store package to the top-level `node_modules` (the launcher resolves Cordis plugin names from its own install directory, and the deploy layout links only direct dependencies). Hoisted links are relative so the packaged copy keeps resolving after installation.
   - `materializeExternalLinks` replaces every symlink that resolves outside the deploy tree (the vendored `cosmokit`/`schemastery` pnpm `link:` dependencies, which point back into the repository and dangle in a packaged app) with a real copy; cyclic vendor links are re-pointed at the in-tree copy.
   - The script verifies the required plugin tree.
3. `scripts/desktop-download-node.ts` downloads the checksum-verified Node binary (v24.19.0) into `apps/desktop/resources/<os>/node` (`bin/node` on darwin, `node.exe` on win32). The Node binary and the backend's native addons are OS-specific, so each packaging command runs on its target OS; `--platform win-x64` on a macOS host can cross-download the Node binary for build-link verification, but that package is not distributable.
4. `electron-builder` (v26, `apps/desktop/electron-builder.yml`) packs each target's own resources directory as extraResources. Its copy filter drops a root-level `node_modules` dir, so the backend is copied in two passes (the `node_modules` subtree on its own, then the rest).

At runtime the Main process spawns:

```
<resources>/node/bin/node <resources>/backend/lib/bin.js --profile desktop --port 0
```

The child prints its bound port over stdout or writes it to a small port file in the app’s user-data directory. The Main process waits for the port, then loads the renderer URL.

Using a **separate standard Node.js binary** instead of Electron’s bundled Node avoids ABI mismatches with the `landlock-run` native addon and lets the backend run in an isolated process.

### Renderer security model

The renderer is treated as an untrusted browser page even though it loads a local service:

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- `allowRunningInsecureContent: false`
- `webSecurity: true`

The preload script exposes only a typed, allow-listed API. Every channel validates its arguments in the Main process before calling Electron or Node APIs. No raw `ipcRenderer` is leaked; channels are declared as a closed union and validated against JSON schemas.

Example preload surface:

| Channel | Direction | Purpose |
| --- | --- | --- |
| `desktop:selectDirectory` | invoke | open native folder picker |
| `desktop:showSaveDialog` | invoke | save-file dialog |
| `desktop:fileDrop` | on | files dropped onto the window |
| `desktop:serverReady` | on | backend URL is ready |
| `desktop:toggleTray` | invoke | show/hide tray icon |
| `desktop:sendNotification` | invoke | system notification |

### Native capability mapping

| Desktop feature | Implementation |
| --- | --- |
| Application menu / Dock menu | `Menu.setApplicationMenu` + `Menu.buildFromTemplate` in Main; menu actions invoke host commands through the renderer or directly start a new dsh session |
| Tray icon | `Tray` in Main; left click shows/hides window; right click shows a context menu |
| Global shortcuts | `globalShortcut` in Main; actions forwarded as host commands |
| Native file/folder dialogs | `dialog.showOpenDialog` / `dialog.showSaveDialog` in Main; result returned to renderer |
| File drag-and-drop | Main intercepts `drop-files` via `BrowserWindow` and sends paths to renderer through `desktop:fileDrop`; renderer forwards to host `ctx.attachments` or workspace picker |
| Notifications | `Notification` in Main; renderer requests via `desktop:sendNotification` |
| Window chrome | Frameless or native title bar controlled from Main; renderer can request minimize/maximize/close through IPC |
| OS theme | `nativeTheme` in Main exposed as a media-query/CSS variable to renderer |

### Offline and online model support

The desktop profile keeps all existing online LLM providers. Offline support is added as an optional provider registered on `ctx.llm`:

- `packages/llm/llm-ollama/` or `packages/llm/llm-local/` connects to a local Ollama/LM Studio server.
- The provider registers only when a local endpoint is configured; by default the product still requires an API key for online services.
- The existing model settings UI in `packages/client/ui-settings-models` lists the local provider alongside remote ones because it consumes `ctx.llm` through the same seam.

### Build and release pipeline

New root scripts:

- `pnpm run build:desktop` — build host libs, web dist, and desktop main/preload.
- `pnpm run package:desktop:prepare` — assemble the backend deploy and the platform Node binary for the host OS; pass `--platform win-x64` to cross-download the Node binary.
- `pnpm run package:desktop:mac` — run the prepare step, then `electron-builder` for macOS.
- `pnpm run package:desktop:win` — run the prepare step, then `electron-builder` for Windows.

`electron-builder.yml` targets:

- macOS: `dmg` and `zip`, both `arm64` and `x64` (universal optional).
- Windows: `nsis` installer and `portable` executable, `x64`.

CI uses a GitHub Actions matrix with macOS and Windows runners, each building and preparing its own platform. Artifacts are uploaded as release assets. No automatic updater is included; users download new releases manually.

### Verification status

- DMG and zip build cleanly on macOS; DMG requires network access to download `dmgbuild-bundle` (a local proxy or the npmmirror `electron-builder-binaries` mirror unblocks it).
- The packaged backend is self-contained: every symlink is relative and resolves inside the tree (verified by scanning the packaged tree and by booting the backend from a copy of the `.app` moved outside the repository, which serves the UI over HTTP). The same prepare step that makes this true runs on any packager host.
- Windows installers are built on Windows (`pnpm run package:desktop:win`); the native addons in the deployed backend are host-specific, so the prepare step must run on the Windows host or CI runner.
- The GUI window itself cannot be rendered in a headless sandbox; integration smoke tests require a machine with a display (CI native agents or manual acceptance).

### Signing and notarization

- **macOS**: Developer ID Application certificate + notarization is required for Gatekeeper on macOS 10.15+. `electron-builder` can notarize via `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`.
- **Windows**: a code-signing certificate is recommended to avoid SmartScreen warnings. If no certificate is available, the NSIS installer still runs after a user prompt.

### Testing strategy

- Unit tests for Main-process helpers: port discovery, backend restart backoff, IPC schema validation.
- Snapshot tests reuse existing web snapshots because the renderer UI is unchanged.
- Integration tests launch the built Electron app and assert that it can start the backend, load the UI, and create a blank session.
- Manual acceptance on physical macOS and Windows machines before each release.

### Phased rollout

1. **Phase 1 — skeleton** (completed): `apps/desktop` boots, starts the dsh backend, loads the Web UI; verified end-to-end (ready URL + HTTP 200).
2. **Phase 2 — packaging** (completed): `pnpm deploy` backend, bundled Node binary, `electron-builder` produces unsigned installers; signing/notarization deferred to Phase 5 CI.
3. **Phase 3 — desktop plugins**: add `@deepseek-ai/dsh-desktop-shell` and the directory-picker provider, then menu, tray, dialogs, drag-drop, notifications, shortcuts (`packages/bundle/desktop-app` already exists from Phase 1).
4. **Phase 4 — offline provider**: add optional local LLM provider behind `ctx.llm`.
5. **Phase 5 — CI/release**: GitHub Actions matrix builds both platforms on every release tag.

## Alternatives considered

**Tauri with a Node.js sidecar.** Tauri produces smaller binaries because it uses the OS webview, but it still needs a separate Node runtime to run dsh. The Rust main process would add a new language stack and an extra IPC layer, and the 4 GB bundle ceiling makes Electron’s size cost acceptable. Rejected.

**Wails with a Node.js sidecar.** Similar to Tauri, but with Go instead of Rust. The project already uses Node/TypeScript everywhere, so this introduces an unnecessary language. Rejected.

**Neutralinojs.** A lighter C++ alternative, but its ecosystem and cross-platform packaging are far less mature than Electron’s. Rejected for maintenance risk.

**Progressive Web App only.** A PWA would avoid packaging entirely, but it cannot run the local dsh Node.js backend or access the local filesystem/terminal/sandbox. Rejected.

**React Native for Windows/macOS or .NET MAUI/Avalonia.** These would require rewriting the entire UI instead of reusing `apps/web`. Rejected because UI reuse is a hard requirement.

## Acceptance criteria

- `apps/desktop` builds and runs on macOS and Windows without Node.js installed on the host.
- Produced `.dmg` (macOS) and `.exe`/NSIS installer (Windows) launch the existing Web UI successfully.
- The desktop app supports menu bar / tray, global shortcuts, native file dialogs, file drag-and-drop, and notifications.
- Bundle uncompressed size is under 4 GB; initial target is under 1 GB.
- Renderer process has no Node.js access; all OS interactions use the allow-listed preload IPC bridge.
- macOS build is signed and notarized; Windows build is signed if a certificate is available.

## Risks

- **Native addon ABI.** `landlock-run` must be compiled for the bundled standard Node binary, not for Electron’s internal Node. Using a separate Node process mitigates this.
- **macOS notarization delays.** Notarization can fail or take time; CI must surface actionable logs.
- **Process lifecycle.** The dsh backend can crash or refuse to start if the port is unavailable. Main process must implement restart with exponential backoff and clear user-facing diagnostics.
- **Renderer vs. browser differences.** Drag-and-drop, deep links, and window focus behave differently in Electron than in a standalone browser; each requires explicit handling in Main/preload.
- **Long build times.** Shipping a full Node runtime and `node_modules` makes CI builds slower; caching the downloaded Node binary and the deployed backend directory helps.
