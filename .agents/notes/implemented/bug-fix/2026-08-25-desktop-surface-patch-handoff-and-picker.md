# Agent Note: Desktop-surface patch fixes for browser handoff and workspace picking

Status: implemented

English | [中文](2026-08-25-desktop-surface-patch-handoff-and-picker.zh.md)

## Problem

`packages/bundle/desktop-app/cordis.patch.yml` layers over `dsh-web-app` and restates two web-runtime rows by id. Cordis patch rows that target an existing id replace that row's `config` and swappable fields — but two failures hid behind that:

- The `web-runtime` restatement dropped `openBrowser`. The web-app layer feeds it from `--no-open` (`openBrowser: !!js ctx.webStartup.openBrowser`); the desktop restatement omitted the key, so the web-runtime schema default (`z.boolean().default(true)`) applied and the backend handed the URL to the OS browser a second time after the Electron window loaded it.
- The `directory-picker` restatement tried to swap providers by overriding `name`. But `applyEntryPatches` (vendor/include/src/index.ts:116-119) treats a patch row's `name` as an identity check: a row whose `name` differs from the target row's is warned "name mismatch" and skipped entirely. The electron provider never mounted; the desktop kept the web-app `directory-picker-auto` chooser, which resolves to the `native` backend on the desktop host (127.0.0.1, no SSH, macOS) — and native picking runs `osascript` from the bundled Node child, the path the desktop architecture rejected (native dialogs belong to Electron Main's `dialog.showOpenDialog`). The Add-workspace affordance rendered (auto mounted a native client surface) but picking a folder failed in the packaged app.

## Decision

Two edits in `desktop-app/cordis.patch.yml` plus one in the host RPC:

- Pin `openBrowser: false` on the desktop `web-runtime` restatement. The Electron window is the UI surface; the desktop must not hand the URL to the system browser regardless of invocation flags (the caller's `--no-open` cannot be relied on across the child-process boundary). A manual `dsh --profile desktop` therefore no longer auto-opens a browser — the intended desktop-surface semantics.
- Disable the auto row and pin the electron pair explicitly, since a provider cannot be swapped by overriding `name`:

  ```yaml
  - id: directory-picker
    disabled: true
  - insert:
      - id: directory-picker-desktop
        name: '@deepseek-ai/dsh-desktop-directory-picker'
      - id: ui-directory-picker
        name: '@deepseek-ai/dsh-client-ui-directory-picker-native'
  ```

  The electron provider is inserted under a new id (the disabled auto row keeps its id, so reusing it would be ambiguous to later id-based patches). The client surface is the existing `ui-directory-picker-native` browser half — it drives the `directoryPicker/pick` verb and branches on no capability kind, so the desktop reuses it to occupy the directory-flow holes.
- The Host pick verb gates on the capability's own verbs instead of the `native` literal: `if (!('pick' in capability))`. The seam is merge-extensible and the `electron` kind is merged only into the desktop program, which the Host type-checker cannot see; a presence check fails closed for browse-only and unknown kinds while serving native and electron alike. The verb now lives at `DirectoryPickerController.requireCapability` (`packages/api/workspace-controller/src/directory-picker.ts`) after the Remote migration retired `host.pickDirectory`; see [2026-09-01](2026-09-01-directory-picker-verb-gating-regression.md) for the regression that migration introduced and the test that now guards it.

## Alternatives considered

**Override the provider by keeping the `name`-carrying patch row.** Rejected because `applyEntryPatches` skips any row whose `name` differs from its target: it is an identity check, not a rename.

**Reuse the `directory-picker` id for the inserted electron row.** Rejected: the disabled auto row stays in the list, so a same-id insert makes later id-based patches and lookups ambiguous.

**Add a new `ui-directory-picker-electron` client surface.** Rejected because the native browser surface only drives `host.pickDirectory`; it branches on no capability kind, so the electron interaction needs no new copy.

## Consequences

The desktop boots the electron directory-picker (Main-process `dialog.showOpenDialog` via the bridge) instead of the failing osascript path. The auto chooser's own native backend and client surface stay off, so no duplicate `ctx.directoryPicker` registration. `host.pickDirectory` now serves the seeded `electron` capability under the same shape as native. Packaging bookkeeping follows: `scripts/desktop-package.ts` `REQUIRED_BACKEND_PATHS` and its spec mirror gained the two patch-layer specifiers (patch-layer names are not statically imported, so `findUnresolvableBackendImports` cannot prove them), and `tsconfig.base.json` gained an explicit `dsh-client-ui-directory-picker-native` path entry (the generic `@deepseek-ai/dsh-*` wildcard mis-resolves it to a non-existent folder).
