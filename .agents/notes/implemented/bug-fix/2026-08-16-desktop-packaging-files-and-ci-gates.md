# Agent Note: Desktop packaging files and the fork CI gates

Status: implemented

English | [中文](2026-08-16-desktop-packaging-files-and-ci-gates.zh.md)

## Problem

Two defects surfaced after the desktop shell shipped. First, the packaged app crashed on launch with `ERR_MODULE_NOT_FOUND: Cannot find module '.../app.asar/dist/bridge-server.js'`: `electron-builder.yml` listed `dist` files explicitly (`main.js`, `server-manager.js`, `preload.cjs`) and missed `bridge-server.js`, `navigation.js`, and `tray.js`, which `main.ts` imports statically. The list had missed a module before (`server-manager.js`, fixed in `a2f7b7bc8a`), so the explicit-list pattern itself was the defect. Second, switching the fork CI from the upstream larger-runner labels to standard hosted runners exposed five gate failures in this PR's own code: `duplication` clones in `scripts/desktop-package.ts`/spec, `verify-cordis-config` missing `tsconfig.base.json` paths for the desktop packages, a stale `docs/module-graph.md`, `knip` reporting the `desktop-app` bundle dependencies unused, and vitest failing to resolve `@deepseek-ai/dsh-desktop` in the desktop-shell tests.

## Decision

- **Package `dist` as a directory, not a list**: `electron-builder.yml` `files` now takes the whole `dist` output minus `*.map`, `*.d.ts`, and `dist/types/**`, symmetric with the npm `files` field in `apps/desktop/package.json`. A future module under `src/` is packaged automatically.
- **Source-plane resolution**: added `@deepseek-ai/dsh-desktop*` and `@deepseek-ai/dsh-desktop-app` entries to `tsconfig.base.json` `paths` so the tsx source launch and vitest resolve these packages to `src` instead of built `lib/`.
- **Bundle dependency accounting**: `knip.json` gives `packages/bundle/desktop-app` the same `ignoreDependencies: ["@deepseek-ai/.+"]` as `bundle/web-app` and `bundle/base`; bundle dependencies are consumed through `cordis.patch.yml`, which knip does not parse.
- **Clone removal**: extracted fixture helpers (`makeExternalLink`, `makeVendorCycle`, `makeInTreeStoreLink`, `expectPackageJson`) from the mirrored POSIX/win32 setup blocks in `desktop-package.spec.ts` and a `resolveLinkTarget` helper from the two symlink walk skeletons in `desktop-package.ts`.
- **Generated doc**: re-ran `pnpm run gen-module-graph` so `docs/module-graph.md` includes the desktop packages.

## Alternatives considered

**Add the three missing files to the explicit list.** Fixes the crash but keeps the failing pattern; a fourth module would break again. Rejected.

**Wrap the repeated spec setup in `jscpd:ignore` markers.** The project already uses that mechanism for license headers, but the duplicated blocks here are fixture code that extracts cleanly into helpers. Rejected for the production-code clone (two symlink-walk skeletons), which is a real structural duplicate.

## Consequences

- The packaged app starts on macOS: Electron main, embedded Node backend (`--profile desktop --port 0`), bridge socket, and HTTP 200 on the bound port.
- All five gates pass locally: `duplication` reports 0 clones, `verify-cordis-config` 129 files, `verify-module-graph` up to date, `knip` clean, and the desktop-shell/directory-picker suites (31 tests) resolve `@deepseek-ai/dsh-desktop`.
- Fork CI can now run the enterprise lanes; unrelated snapshot divergences (pwsh tool-schema pins, web e2e composition) predate this PR and are tracked separately.

## Remaining risks

- The CI snapshot and web-e2e lanes still fail on this fork for reasons outside this PR's diff (jobs-tool schema pins, a duplicated `tool-pwsh` loader entry, and an SQLite experimental warning on stderr); they need upstream fixture refreshes, not this PR.
