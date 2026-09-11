# Agent Note: Unsigned local Desktop builds

Status: implemented

English | [中文](2026-09-10-desktop-unsigned-local-builds.zh.md)

## Problem

macOS release packaging is signing-bound by construction: `prepare:seed` signs every Mach-O object in the seed store and then proves the rewritten store offline, `electron-builder` receives the Developer ID identity with `forceCodeSigning`, and the DMG hook notarizes the disk image. The release environment resolves those inputs up front, so a build host without a code-signing identity cannot produce any installable application — not even one for local testing — while the same tree runs fine under `pnpm run dev:desktop`.

## Decision

`DSH_DESKTOP_UNSIGNED_BUILD=1` makes one target emit an ad-hoc application instead of a release:

- `prepare-seed` skips the macOS seed signing (and its post-archive signature verification) while keeping every other seed step: lockfile generation, offline install proofs, store archival, and the integrity inventory.
- The builder config sets `mac.identity: null`, `mac.forceCodeSigning: false`, and `mac.notarize: false`, and the `afterSign` hook returns without verifying a signature it never made.
- The identity and Team ID inputs stay required, because the builder config still resolves them; the notary credential set is no longer consulted.

## Alternatives considered

**Sign with the ad-hoc identity (`-`).** Rejected: the seed verifier compares the signature's leaf authority and Team ID against the release identity, so an ad-hoc seed fails its own verification step.

**Assemble the seed by hand outside the pipeline.** Rejected: it reimplements owned seed assembly (lockfile, store rewrite, archival, inventory) and drifts from the shipped path immediately.

**Require a certificate for every local packaged build.** Rejected: it leaves deployments without a Developer ID unable to exercise the packaged shell, the first-launch seed install, plugin installation, or the tray at all.

## Consequences

An unsigned build is an ad-hoc local artifact, never a release: it carries no Developer ID signature and no notarization ticket, Gatekeeper refuses it on other machines, and the signing and notarization paths stay unexercised by it. Everything else is the shipped pipeline, so the seed install, profile activation, plugin restore, and shell behavior are exercised as released. The flag is a build input only; nothing reads it at runtime.

## Testing

`apps/desktop/tests/macos-signature.spec.ts` pins the builder configuration for the flag: a macOS target resolves `identity: null`, `forceCodeSigning: false`, and `notarize: false` without any `APPLE_*` notary credential present, and its `afterSign` hook returns without verifying. The build was also exercised end to end on a host with no code-signing identity: `DSH_DESKTOP_UNSIGNED_BUILD=1 … pnpm run package:desktop:mac:arm64:dir` produced `DSH Patent.app` (ad-hoc, `Identifier=Electron`, `TeamIdentifier` unset), which installed its seed into a fresh `DSH_HOME`, booted its backend, and opened the renderer with the workspace sidebar mounted.

## Related

- [Desktop composition mounts the workspace sidebar again](2026-09-10-desktop-workspace-sidebar-remount.md) — the sidebar mount this build carried.
