# Agent Note: Retire the Patent Electron shell

Status: implemented

English | [中文](2026-09-09-retire-patent-desktop-shell.zh.md)

## Problem

`apps/desktop-patent` (`@deepseek-ai/dsh-desktop-electron`) was the legacy Patent-facing Electron shell packaged around the dsh backend and web UI. The official `apps/desktop` shell (`@deepseek-ai/dsh-desktop`) has absorbed every feature the Patent shell carried — branding, tray and print, the `ctx.desktop` bridge seam, the macOS native tools, and the portless better-sidebar transports — so the Patent shell is a duplicate application with its own port-based transport and its own `desktop-patent` CLI profile. Keeping it leaves two shells to maintain and strands the better-sidebar desktop feature on the only port-based transport inside an otherwise portless shell.

## Decision

Retire `apps/desktop-patent` and everything that exists only to build or boot it. The official desktop composition is unchanged: `apps/desktop-host` + the `desktop.cordis.patch.yml` overlay over the `web-app` bundle, carrying the reserved `desktop` profile.

- The `apps/desktop-patent` source tree, its packaging config, and its tests are removed.
- The root scripts that build/package/test it (`build:desktop:patent`, `dev:desktop:patent`, `package:desktop:patent:{mac,prepare,win}`, `test:desktop:patent`) are deleted; the `@deepseek-ai/dsh-desktop` scripts stay.
- `scripts/desktop-package.ts` and `scripts/desktop-download-node.ts` (and their specs) are deleted: the only caller was the Patent `package:desktop:patent:prepare`, and the official shell assembles its backend and Node runtime through `apps/desktop/scripts/*` (`package-target.ts`, `prepare-runtime.ts`).
- The `desktop-patent` shipped profile template and its installation-owned tuple are removed from `packages/boot/app-boot/src/profile.ts` (plus its test). The CLI keeps rejecting the app-owned `desktop` profile name.
- The workspace, tsconfig, constraint, and vendoring references to the Patent app are dropped (`pnpm-workspace.yaml`, `tsconfig.host.json`, `scripts/check-workspace-constraints.ts`, `scripts/rescope-vendor.ts`).
- The `@deepseek-ai/dsh-desktop-app` bundle is **retained**: the shell removal leaves it without a consumer, but retiring the bundle is a separate change, not part of this shell retirement.

## Alternatives considered

**Keep the Patent shell as a thin legacy launcher.** Rejected: it duplicates the official shell and keeps a port-based transport alive; nothing references it once the official shell owns the desktop surface.

**Retire the `desktop-app` bundle in the same change.** Deferred: the bundle is a distinct package whose removal touches the docs catalogs and bundle roster; keeping the shell retirement focused avoids coupling two removals.

## Consequences

The repository now ships one Electron shell (`apps/desktop`). The `desktop-patent` CLI profile no longer exists; the app-owned `desktop` profile remains reserved and CLI-managed. The `web-app`-based desktop composition carries the better-sidebar, `macos-tools`, `desktop-shell`, and the native directory pickers. The `desktop-app` bundle remains present but unused pending its own retirement.
