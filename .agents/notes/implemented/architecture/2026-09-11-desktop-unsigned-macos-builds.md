# Agent Note: Unsigned macOS Desktop builds

Status: implemented

English | [中文](2026-09-11-desktop-unsigned-macos-builds.zh.md)

## Problem

macOS release packaging is signing-bound by construction: `prepare:dsh` signs every Mach-O file in the materialized runtime, `electron-builder` receives the Developer ID identity with `forceCodeSigning`, and the `afterSign` and disk-image hooks verify or notarize what that identity produced. The release environment resolves those inputs up front, so a build host without a code-signing identity cannot produce any installable application — not even one for local testing — while the same tree runs fine under `pnpm run dev:desktop`.

## Decision

`DSH_DESKTOP_UNSIGNED=1`, the mode `--unsigned` already selected for the Windows target, now covers macOS:

- `prepare:dsh` skips runtime signing and keeps every other preparation step.
- The builder config stops reading the Developer ID and notary inputs, and sets `mac.identity: null`, `mac.forceCodeSigning: false`, `mac.notarize: false`, and `dmg.sign: false`. Its `afterSign` and `artifactBuildCompleted` hooks return before verifying or notarizing a signature it never made.
- `package:mac:arm64:unsigned` and `package:mac:x64:unsigned` expose the mode. A macOS target inside it takes the plain electron-builder path instead of the App/DMG notarization split.

`identity: null` rather than an omitted identity is load-bearing: electron-builder falls back to a keychain identity when the field is `undefined`, which is the discovery `CSC_IDENTITY_AUTO_DISCOVERY=false` already suppresses for Windows.

## Alternatives considered

**Add a second flag for macOS.** Rejected: `--unsigned` already means "emit a local artifact with no release identity", and two names for one mode drift.

**Keep the non-Windows rejection and require a Developer ID for local macOS builds.** Rejected: it leaves deployments without a Developer ID unable to exercise the packaged shell, the first-launch runtime preparation, plugin installation, or the tray at all.

**Sign the runtime with the ad-hoc identity (`-`).** Rejected: `verifyMacOSRuntimeCode` compares the leaf authority and Team ID against the release identity, so an ad-hoc runtime fails the verification that follows it.

## Consequences

An unsigned build is an ad-hoc local artifact, never a release: it carries no Developer ID signature and no notarization ticket, Gatekeeper refuses it on other machines, and the signing and notarization paths stay unexercised by it. Everything else is the shipped pipeline, so runtime preparation, profile activation, plugin restore, and shell behavior are exercised as released. The mode is a build input only; nothing reads it at runtime. It also writes no release completion record, so an unsigned build cannot be uploaded as a release.

## Testing

`apps/desktop/tests/macos-signature.spec.ts` pins the builder configuration: a macOS target with `DSH_DESKTOP_UNSIGNED=1` and no Developer ID, Team ID, or `APPLE_*` input present resolves `identity: null`, `forceCodeSigning: false`, `notarize: false`, `dmg.sign: false`, and a null publish target. `apps/desktop/tests/package-target.spec.ts` pins that every release target accepts `--unsigned`.
