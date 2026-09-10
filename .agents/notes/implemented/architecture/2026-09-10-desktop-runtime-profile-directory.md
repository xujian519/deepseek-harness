# Agent Note: Give the desktop runtime its own profile directory

Status: implemented

English | [中文](2026-09-10-desktop-runtime-profile-directory.zh.md)

## Problem

The packaged Electron shell owns one reserved profile: startup reads its `desktop-release.json`, compares the recorded release plus the installed `@deepseek-ai/dsh` and `@deepseek-ai/dsh-desktop-host` versions with the application version, and installs the packaged seed there when they differ. That profile was `<DSH_HOME>/profiles/desktop`, the name the CLI reserves for the Electron application by rejecting `dsh --profile desktop` ([args.ts](../../../../apps/cli/src/args.ts)).

`profiles/desktop` can already hold a dsh CLI desktop profile created before the desktop composition moved to the private Desktop Host: hand-installed plugin bundles, a `cordis.patch.yml` overlay, and no `desktop-release.json`. Startup fails on such a directory before any ownership check, because `applyRelease` uses `releaseVersion()` as its reuse test and that call reads the missing release file, so the shell reports `ENOENT: ... profiles/desktop/desktop-release.json` and exits without a window.

Replacing that directory with the seed is not a repair: it discards the installed plugin list and the patch overlay, and a plugin restore reinstalls name-and-version pairs only, so plugins recorded with `github:` or `file:` specs are unrecoverable.

## Decision

The Electron runtime profile is `<DSH_HOME>/profiles/desktop-runtime`. `resolveDesktopPaths` is the only place that names it; the staging, rollback, pending, lock, and private pnpm paths under `<DSH_HOME>/desktop` are unchanged. The application never reads or writes `<DSH_HOME>/profiles/desktop`, so a CLI profile at the reserved path cannot fail desktop startup.

## Alternatives considered

**Migrate the occupied directory in place.** Startup would distinguish its own profile from a foreign directory, move the foreign one aside, and install the seed. Rejected: it moves data the shell never owned, cannot restore the plugin specs it drops, and buys nothing over a directory the shell owns outright.

**Rename the CLI profile once and keep `<DSH_HOME>/profiles/desktop`.** A one-time directory move unblocks startup with no code change. Rejected: the name stays shared, so the next CLI profile created there reproduces the same failure, and the repair lives outside the repository.

**Share one profile between the CLI and the shell.** Rejected: the shell requires the profile's core package set to match its packaged seed and mutates the manifest, lockfile, and `node_modules` transactionally, which a CLI-maintained profile does not satisfy.

## Consequences

Desktop startup, plugin mutation, and backend restart touch only `<DSH_HOME>/profiles/desktop-runtime`; they neither read nor rewrite a CLI profile. The first launch after this change performs the complete seed installation in the new directory instead of reusing the old path, so it installs the full core package set before the first window appears.

Upstream reserves `profiles/desktop` for the shell; this tree keeps the shell on `desktop-runtime` and therefore diverges from that path. Plugins that lived in the old CLI profile are not carried over, and the shell's plugin installation accepts registry package specs only, so a plugin resolved from a `github:` or `file:` spec must be reinstalled from a publishable source.
