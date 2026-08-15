# AGENTS.md — Desktop application stack

Rules for `apps/desktop/` and `packages/desktop/*` (the Electron shell around dsh). They supplement the repo-wide [conventions](../../AGENTS.md#conventions) and the [package rules](../packages/README.md). Read the [desktop deployment Agent Note](../../.agents/notes/proposed/architecture/2026-08-15-desktop-deployment-electron.md) before changing the architecture.

## Scope and runtime model

The desktop app is an Electron shell that runs the existing dsh Node.js backend as a child process and loads the existing browser UI in a renderer window. Almost all product behavior lives in the backend and the shared Web UI; the desktop layer owns only:

- application lifecycle (startup, quit, crash recovery);
- a minimal, allow-listed IPC bridge between the renderer and the OS;
- OS chrome (menu bar, Dock/tray, global shortcuts, notifications, file dialogs, drag-and-drop);
- packaging and release automation.

The desktop profile is `desktop`: `dsh --profile desktop`. It is a Cordis bundle layered over `dsh-base` plus the web-app surface, with desktop-specific host plugins mounted through `packages/bundle/desktop-app/cordis.patch.yml`.

## Tech stack

| Layer | Technology |
| --- | --- |
| Shell | Electron (current stable LTS) |
| Shell language | TypeScript 6, ESM, `strict`, NodeNext module resolution |
| Backend | The same Node.js dsh backend as `apps/cli`, spawned as a child process |
| Frontend | Existing `apps/web` React UI, loaded from the local dsh HTTP server |
| Build | `tsc` for the shell; `electron-builder` for installers; repo-wide `pnpm` workspaces |
| Lint / format | Repo-wide `oxlint` + `pnpm run lint` and `prettier`/`verify-md-wrap` |
| Test | Vitest for shell helpers; existing `test:web` and snapshot suite for the UI |

## Directory layout

```
apps/desktop/
  src/
    main.ts              # Electron Main process: lifecycle + backend spawner
    preload.ts           # allow-listed IPC bridge exposed to renderer
    renderer.ts          # thin shell over AppWebEntry; desktop-only hooks
    server-manager.ts    # dsh child process control: start, port discovery, restart
    ipc-schema.ts        # renderer↔main channel names + argument schemas
    native/              # OS-specific helpers (menu, tray, shortcuts, dialogs)
  resources/             # assembled at package time; not checked in
    mac/                 # darwin packager host: backend deploy + node binary
      backend/
      node/
    win/                 # win32 packager host: backend deploy + node binary
      backend/
      node/
  build/
    entitlements.mac.plist  # hardened-runtime entitlements
  electron-builder.yml
  tsconfig.json
  package.json

The packaging scripts live in the repo-wide `scripts/` tree so they typecheck
under the host aggregate and run on any packager host:

- `scripts/desktop-package.ts`       # `pnpm deploy --prod` of the dsh CLI + deploy verification
- `scripts/desktop-download-node.ts` # fetch + checksum-verify the platform Node binary

packages/desktop/
  shell/                 # Cordis plugin that registers desktop host services
    src/
      index.ts           # apply(): expose desktop services to the dsh host
      menu.ts            # application menu / Dock / tray integration
      dialog.ts          # native file/folder dialogs
      shortcut.ts        # global shortcuts
      notification.ts    # system notifications
      drag-drop.ts       # file drop ingestion
```

## Common commands

```bash
# Development: build the web dist once, then run Electron against source
# (the dsh backend runs via tsx from apps/cli/src)
pnpm run build:web
pnpm run dev:desktop              # build the shell and launch Electron

# Production packaging
pnpm run build:desktop            # build everything the desktop app needs
pnpm run package:desktop:mac      # prepare darwin resources, DMG + zip (macOS)
pnpm run package:desktop:win      # on a Windows host: prepare win32 resources, NSIS + portable

# Local checks
pnpm run lint                     # repo-wide oxlint; desktop sources included
pnpm run typecheck                # repo-wide TypeScript
pnpm --filter @deepseek-ai/dsh-desktop run test
```

## Coding standards

### TypeScript and modules

- ESM only. The dsh source-launch contract requires every module loaded by Node subprocesses to remain ESM; do not introduce CJS-only dependencies.
- `strict: true`, `noImplicitAny`. Avoid `any`; prefer `unknown` with narrow guards at the boundaries (IPC args, parsed JSON, file paths).
- No `@ts-ignore`. Use `@ts-expect-error` with a comment explaining why narrowing is infeasible.
- Do not import `electron` in renderer code or in backend plugins. Electron APIs live only in `apps/desktop/src/` Main-process files and the preload script.

### Naming and file layout

- Files and directories: `kebab-case`.
- Classes / React components: `PascalCase`.
- Constants: `UPPER_SNAKE_CASE`.
- Feature modules under `packages/desktop/*` follow the Cordis package shape: `src/index.ts` (apply), README.md, package.json, tsconfig.json.

### IPC and renderer security

Treat the renderer as an untrusted browser page even though it loads a local service:

- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`.
- The preload script is the only bridge. It exposes a typed, closed set of channels declared in `ipc-schema.ts`.
- Every IPC handler in `main.ts` validates arguments against the schema before acting.
- Never pass `ipcRenderer` itself to the renderer; expose only per-channel wrappers.
- Never evaluate strings from the renderer as paths or shell commands. Paths returned by dialogs are read-only data; host plugins decide what to do with them.

### Native capability seams

Desktop-only behavior must still go through Cordis seams where one exists:

- Directory picking: the Electron dialog fills the same `ctx.directoryPicker` seam used by `dsh-host-directory-picker-native`. The renderer uses the existing workspace UI; only the backend provider changes.
- File drag-and-drop: Main reads dropped paths and sends them to the renderer; the renderer forwards to the host `ctx.attachments` or workspace picker through the normal HTTP/WebSocket API.
- Menu / tray / shortcuts / notifications: implemented in Main and exposed as host commands or renderer events. Do not let renderer code call Electron APIs directly.

### Backend child process

- Use a separate, bundled Node.js binary; do not rely on Electron’s internal Node. This avoids ABI mismatches with native addons such as `landlock-run`.
- Start dsh with `--profile desktop --port 0`, discover the bound port from stdout or a port file, then load the renderer URL.
- Implement restart with exponential backoff. If the backend exits unexpectedly, surface a user-visible error and offer to reload; do not silently respawn forever.
- Pass the user-data directory and log paths as environment variables; do not hardcode `~/.dsh` in the shell.

## Build and packaging

1. `pnpm run build:desktop` builds host libs, client libs, the web dist, and the shell.
2. `pnpm run package:desktop:prepare` runs `scripts/desktop-package.ts` for the
   packager host OS: it `pnpm deploy --prod`s `apps/cli` into
   `apps/desktop/resources/<os>/backend`, verifies the tree carries every
   plugin the `desktop` profile resolves, and downloads the checksum-verified
   Node binary into `apps/desktop/resources/<os>/node`.
3. `pnpm run package:desktop:mac` / `package:desktop:win` run the prepare step
   and then `electron-builder` against `apps/desktop/electron-builder.yml`;
   each target packs its own OS resources directory as extraResources.
4. The backend deploy and Node binary are OS-specific (native addons such as
   node-pty and sharp, and the Node executable layout differ per OS), so run
   each packaging command on its target OS — CI uses one runner per OS.
   `--platform win-x64` on a macOS host can cross-download the Node binary for
   build-link verification, but that package is not distributable.
5. The web frontend is served by the dsh backend (`dsh-host-frontend-static`),
   so it does not need separate packaging in Electron; the renderer loads
   `http://127.0.0.1:<port>`.

Keep the unpacked application under the 4 GB ceiling. If `node_modules` bloat approaches the limit, audit optional dependencies and exclude dev artifacts from `electron-builder`.

## Signing and notarization

- macOS: code-sign with a Developer ID Application certificate and notarize via `@electron/notarize`. Gatekeeper on macOS 10.15+ requires notarization even outside the App Store.
- Windows: sign with a code-signing certificate if available. Without one, SmartScreen shows a warning; the NSIS installer still works.
- CI secrets: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, plus Windows certificate and password.

## Testing

- Unit tests for `apps/desktop/src/` helpers (port discovery, restart backoff, IPC schema validation, native menu templates) live in `apps/desktop/tests/` and run under Vitest.
- Integration tests launch the built Electron app, wait for the backend port, and assert that a blank session can be created. These require a display and are intended for CI runners with `xvfb` on Linux or native agents on macOS/Windows.
- UI behavior is covered by the existing `test:web` snapshot and e2e suite because the renderer runs the same `apps/web` code.
- Do not add tests that exercise real model APIs in the desktop suite; rely on `dsh-llm-mock-server` or recorded fixtures.

## Git workflow

Follow the repo-wide conventions and the Sati-style discipline where it does not conflict:

- Branch from `master`: `feat/desktop-<kebab-description>`, `fix/desktop-<...>`, `docs/desktop-<...>`.
- Conventional Commits: `<type>(<scope>): <subject>`, e.g. `feat(desktop): add tray toggle`.
- Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `style`, `perf`, `ci`, `build`, `revert`.
- Scope: `desktop` for shell changes; the existing package scope for backend/client changes.
- Keep PRs small and focused. A desktop change that touches both `apps/desktop` and `packages/desktop/*` is fine; a change that also rewrites core seams should be split.
- Non-trivial changes need an Agent Note in the same PR.

## Pre-push checklist

Run the narrowest checks that cover your change:

- [ ] `pnpm run typecheck`
- [ ] `pnpm run lint`
- [ ] `pnpm --filter @deepseek-ai/dsh-desktop run test`
- [ ] For UI-visible changes: `DSH_SNAPSHOT=replay pnpm run test:web`
- [ ] Agent Note added or updated for non-trivial architecture/process changes

## Where to read next

- [Desktop deployment Agent Note](../../.agents/notes/proposed/architecture/2026-08-15-desktop-deployment-electron.md)
- [Cordis primer](../../docs/cordis-primer.md)
- [Architecture map](../../docs/architecture.md)
- [Capability seams](../../docs/capability-seams.md)
- [Web client architecture note](../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.md)
