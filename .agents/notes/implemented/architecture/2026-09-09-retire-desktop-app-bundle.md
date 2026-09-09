# Agent Note: Retire the desktop-app bundle

Status: implemented

English | [中文](2026-09-09-retire-desktop-app-bundle.zh.md)

## Problem

`packages/bundle/desktop-app` (`@deepseek-ai/dsh-desktop-app`) was the desktop-surface bundle: a `cordis.patch.yml` over `dsh-web-app` that inserted the `desktop-runtime` glue plugin, the `desktop-shell` service, the Electron directory-picker pair (`dsh-desktop-directory-picker` + `dsh-client-ui-directory-picker-native`), `macos-tools`, and `better-sidebar`. The desktop profile (`dsh --profile desktop`) used to stack `dsh-base`, `dsh-web-app`, and this bundle.

The official `apps/desktop` shell no longer uses it. Its desktop composition is now owned by the private `@deepseek-ai/dsh-desktop-host` process: `apps/desktop/src/project-manager.ts` defines `DESKTOP_PROFILE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']` (no `desktop-app`), and `apps/desktop-host/config/desktop.cordis.patch.yml` is the overlay that inserts the shell, picker, macos-tools, and sidebar rows. No active profile or `cordis.yml` names `@deepseek-ai/dsh-desktop-app` in a `dsh.profile.bundles` list. The Patent shell retirement (see the retire-patent note) removed its last consumer, leaving the bundle orphaned.

## Decision

Retire `packages/bundle/desktop-app` and every reference that exists only for it. The desktop composition is unchanged: the `dsh-desktop-host` overlay remains the sole composition path.

- The package source tree (plugin, patch, README pair, tests, tsconfig) is removed.
- The `@deepseek-ai/dsh-desktop-app` dependency is removed from `apps/cli/package.json`. The CLI imports nothing from it; it only carried the desktop plugins transitively, and `apps/desktop-host` now depends on those plugins directly.
- The tsconfig path mappings and project reference for the package are dropped (`tsconfig.base.host.json`, `tsconfig.base.json`, `tsconfig.host.json`).
- The `packages/bundle/im/cordis.patch.yml` comment no longer names `desktop-app` as a preceding layer.
- The `verify-package-readme-model-experience.ts` entry for the package is removed.
- Generated catalogs (`docs/module-graph.*`, `docs/config-catalog.*`) and the lockfile are regenerated; doc descriptions that named the bundle now describe the `dsh-desktop-host` overlay.

## Alternatives considered

**Keep the bundle as a no-op legacy surface.** Rejected: nothing boots it, and keeping a dead bundle misleads readers into thinking a desktop composition path exists outside `dsh-desktop-host`.

**Fold this into the Patent shell retirement.** Deferred there; it is a distinct package whose removal touches docs catalogs and the bundle roster, so it is its own change.

## Consequences

The repository ships one desktop composition path: the Electron app layers the desktop surface over `dsh-web-app` through the private `dsh-desktop-host` overlay. The `desktop-app` bundle no longer exists; nothing references it.
