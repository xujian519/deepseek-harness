# Agent Note: Desktop launch suppresses the web runtime's default-browser open

Status: implemented

English | [中文](2026-08-21-desktop-suppress-default-browser-open.zh.md)

## Problem

The desktop shell (`apps/desktop`) spawns the `dsh --profile desktop` backend with `args: ['--port', '0']` and loads the resulting URL into the Electron window. The web runtime's `openBrowser` config defaults to `true` for local launches, and the desktop profile's `web-runtime` restatement did not set `openBrowser: false`. The desktop-app patch layer re-states the whole `web-runtime` config, so dropping the key falls through to the schema default instead of inheriting the web layer's `ctx.webStartup.openBrowser`.

The result: on every desktop launch, the backend opened the same `http://127.0.0.1:PORT` URL in the system default browser in addition to the Electron window. One UI surface appeared twice, which read as a redundant web server booting alongside the app.

## Decision

`apps/desktop/src/main.ts` now passes `--no-open` in the backend spawn args (`['--port', '0', '--no-open']`). The Electron window is the desktop's UI surface, so the web runtime's default-browser handoff is suppressed. `--no-open` (from the web-startup flag family, `packages/bundle/web-app/cordis.patch.yml`) propagates through `webStartup.openBrowser` and turns the browser open off for this invocation.

The single backend still serves the UI and prints the `dsh web:` readiness line (`printUrl: true` is kept in the desktop profile), so the Electron main process still parses the bound URL to load its window; only the external browser open is dropped.

## Alternatives considered

- **Leaving the desktop profile's `web-runtime` to set `openBrowser: false`.** More defensive, but a config-level change would lock the desktop profile against ever opening a browser while the command-line `--no-open` is the web surface's own prescribed switch for exactly this non-interactive-launcher case. The shell owns the launch, so it passes the launcher's flag.
- **Doing nothing.** The redundancy then persists for every desktop user.

## Consequences

Desktop launch opens the Web UI only in the Electron window. Backend behavior, readiness signaling, and the `dsh web:` URL line are unchanged. The web surface's `openBrowser` default stays `true` for `dsh --profile web`, which is correct for that browser surface.

## Testing

Desktop package specs (`apps/desktop/tests`) cover `startDshBackend` behaviors; the spawn args are a caller decision in `main.ts` and are not asserted by a unit test.
