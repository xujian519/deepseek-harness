# Agent Note: defense in depth for the dual-copy scheduler handshake

Status: implemented

English | [中文](2026-08-19-dual-copy-defense-in-depth.zh.md)

## Problem

The string-keyed scheduler handshake ([2026-08-16-dual-copy-dsh-tools-scheduler-handshake](2026-08-16-dual-copy-dsh-tools-scheduler-handshake.md)) makes a same-version dual copy of `@deepseek-ai/dsh-tools` harmless, but three gaps remain:

1. **Version divergence is undefended.** A third-party plugin that declares `@deepseek-ai/dsh-tools` as a *direct dependency* (not a peer) makes pnpm materialize a physical copy in the profile's `node_modules` at the plugin's pinned version. The reproducing profile carried `dsh-feishu-bot` with a direct `@deepseek-ai/dsh-tools@0.1.0-rc.6` dependency next to the app's `0.1.0-rc.7`, plus rc.6 copies of `dsh-credentials`, `dsh-sdk-client`, `dsh-sdk-protocol`, and `dsh-settings`. A fixed app plus a pre-fix (symbol-keyed) or differently-versioned copy in the profile re-breaks every tool call.
2. **The failure is undiagnosable.** `ctx.tools[schedulerKey].prepare(...)` on `undefined` throws the bare `Cannot read properties of undefined (reading 'prepare')` with no pointer to the dual-copy cause or the checkpoints that fix it.
3. **The mechanism is community-wide.** [anywhere-labs/deepseek-harness-desktop#227](https://github.com/anywhere-labs/deepseek-harness-desktop/issues/227) reports the same crash for two DSH installs sharing one `$DSH_HOME`: `healProfilesModuleFallback` re-points `$DSH_HOME/profiles/node_modules` at whichever install launched last, and a running process from the other install then loads mixed copies. Upstream still ships the `unique symbol` key, so npm-global users remain vulnerable.

## Decision

Three independent layers, so no single layout failure reaches the user as a crash:

- **L1 (already landed): the string key.** `TOOL_RUNTIME_SCHEDULER` is shared by value across copies.
- **L2: version pins in the profile's pnpm workspace.** `initProfile` writes `overrides` into `pnpm-workspace.yaml` pinning `@deepseek-ai/dsh-tools` and `@deepseek-ai/cordis` to the versions resolved from the installation anchor (`installedPackageVersion`, `profileCoreOverrides`). `ensureProfileVersionPins` backfills existing profiles idempotently and keeps unrelated keys; `divergentProfileCoreVersions` names installed copies whose version differs from the installation. The pins make the next `pnpm install` converge every physical copy on the installation's versions, so the string handshake always sees same-version copies.
- **L3: diagnosable failure and self-healing.** `requireScheduler` in `dsh-agent-loop` turns a missing scheduler into an error naming the key and the `$DSH_HOME` checkpoints. `prepareProfile` prints the manual fix (`pnpm install` in the profile directory) when copies diverge; when `DSH_AUTO_PNPM_INSTALL` is set (the desktop launch), it runs `pnpm install` itself and reports any copy that still diverges. The desktop main process sets `DSH_AUTO_PNPM_INSTALL=1`, so a packaged app with no terminal converges its own profile on the first launch after the divergence appears.

## Alternatives considered

**Eliminate the physical copy (dependency-layer only).** pnpm's isolated/hoisted layouts plus a plugin's direct dependency make a second copy unavoidable; only version alignment is controllable. The upstream anti-duplication contract (heal fallback symlinks, installation-first bundle resolution, `autoInstallPeers: false`) already makes peers resolve to the installation; the pins close the direct-dependency hole.

**`Symbol.for` instead of a string key.** The global registry is per-process, so it fixes the in-process handshake but not cross-process or serialized key use, and changing the already-shipped key would break the released rc.7 surface for no gain.

**Rewrite the Loader so bundle rows always resolve from the app's closure.** Structurally complete but changes vendored-Loader resolution; recorded in the previous note as deferred, still valid.

## Consequences

- New profiles carry the pins from first init; existing profiles get them backfilled at boot with a manual-fix hint, or automatically on desktop launches.
- A missing scheduler now reports the dual-copy checkpoints instead of a bare property-read error.
- The pins name exactly two packages: `@deepseek-ai/dsh-tools` (the handshake key owner) and `@deepseek-ai/cordis` (identity via `Symbol.for('cordis.is')`). Over-pinning the whole `@deepseek-ai/dsh-*` surface is deliberately avoided: peers already resolve through the fallback, and a broad pin would constrain the plugin ecosystem.

## Verification

- `profile.spec.ts` covers workspace emission with and without pins, `profileCoreOverrides` resolution from a staged installation, idempotent backfill preserving unrelated keys, stale-pin correction, and divergence detection for absent/equal/different installed copies.
- `tool-calls.spec.ts` removes the scheduler slot from a mounted `ToolRuntime` and asserts the failing turn's error names the key and the `$DSH_HOME` checkpoints.
- Resolution tracing during a real desktop-profile boot (`node --import` resolve hook on `@deepseek-ai/dsh-tools` and `@deepseek-ai/cordis`): the handshake sides both resolve to the installation copy — `dsh-agent-loop` static-imports it, and the loader's dynamic import of the `tools` row hits the same ESM cache entry — while profile plugins import their own physical copies for their own API use only. Cordis copies coexist without conflict because its identity handshake already uses `Symbol.for('cordis.is')`, which is process-global.
- Local reproduction: after applying the pins and reinstalling, the profile's `@deepseek-ai/dsh-tools` copy converges on the installation's rc.7, and the desktop/CLI boot performs tool calls with no scheduler error.

## Remaining risks

- `DSH_AUTO_PNPM_INSTALL` needs pnpm on PATH; a packaged machine without pnpm degrades to the manual-fix warning (the string key keeps a same-version dual copy non-fatal meanwhile).
- A pre-fix (symbol-keyed) `dsh-tools` copy that a plugin hoists still re-breaks a fixed app; that window closes only when the npm ecosystem ships the string key (upstream merge and release of the [string-key commit](https://github.com/xujian519/deepseek-harness/commit/8d031d46c8)).
- Multi-install `$DSH_HOME` sharing (community #227) is mitigated but not solved here; heal still re-points the fallback at the last-launched install, and the diagnostic now makes the mixed load identifiable.
