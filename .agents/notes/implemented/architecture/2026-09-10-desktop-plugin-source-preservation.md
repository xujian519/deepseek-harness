# Agent Note: Preserve desktop plugin sources across profile rebuilds

Status: implemented

English | [中文](2026-09-10-desktop-plugin-source-preservation.zh.md)

## Problem

A desktop profile records its plugins as a bundle list plus one manifest dependency each, and `applyRelease` restored them with `pnpm add <name>@<version> --offline`. Only a plugin that the npm registry publishes at that exact version could therefore survive a rebuild. Plugins resolved from `github:` locators or local `file:` tarballs are absent from the registry, so their restore fails and takes the whole install transaction with it: the shell cannot start, with no window and only the pnpm diagnostics to explain why.

A recorded `file:` spec is also relative to the profile (`file:./vendor/plugin.tgz`), while a restore runs in a fresh staging directory, so even a resolvable locator pointed at the wrong directory.

## Decision

`DesktopPluginRecord` carries the profile's recorded `spec` alongside the name and installed version; `inspectPlugin` reads it from the profile manifest. `applyRelease` restores plugins through `restorePlugins`, which splits them by source: registry specs are added as `name@version --save-exact --offline` from the packaged store, and every other locator is added from its recorded spec without `--offline`, with a relative `file:` locator resolved against the active profile before staging receives it.

## Alternatives considered

**Degrade when a plugin cannot be restored.** Skipping the failed plugin would let the application start, but it silently drops a plugin the user installed; the desktop profile treats a broken composition as a loud failure instead.

**Ship the non-registry plugins inside the seed.** The seed's core package set is a signed, closed inventory that every profile is verified against, and it would have to be rebuilt and repackaged for every plugin a user adds.

**Keep registry-only plugins.** This is what the code did; it cannot represent the `github:` and local-tarball plugins that already exist in deployed profiles.

## Consequences

Registry plugins still restore entirely offline. A `github:` plugin now requires network access during a profile rebuild, and the recorded locator must remain reachable.

A `file:` locator is stored as an absolute path in the staged manifest, so moving the profile directory invalidates it until the plugin is installed again.

Not covered: plugin patches (`pnpm.patchedDependencies` plus the `patches/` directory) and custom workspace overrides are still not carried into staging, so a patch applied to a plugin is lost on the next rebuild.
