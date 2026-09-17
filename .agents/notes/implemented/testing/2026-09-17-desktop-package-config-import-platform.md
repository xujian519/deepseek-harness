# Agent Note: Desktop packaging-config specs fix the target platform they assume

Status: implemented

English | [中文](2026-09-17-desktop-package-config-import-platform.zh.md)

## Problem

`apps/desktop/tests/desktop-icon.spec.ts` imports `electron-builder.config.mjs`, whose default export calls `createElectronBuilderConfig()` during module evaluation. The spec therefore stubs the release environment in `beforeAll` ahead of that import, but it stubbed only `DSH_DESKTOP_APP_ID` and `DSH_DESKTOP_UNSIGNED`. Without `DSH_DESKTOP_TARGET_PLATFORM`, the unsigned check resolved its platform from the build host instead, so on the Linux CI runner the import threw `desktop package: unsigned builds support Windows and macOS only` and all three tests failed before reaching an assertion. The same file passed on macOS, where the build host is itself a supported unsigned target.

## Decision

`beforeAll` stubs `DSH_DESKTOP_TARGET_PLATFORM` from `UNSIGNED_MAC_ENVIRONMENT`, the constant the file's explicit calls already use, so the module's default export resolves a macOS target on every build host. The per-test calls keep overriding the platform for the Windows case.

## Alternatives considered

**Rely on the platform passed to each explicit call.** Rejected: the default export is evaluated at import, before any test body, so per-call arguments never reach it.

**Have `createElectronBuilderConfig` skip the unsigned platform check when the environment names no target platform.** Rejected: the default export serves real packaging, where a missing target platform is the configuration error that check exists to report.

**Assert on the icon paths without importing the config module.** Rejected: the assertions read the resolved `mac.icon` and `win.icon` values, which only this module produces.

## Consequences

The spec pins the platform its assertions assume instead of inheriting the build host, so the macOS and Linux lanes agree.

Every spec that imports the packaging config needs a complete stubbed environment for the same reason: the module resolves the release environment at its default export, and the unsigned mode rejects every target platform other than Windows and macOS.

## Verification

`pnpm exec vitest run apps/desktop/tests/desktop-icon.spec.ts` passes its three tests. Simulating a Linux build host (`Object.defineProperty(process, 'platform', { value: 'linux' })`) reproduces the original failure without a stubbed target platform and resolves `apps/desktop/assets/icon.icns` with it.
