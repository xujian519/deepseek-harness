# Agent Note: Packaged desktop app ships ABI-mismatched native addons

Status: implemented

English | [中文](2026-09-06-desktop-native-addon-abi-from-host-node.zh.md)

## Problem

The packaged desktop app exited before reporting a URL: the backend failed to load the `fs-ext` native addon with `ERR_DLOPEN_FAILED`, a Node ABI (`NODE_MODULE_VERSION`) mismatch. `scripts/desktop-package.ts` `pnpm deploy --prod`s `apps/cli` into the backend resources tree, and `pnpm deploy` reuses the pnpm store's cached build, already compiled against the packager host Node. The desktop shell deliberately ships and runs a separate embedded Node binary (so it does not depend on Electron's internal Node), and that embedded Node is a newer major than the packager host, so a node-gyp source-built addon compiled on the host carries the host ABI and fails to load under the embedded runtime.

Only node-gyp addons are ABI-specific here. `node-pty`, `sharp`, `koffi`, and `node-addon-require-builtin` are N-API or prebuilt and load across Node ABIs; `fs-ext` is the sole source-built addon in the tree.

## Decision

In `scripts/desktop-package.ts`, after downloading the embedded Node binary, recompile every source-built native addon against it:

- `sourceBuiltNativeAddonModules(backendDir)` finds package directories holding both a `binding.gyp` and a `build/Release/*.node`, walking only the pnpm store under the deployed `node_modules`.
- `rebuildNativeAddonsWithNode(backendDir, nodeBin)` runs `node <embedded> <node-gyp-cli> rebuild` in each such package, throwing on a nonzero status; `resolveNodeGypCli()` locates the greatest installed node-gyp in the repository's pnpm store.
- `prepareDesktopResources` calls the rebuild only when `platform === currentDesktopPlatform()`. A source compile is host-specific, so a cross-platform Node download (e.g. `--platform win-x64` on macOS) is used for link verification only and is not distributable.

`sourceBuiltNativeAddonModules` also backs the `scripts/desktop-package.spec.ts` unit tests, which pin that only the node-gyp source build is picked up while N-API prebuilds and dependency-only packages are ignored.

## Alternatives considered

**Ship ESM-friendly pure-JS alternatives to `fs-ext`.** Removes the ABI problem, but replaces a working addon with a rewrite and is out of scope for a boot fix.

**Build the packaged addons on the CI host and rely on a single Node version.** Reduces but does not remove the drift: the packager host and the embedded Node are pinned independently, and rebuilding at package time keeps the two in sync no matter which versions are chosen.

**Bundle the addon compiled against the embedded Node at the source and skip the rebuild step.** Moves the mismatch earlier but leaves the same class of failure for any future embed/rebuild drift; rebuilding in `prepareDesktopResources` keeps the invariant next to the deploy that can break it.

## Consequences

- A packaged app boots on the first launch: the source-built addon now matches the embedded Node ABI instead of the packager host.
- The rebuild runs only on the packager's target OS and only when the tree holds a source-built addon, so an unaffected tree packages without the extra work.
- The packaging host must be able to compile native addons (Xcode CLT on macOS, Build Tools on Windows); a failure surfaces as a loud build error rather than a silent mis-bundle.
