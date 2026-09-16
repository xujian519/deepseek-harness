# Agent Note: Extracting the fixture's in-memory file system (Issue #86)

Status: implemented

English | [中文](2026-09-14-fixture-file-system-module-extraction.zh.md)

## Problem

[The projection cut](2026-09-14-fixture-projections-module-extraction.md) left `packages/client/connection`'s `src/client/fixture.ts` at 2897 lines and named the reason it stopped there: every cut so far had extracted **module-level pure functions**, and the 2172-line body of `createFixtureWorld` (704–2875) held regions that do not qualify. [The split plan](../../implemented/simplification/2026-09-14-god-file-split-plan.md) put what remained here in batch 2 — *cuts that need an interface settled first* — without naming what that interface would be. The open question was **how a cluster reaches the world's state**.

Sorting the body's regions by what state they capture answers it. Reading each region against its own symbol references:

| Kind | Regions | Why |
| --- | --- | --- |
| Self-contained | `workspaceFileRemotes`, `directoryPickerRemotes` and their datasets | read no world state beyond their own |
| Self-contained, deferred | `settingsRemotes` / `credentialRemotes` / `presetRemotes` | touch only `fixturePresets` / `fixtureCredentials` / `fixtureDefaultPreset` |
| Coupled | `sessionApi`, the `rpc` dispatch table, `timingHooks`, `workspaceApi`, the five `open*` generators, `commandRemotes` / `goalRemotes` / `referenceRemotes` | interlock through `logOf` (a read that mutates) and `append` (which writes `logs`, bumps `sessions[].updatedAt`, and emits follow/control/remote frames) |

This cut takes the first row and, with it, settles the question the plan left open.

## Decision

`src/client/fixture-file-system.ts` holds the in-memory file system. The entry keeps the world and calls into it with one value.

| Module | Lines | Owns |
| --- | --- | --- |
| `src/client/fixture.ts` | 2483 (2897 before this cut, 2675 as it landed) | the wire vocabulary, the session-query mirrors, and the world |
| `src/client/fixture-file-system.ts` | 255 | the workspace-file reads and the directory-picker browse tree |

The module's header states its boundary:

```ts
// The fixture's in-memory file system: the read-only workspace-file remotes
// every world shares, plus the directory-picker remotes whose browse tree is
// created per world.
```

### The world passes its home directory; the cluster owns its mutable state

The factory signature is `createDirectoryPickerRemotes(home: string)`. It is the only state that crosses the boundary, and it is a value, not a reference to the world.

`FIXTURE_HOME` stays in the entry. `workspaces[0].path` (854) and the `ready` frame's `host.home` (2184) read it too, so the entry owns it and hands it to the factory:

```ts ignore-check
// The picker tree is per-world; the shared read-only workspace-file remotes live in the module.
const directoryPickerRemotes = createDirectoryPickerRemotes(FIXTURE_HOME)
```

The browse tree `directoryTree` — written only by `createDirectory` — is created inside the factory, so each world gets its own. This is not tidiness. This package's own specs and the keyless browser acceptance both build several worlds in one process; a module-level tree would let a directory one world created appear in another, making assertions depend on execution order.

Only the picker half needs that isolation, so only it is a factory. The workspace-file dataset and its path and paging helpers read module-level data and pure functions, and every world computes the same answers from them; a zero-argument factory would mint a fresh stateless object per world and write "the whole file system is per-world" into the structure, which is false.

### Three exports, all with a reader in the entry

`WORKSPACE_FILES_ROOT`, `workspaceFileRemotes`, and `createDirectoryPickerRemotes`. The entry imports all three.

`WORKSPACE_FILES_ROOT` is the one reverse dependency — the entry reads it at 2157 to build the `notes/demo.txt` path the fixture's file-change frame reports. The constant is the module's root and the module owns it; giving the entry a second home for the same path was the alternative and it is worse. It does not go through `src/types.ts`: that file carries a package's seam vocabulary, and this is a fixture root. The `rpc` dispatch table needed no edit at all — `workspaceFileRemotes` arrives as an imported binding under its own name, so the `workspaceFile/*` arms (2536–2542) and the `directoryPicker/*` arms (2476–2479) are byte-unchanged.

`FixtureWorkspaceEntry` is **not** exported. The concern that `declaration: true` would raise TS4023 is disproved by the repository: `fixture-projections.ts` declares a non-exported `FixtureRequestContext`, exported `lastRequestContext` returns it, and the emitted `lib/types/client/fixture-projections.d.ts` carries it as a non-exported interface referenced by name from the exported signature. Not exporting it also keeps it outside `verify-export-jsdoc`, which checks exported names only.

`FixtureDirectoryPickerRemotes` is likewise non-exported. It exists because `verify-export-jsdoc` requires an explicit return type on an exported function; making it the client's only home for the three method signatures keeps them from being stated twice. Annotating the object literal with it, instead of duplicating the signatures on the literal, is the reason four moved lines differ from `HEAD` (below).

## The move is a slice, and checked by byte accounting

The module was produced by cutting contiguous ranges out of the entry, so the check is arithmetic.

| Quantity | Count |
| --- | --- |
| Module lines | 255 |
| Traced line-for-line to `HEAD`'s `fixture.ts` | 227 |
| — byte-identical after the two declared transforms | 217 |
| — changed by a declared edit | 10 |
| The 3 `//` comment lines above `WORKSPACE_FILES_ROOT`, now a 5-line JSDoc | +2 |
| Newly authored | 26 |
| Entry lines deleted | 229 |
| Entry lines added, all import and factory wiring | 7 |
| `createFixtureWorld` body | 1946 lines (was 2172) |

The three traced ranges are `HEAD` 872–900 (29 lines), 1280–1429 (150), and 1431–1478 (48). Slice A moves whole: all 29 lines are byte-identical after the `FIXTURE_HOME` → `home` transform. The other two carry the edits below.

The two transforms are mechanical and reversible:

- **The whole module is dedented two columns.** The moved regions sat inside `createFixtureWorld`; slice B (`WORKSPACE_FILES_ROOT` through `workspaceFileRemotes`) now sits at module top level.
- **`FIXTURE_HOME` becomes `home`** at five sites: the two `directoryTree` seeds, `pick()`'s literal, `list`'s `path ?? home` fallback, and the listing's `home` field, which became the shorthand `home`.

The 10 changed lines are: the three `//` comment lines above `WORKSPACE_FILES_ROOT`, re-prefixed as JSDoc because the constant is now an export; `export ` added to that constant and to `workspaceFileRemotes`; the four lines of the picker object that name `FixtureDirectoryPickerRemotes`; and the listing's `home: home` field, which the transform collapses to the shorthand `home`.

The 26 new lines are, in file order: the three-line module header, a blank, the two imports and a blank (7); the blank after `workspaceFileRemotes` (1); the `FixtureDirectoryPickerRemotes` interface and the blank after it (6); the factory's JSDoc and signature (9); the blank before the picker's own JSDoc (1); and `return directoryPickerRemotes` and the closing brace (2).

One documentation change lands with the move: the 8-line JSDoc at `HEAD` 1280–1287 (`Workspace text reads under `?fixture`. …`) described `workspaceFileRemotes`, but its subject was declared 58 lines later, at 1346, on the far side of `WORKSPACE_FILES_ROOT`'s own comment. It now sits directly above `workspaceFileRemotes`, which is the declaration it describes. The moved lines are otherwise byte-identical and remain an ordered subsequence of `HEAD`.

## Tests become possible, so they were written

`workspaceFileRemotes` had no test at all and `directoryPickerRemotes` had one, because both lived under the `TODO(gui)` coverage exemption that `vitest.config.ts` holds over `fixture.ts`. Extracting them into a file of their own would have made the per-file gate fail on them immediately, so the cut had to choose between adding a second exemption and writing the tests.

It wrote the tests: `tests/fixture-file-system.client.spec.ts`, 22 cases. `vitest.config.ts` is unchanged.

This is the cut's justification under [the plan](../../implemented/simplification/2026-09-14-god-file-split-plan.md)'s own acceptance standard — *a test that becomes possible, an interface that becomes explicit, or a method that becomes readable* — and the module is what makes it possible: every branch runs against module-level data or a factory built on the spot, with no world, log, session, or transport in the way. The comment at `vitest.config.ts` for `fixture.ts` said `TODO(gui): cover and remove`; for this region that is now done rather than inherited by another file.

Measured with `--coverage.reporter=json-summary`, the module reports 100% statements, branches, functions, and lines (82 lines, 87 statements, 67 branches, 16 functions). The module carries no `v8 ignore`; the entry's six suppressions all sit outside the moved ranges.

## Verification

| Check | Result |
| --- | --- |
| `pnpm exec vitest run packages/client/connection` | 15 files / 186 passed — the 14 files / 164 before the cut, plus the new spec |
| module coverage (`--coverage.reporter=json-summary`) | 100% statements / branches / functions / lines; no `vitest.config.ts` edit |
| `pnpm run typecheck` | exit 0, both compiler faces |
| `pnpm exec tsx scripts/run-oxlint.ts packages/client/connection/src packages/client/connection/tests` | exit 0 |
| `pnpm exec tsx scripts/verify-export-jsdoc.ts` | exit 0 |
| `pnpm run duplication` | exit 0 |
| `pnpm run test:web` (local) | not a pass signal: 43 files / 65 cases fail on drift this cut did not cause — the committed aria goldens lack the `Deliverables` / `Board` / `Teams` tabs the plugins now render, and `built-boot` asserts the brand text `DSH Local Build` this fork renames. No failure names a fixture symbol. |
| `pnpm run doc-sync` (local) | 33 gates pass, 3 fail — `verify-doc-graphs`, `verify-config-catalog`, `verify-package-paths`; none names a file this cut touched |
| byte accounting | 217 of the 227 traced lines byte-identical; the 10 changed and 26 new lines enumerated above |
| entry exports | the same five names |

The byte accounting comes from diffing the module against `HEAD`'s entry over the three traced ranges after applying the two declared transforms, then classifying every module line as matched, changed, or outside the ranges. Every count above is that script's output; nothing is estimated.

`pnpm run typecheck` is the check that proves the new module reaches the package's compiler faces. This package's `tsconfig.client.json` names every source file in an explicit `files` list, so the new module is registered there; without that entry the entry's import is TS6307. A package-level `tsc -p packages/client/connection/tsconfig.json` establishes nothing — that config is a solution with `files: []`.

Deleting the entry's line 28 import of `DirectoryListing as FixtureDirectoryListing` is part of the same requirement: after the move its only reader is inside the new module, which imports the same alias, and `noUnusedLocals` would report TS6133. The alias keeps its name so the moved `list` signature is unchanged.

## Alternatives considered

- **A factory for `workspaceFileRemotes` too, for symmetry.** Rejected: its methods read module-level data and pure helpers, so every world gets identical answers and a factory would only manufacture a stateless object per call. It would also make "the whole file system is per-world" look true, when only the picker's tree is.
- **Passing a world-state accessor into the factory** (a getter for logs, sessions, or the home). Rejected: neither region reads any of it. `home` is the whole crossing, and a wider parameter would invite the next region to reach through it.
- **Leaving `workspaceFileRemotes` in the entry and moving only the picker.** Rejected: the two regions are one subject — the fixture's in-memory file system — and the workspace-file half is the larger one. Splitting them would leave the entry owning the datasets while the module owned the tree that shares their shape.
- **Routing `WORKSPACE_FILES_ROOT` through `src/types.ts`.** Rejected: that file carries a package's seam vocabulary, this package has none, and the constant is the new module's own root rather than a word two modules share. The entry reading it back is one import, not a second owner.
- **Deriving the tree's ancestor nodes from `home`.** Rejected under "no unrequested behavior changes": the tree hardcodes `['/', ['home']]` and `['/home', ['fixture']]`, so any `home` other than `/home/fixture` would already be self-contradictory, and this cut has one caller passing the right value. The factory's JSDoc states that precondition instead.
- **Adding a `vitest.config.ts` exemption, following the projection cut.** Rejected: that cut inherited gaps it could not reach from inside the world. These regions are reachable now that they are outside it, and the exemption would have discarded the cut's only defence.
- **Moving `settingsRemotes` / `credentialRemotes` / `presetRemotes` in the same cut.** Deferred, not rejected: they are self-contained in the same way and need the same treatment, but they capture three pieces of mutable state (`fixturePresets`, `fixtureCredentials`, `fixtureDefaultPreset`) rather than one, which was the next cut's boundary decision. [That cut](2026-09-14-fixture-configuration-remotes-extraction.md) settled it with one zero-parameter factory holding all three.

## Consequences

`fixture.ts` is 222 lines shorter, and `createFixtureWorld` is 226 lines shorter. A reader changing how the fixture answers a workspace-file read or a directory-picker browse opens `fixture-file-system.ts`; a reader changing how the world stores sessions, workspaces, or events stays in the entry. The file system is still not covered by the entry's `TODO(gui)` exemption, and its tests run on every `test` invocation.

The cost is one more file, one more `tsconfig.client.json` entry, and one constant the entry reads back. The template this cut sets for the rest of the world is the factory signature: **a cluster takes the world's values as parameters and owns the state it mutates.**

The three deferred remote clusters [have since landed](2026-09-14-fixture-configuration-remotes-extraction.md) in `fixture-configuration-remotes.ts`. The remaining region is the `rpc` dispatch table (2249–2459, 211 lines in the entry as it stands now), which needs its roughly 20 handlers compiled into an interface before it can move — a larger boundary decision than the file system's.

Two stale points this cut leaves alone. `fixture.ts` carries two stacked doc comments above `referenceRemotes` (1209–1210): the Goal Remote line that belongs to the `goalView` declaration above it, then the reference-discovery line that describes the constant. And the plan's own lines 30–31 still say `fixture.ts` contains a `jscpd:ignore` block, which moved to `fixture-projections.ts` in the previous cut.

The module family and its sibling fixture modules — `fixture.ts`, the extracted `fixture-*` modules, and their specs — were later replaced wholesale by upstream with `@deepseek-ai/dsh-remote-mock` and `apps/web/tests/assembled-remote.ts`.

## Related

- [Splitting the seven god files](../../implemented/simplification/2026-09-14-god-file-split-plan.md) (the plan; this is its batch-2 `fixture.ts` item)
- [Extracting the fixture provider's projection folds](2026-09-14-fixture-projections-module-extraction.md) (the previous cut in this file, and the one that named this boundary question)
- [Extracting the fixture provider's fx-alpha history script and message vocabulary](2026-09-14-fixture-history-module-extraction.md) (the first batch-2 cut in this package)
