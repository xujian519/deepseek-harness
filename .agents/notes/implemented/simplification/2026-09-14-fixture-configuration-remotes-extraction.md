# Agent Note: Extracting the fixture's configuration remotes (Issue #86)

Status: implemented

English | [中文](2026-09-14-fixture-configuration-remotes-extraction.zh.md)

## Problem

[The file-system cut](2026-09-14-fixture-file-system-module-extraction.md) sorted the body of `createFixtureWorld` by what state each region captures and moved the one kind it could move whole. Its own table named the second kind and stopped there: `settingsRemotes`, `credentialRemotes`, and `presetRemotes` are self-contained too, but they capture **three** pieces of mutable state — `fixtureCredentials`, `fixturePresets`, `fixtureDefaultPreset` — rather than one, which that note called "the next cut's boundary decision."

The same cut stated the template that decision calls for: **a cluster takes the world's values as parameters and owns the state it mutates.** What it did not settle is the plural. Three state bindings can become three factories, one factory, or one factory that receives an accessor into the world's state.

The question is not stylistic. Two of the three clusters are genuinely independent, and one of them is not: `settingsRemotes.openAgentPresetDirectory` reads the same `fixturePresets` map that `presetRemotes` reads and writes.

## Decision

`src/client/fixture-configuration-remotes.ts` holds the fixture's three configuration clusters and the state they own. The entry keeps the world and calls into it with no values at all.

| Module | Lines | Owns |
| --- | --- | --- |
| `src/client/fixture.ts` | 2483 (was 2675) | the wire vocabulary, the session-query mirrors, and the world |
| `src/client/fixture-configuration-remotes.ts` | 246 | the settings, credential, and agent-preset remotes and their stores |

The module's header states its boundary:

```ts
// The fixture's configuration remotes: the settings, credential, and
// agent-preset clusters, together with the writable state they own.
```

### One factory, and it takes no parameters

The signature is `createConfigurationRemotes()`. The file-system cut's factory needed `home`; this one needs nothing, and that is a measurement rather than a preference. Every reference to `fixtureCredentials`, `fixturePresets`, and `fixtureDefaultPreset` in the entry's 2675 lines sits inside the three moved ranges — the two state declarations the cut carried, and the methods that read or write them. No `open*` generator, no `timingHooks` method, and no other remote touches them.

The zero-argument factory also preserves the property the file-system cut needed its factory for: each call returns an independent store. This package's own specs and the keyless browser acceptance build several worlds in one process, and a module-level `fixturePresets` would let a preset one world copied appear in another.

### Three clusters, one factory

`fixtureCredentials` has no reader in common with the other two, so the credential cluster could stand alone. `fixturePresets` does: `settingsRemotes` reads the roster to decide whether a preset's directory is openable, and `presetRemotes` reads and writes it, including the default.

Splitting into two factories would force the presets map through the boundary as a parameter on one side or the other. That is exactly the *passing a world-state accessor into the factory* alternative [the file-system note](2026-09-14-fixture-file-system-module-extraction.md) rejected by name — and here it would not even be a value, since `presetRemotes` writes the same binding `settingsRemotes` reads. One factory states the ownership once: these three clusters are the fixture's writable configuration, and the module holds it.

The three member interfaces and the factory's return interface are declared but not exported, following `FixtureDirectoryPickerRemotes` in `fixture-file-system.ts`. Annotating each object literal with its interface keeps every method signature stated once — `verify-export-jsdoc` requires an explicit return type on the exported factory, and that return type names the three. Not exporting them also keeps them outside that gate, which checks exported names only.

### The dispatch table does not change

The entry receives the three remotes by name:

```ts ignore-check
const { settingsRemotes, credentialRemotes, presetRemotes } = createConfigurationRemotes()
```

The `agentPresets/*` arms, the three `credentials/*` arms, and the six `settings/*` arms resolve those names exactly as before, so all fourteen arms are byte-unchanged. `createFixtureWorld` keeps `rpc` as its only returned value, and the entry's export list keeps its five names.

No re-export was needed. The three clusters and their stores were never part of the entry's exports, and the two spec files that reach the entry import only `createFixtureFaces` and `createFixtureConnectionRpc`.

### Order is preserved, so the deferred reads still resolve

`settingsRemotes` is declared before `fixturePresets` in the moved region, exactly as it was in the entry, and `openAgentPresetDirectory` reads that map from inside a method body. This works today because the method body evaluates at call time, not at object construction, and the cut keeps the order that makes it true rather than reordering the region to make it unnecessary. The success path of `openAgentPresetDirectory` — a user-authored preset, whose directory opens — is one of the new spec's cases, so the deferred read is exercised rather than assumed.

## The move is a slice, and checked by byte accounting

| Quantity | Count |
| --- | --- |
| Module lines | 246 |
| Traced line-for-line to `HEAD`'s `fixture.ts` | 193 |
| — byte-identical | 190 |
| — changed by a declared edit | 3 |
| Newly authored | 53 |
| Entry lines deleted | 194 |
| Entry lines inserted | 2 |
| `fixture.ts` | 2483 (was 2675) |
| `createFixtureWorld` span | 1756 lines (was 1947), same span definition on both sides |

The two traced ranges are `HEAD` 725–837 (113 lines, already contiguous) and 1367–1446 (80). No transform was needed to move them: both sat at two-column indent inside `createFixtureWorld`, and the factory body is at the same indent, so all 193 lines are byte-identical to `HEAD` as written. The range sequence is preserved, so the module's moved region is an ordered subsequence of the entry's.

The 3 changed lines are the three object literals, which name their interface:

```ts ignore-check
const settingsRemotes: FixtureSettingsRemotes = {
```

The 53 new lines are, in file order: the two-line module header and the blank after it (3); the five imports and the blank after them (6); the four interfaces with the blanks between them (33); the factory's JSDoc and signature (8); and the blank and `return` that close it (2). The 1 remaining new line is the blank separating the two traced ranges, which `HEAD` filled with the 529 lines that stay in the entry.

Two entry edits accompany the move. The `//` comment, the three clusters, and the four state lines leave as one contiguous block at 725–837, and `presetRemotes` leaves at 1367–1446; the wiring line takes the first block's place. The entry also drops `CredentialInfo` and `SettingsDescribeValue`/`SettingsNamespaceView`, whose only readers moved, and imports `createConfigurationRemotes` instead — required rather than tidy, since `noUnusedLocals` would report TS6133 on the two abandoned imports. `RpcResult` and `SessionId` keep readers in the entry and stay.

## Tests become possible, so they were written

These three clusters had no test at all: they lived under the `TODO(gui)` coverage exemption `vitest.config.ts` holds over `fixture.ts`. Extracting them into a file of their own would make the per-file gate fail on them immediately, so the cut chose between a second exemption and writing the tests.

It wrote `tests/fixture-configuration-remotes.client.spec.ts`, 15 cases, and left `vitest.config.ts` unchanged. Every documented failure branch is covered: the three write methods' `settings/rejected`, `openAgentPresetDirectory`'s unknown-name and system-trust refusals plus its success path, `credentials/describe` in both configured states, `presets/read` on a missing id, `copy` on a missing source and a taken name plus its success path, and `deletePreset` on a system preset and on a user-authored one. The factory's isolation is asserted directly, by mutating one call's roster and reading another's.

Measured with `--coverage.reporter=json-summary`, the module reports 100% statements, branches, functions, and lines (41 statements, 14 branches, 17 functions). The module carries no `v8 ignore`.

## Verification

| Check | Result |
| --- | --- |
| `pnpm exec vitest run packages/client/connection` | 16 files / 201 passed — the 15 files / 186 before the cut, plus the new spec |
| module coverage (`--coverage.reporter=json-summary`) | 100% statements / branches / functions / lines; no `vitest.config.ts` edit |
| `pnpm run typecheck` | exit 0, both compiler faces |
| `pnpm exec tsx scripts/run-oxlint.ts packages/client/connection/src packages/client/connection/tests` | exit 0 |
| `pnpm exec tsx scripts/verify-export-jsdoc.ts` | exit 0 |
| `pnpm run duplication` | exit 0 |
| `pnpm run test:web` (local) | not run as a pass signal: this fork's committed aria goldens and brand text already fail 43 files / 65 cases before the cut, and the change is behavior-preserving by construction |
| `pnpm run doc-sync` (local) | 33 gates pass, 3 fail — `verify-doc-graphs`, `verify-config-catalog`, `verify-package-paths`; none names a file this cut touched |
| byte accounting | 190 of the 193 traced lines byte-identical; the 3 changed and 53 new lines enumerated above |
| entry exports | the same five names |

`pnpm run typecheck` is the check that proves the new module reaches the package's compiler faces. This package's `tsconfig.client.json` names every source file in an explicit `files` list, so the new module is registered there; without that entry the entry's import is TS6307. A package-level `tsc -p packages/client/connection/tsconfig.json` establishes nothing — that config is a solution with `files: []`.

## Alternatives considered

- **Three factories, one per cluster.** Rejected: `settingsRemotes` and `presetRemotes` share `fixturePresets`, so the presets store would have to be passed in, and it is written by one factory and read by the other. That is a world-state accessor at the boundary under another name.
- **Two factories — credentials separate, settings and presets together.** Rejected: the credential store is independent, but it belongs to the same subject. Two factories buy nothing a reader can act on and cost an extra entry binding plus a second statement of which module owns the fixture's writable configuration.
- **Reordering the region so the state is declared before every cluster that reads it.** Rejected under "no unrequested behavior changes": the deferred read already resolves, the order is the one `HEAD` has, and preserving it keeps the moved region an ordered subsequence of the entry — which is what makes the byte accounting above a usable check.
- **Exporting the four interfaces.** Rejected: no consumer outside the module names them. `verify-export-jsdoc` would then require documented members, and `src/types.ts` exists for a package's seam vocabulary rather than a fixture's internal one.
- **Giving the factory a parameters object for symmetry with `createDirectoryPickerRemotes(home)`.** Rejected: a parameter no cluster reads is a standing invitation for the next region to reach through it. The absent parameter is the finding.
- **Adding a `vitest.config.ts` exemption, following the projection cut.** Rejected: these regions are reachable now that they are outside the world, and the file-system cut's own precedent is to write the tests the extraction makes possible.

## Consequences

`fixture.ts` is 192 lines shorter and `createFixtureWorld` is 191 lines shorter, leaving the dispatch table as the only region its own note classifies as coupled and unmoved. A reader changing how the fixture answers a settings, credential, or agent-preset call opens `fixture-configuration-remotes.ts`; a reader changing how the world stores sessions, workspaces, or events stays in the entry.

The cost is one more file, one more `tsconfig.client.json` entry, and 53 authored lines of header, interfaces, and factory framing against 193 moved ones. The remaining region is the `rpc` dispatch table (now 2249–2459, 211 lines), which needs its roughly twenty handlers compiled into an interface before it can move — a larger boundary decision than either remote cluster's.

The template this cut confirms is the file-system cut's, now with its degenerate case recorded: **a cluster takes the world's values as parameters and owns the state it mutates — and when it takes nothing, it takes nothing.** A zero-parameter factory is the correct answer when every value the cluster reads is one it owns.

The module family and its sibling fixture modules — `fixture.ts`, the extracted `fixture-*` modules, and their specs — were later replaced wholesale by upstream with `@deepseek-ai/dsh-remote-mock` and `apps/web/tests/assembled-remote.ts`.

## Related

- [Splitting the seven god files](../../implemented/simplification/2026-09-14-god-file-split-plan.md) (the plan; this is its batch-2 `fixture.ts` item)
- [Extracting the fixture's in-memory file system](2026-09-14-fixture-file-system-module-extraction.md) (the cut that named this boundary question and the template this one applies)
- [Extracting the fixture provider's projection folds](2026-09-14-fixture-projections-module-extraction.md) (the cut before that)
