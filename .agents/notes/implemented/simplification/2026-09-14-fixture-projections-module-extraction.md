# Agent Note: Extracting the fixture provider's projection folds (Issue #86)

Status: implemented

English | [中文](2026-09-14-fixture-projections-module-extraction.zh.md)

## Problem

After [the history-module cut](2026-09-14-fixture-history-module-extraction.md), `packages/client/connection/src/client/fixture.ts` was 3475 lines. Three kinds of content share it: the wire types the browser-mode provider answers with, the session-query mirrors that derive them, and `createFixtureWorld`, the 1596-line body that serves both.

A fourth kind sat in the middle. Between `sid` (443) and `backscanGoal` (1170), 737 lines read a whole session log and return one projection unit's current value: plan mode, the permission select over the fixture's presets, the last request context, token and context statistics, the `model/selection` value, the per-key frames a control event advances, and the goal backscan.

Those 737 lines were not contiguous. `pageOf`, `logReferencesAttachment`, and the search family — `searchBlockText`, `searchEventText`, `searchTokenSpans`, `phraseMatch`, `searchSnippet`, `compareSearchCandidates` — occupied 953–1123, between `projectionFramesOf` and `backscanTodos`. A reader following the folds crossed the query mirrors; a reader following the query mirrors crossed 500 lines of folds. The goal backscan resumed after them, so the fold family was two runs with an unrelated region wedged between.

None of the folds read world state. Each takes a log and returns a value, and every one of them is called by `createFixtureWorld` — from `projectionFramesOf(id, log, event)` at 1055 to `projectionValuesOf(snapshot)` at 2457. The dependency runs one way, so the region has a boundary a reader can name.

[The split plan](../../implemented/simplification/2026-09-14-god-file-split-plan.md) names this cut as the second of its batch-2 `fixture.ts` items, after the history script. This note records what the cut produced.

## Decision

`src/client/fixture-projections.ts` now holds the folds. The entry keeps the wire types, the query mirrors, and the world.

| Module | Lines | Owns |
| --- | --- | --- |
| `src/client/fixture.ts` | 2897 (was 3475) | The wire vocabulary (`FixtureSessionApi`, `FixtureControlFrame`, `FixtureWorkspaceApi`), the session-query mirrors (`pageOf`, the search family), `FixtureOptions`, `FxInbox`, and the world (`createFixtureFaces`, `createFixtureWorld`, `createFixtureConnectionRpc`) |
| `src/client/fixture-projections.ts` | 631 | Twelve exports — `ModelSelection`, `FixtureProjectionFrame`, `FxGoalProjection`, `FxGoalChange`, `foldPlan`, `PERMISSION_PRESETS`, `permissionSelectOf`, `lastRequestContext`, `projectionValuesOf`, `sameModelSelection`, `projectionFramesOf`, `backscanGoal` — over seventeen module-private names |

The module's header states its boundary:

```ts
// The fixture's mirrors of the host projection units. Each fold reads the whole
// session log and returns one unit's current value; `projectionFramesOf` says
// which units an appended event advances. Nothing here reads world state.
```

The entry keeps all five of its exports under the same names, and its consumers keep their import paths: `tests/fixture.client.spec.ts` and `tests/fixture-commands.client.spec.ts` still import `../src/client/fixture.ts`, and `src/client/index.ts` is unchanged. Nothing outside those three files imports the new module.

### Every exported name has a reader in the world

The twelve exports were dictated by the entry's own call sites, not chosen for symmetry. Eight are runtime values the world calls; four are types it names. `FixtureProjectionFrame` is a member of the entry's `FixtureControlFrame` union (261), `ModelSelection` types the model-bar map (713) and the selection the bar commits (2139), and `FxGoalProjection`/`FxGoalChange` shape the goal handlers (1065, 1092, 1226, 1552, 1566). No name was exported because it looked like it belonged with the others.

### The private names moved because their only readers moved

Seventeen names stay module-private: ten helpers, four projection interfaces, and three token-estimate constants. All seventeen are read only inside the new module — the entry mentions none of them.

`isFixtureTokenDelta` is the one worth naming, because it sat 180 lines above the folds' first function in the old file and reads like transport code. Its only two readers (205, 212) are inside `sessionStatsOf`, so it followed them. It keeps the `jscpd:ignore-start`/`end` pair the old file wrapped it in: the block records that the standalone fixture mirrors host timing without importing a target implementation, and the pairing is unchanged by the move.

### The move is a slice, and checked by byte accounting

The module was produced by cutting contiguous ranges out of `fixture.ts`, so the check is arithmetic rather than review:

| Quantity | Count |
| --- | --- |
| Module lines | 631 |
| Header comment and imports | 10 |
| Code lines | 621 |
| — byte-identical to lines in `HEAD`'s `fixture.ts` | 582 |
| — new | 39 |
| Entry lines deleted | 593 |
| Entry lines added, all import wiring | 15 |
| Declaration order | the old file's, with one inversion |
| `HEAD` fold-family lines that survive in neither file as written | 16 |

The 39 new lines are: `export ` on twelve declarations; a one-line description for each of the two exported interfaces, which had none; and 25 lines extending doc comments with `@param`/`@returns`.

The 16 lines are the twelve declarations whose only textual difference is the `export ` prefix, plus four one-line comments that became blocks. Three of the four stayed where they were and grew; the fourth, `/** Fixture parallel of the host's projection units: whole current values per key over the full log. */`, was reflowed and attached to `projectionValuesOf`, the function it describes. In the old file it sat above `PERMISSION_PRESETS`, 290 lines away from its subject, and immediately above that constant's own comment. That relocation is the only content change this cut makes, and it is a documentation fix rather than a behavior change.

The one inversion is deliberate: `FixtureProjectionFrame` (old 250) now follows `ModelSelection` (old 52) so the module opens with its two exported wire interfaces, and the `isFixtureTokenDelta` block (old 72) follows them. Everything else keeps the old file's order, verified by walking the copied lines as an ordered subsequence of `HEAD`.

### Why `pageOf` and the search family stayed

They are the mirrors of a different seam. The folds answer "what is this unit's current value"; `pageOf` and the search family answer "which slice of the log does this query see", which is why `pageOf` reads `FIXTURE_SESSION_SEARCH_RESULT_LIMIT` and the search family reads `ContentBlock` text. They answered a query the world serves at `session/search` and `session/page`, not a projection the world publishes.

The cut that owns them is the entry's next one, and it needs a decision this move did not have to make: whether the query mirrors belong beside the wire types they derive from or beside the world's query handlers.

## Verification

| Check | Result |
| --- | --- |
| `pnpm run typecheck` (the pre-push gate) | exit 0, building both of the package's compiler faces |
| `pnpm exec vitest run packages/client/connection` | exit 0, 14 files / 164 passed — the count before the cut |
| `pnpm exec tsx scripts/run-oxlint.ts packages/client/connection/src` | exit 0 |
| `pnpm exec tsx scripts/verify-export-jsdoc.ts` | exit 0 |
| `pnpm run duplication` | exit 0, 0 clones across 2204 files |
| `pnpm run test:docs` | exit 0, 18 passed, 0 failed, 0 skipped |
| byte accounting | 582 of the module's 621 code lines byte-identical to `HEAD`; the 39 new lines enumerated above |
| declaration order | matches `HEAD` after undoing the one recorded inversion |
| entry exports | the same five names |
| test import paths | unchanged |

The batch's acceptance criteria hold: the entry exports the same names, no test needed a new import path, and no constant, default, or fold result changed.

`pnpm run typecheck` is the check that proves the new module reaches the package's compiler faces. This package publishes `tsconfig.host.json` and `tsconfig.client.json` leaves whose explicit `files` lists name every source file, so the module is registered in `tsconfig.client.json`. A package-level `tsc -p packages/client/connection/tsconfig.json --noEmit` does not establish this: that config is a solution with `files: []`, and without `-b` it type-checks no file.

### The coverage exemption is inherited debt, not a new one

The projection folds are not fully covered. Measured with `--coverage.reporter=json-summary` before adding an exemption entry, the module reports 93.38% statements, 85.08% branches, 100% functions, and 97.14% lines: 16 uncovered statements, all in branches the fixture's specs never drive — `plan/mode`, `sandbox/mode`, and `todo/write` frame handling, plus the `reasoningEffort === undefined` arm.

Those are the same gaps the entry's own exemption entry records. `fixture.ts` is listed in `vitest.config.ts` with the reason "Slash/command/input round: per-file gaps deferred with the same client-lane debt. TODO(gui): cover and remove with the lane above." Moving code out of an exempt file does not cover it, so `fixture-projections.ts` got its own entry naming the same lane. Without it the cut would fail the per-file gate on code the gate does not currently cover, which is a status change no part of this cut justifies.

## Alternatives considered

- **Writing the missing tests instead of adding the exemption entry.** Rejected: the 16 uncovered statements are the client-lane debt `fixture.ts` already defers under a `TODO(gui)`, and covering them means driving `plan/mode`, `sandbox/mode`, and `todo/write` through the fixture's command surface. That is a testing change with its own scope, not part of a behavior-preserving extraction.
- **Moving `pageOf` and the search family out in the same cut.** Rejected: their destination is an open question — beside the wire types or beside the world's handlers — and settling it inside a cut whose subject is the folds mixes two boundaries. The plan keeps them as the entry's next item.
- **Splitting the folds along the interleaving**, putting `backscanTodos`/`backscanGoal` in a third module. Rejected: the goal backscan is a fold like the others (it reads the log and returns a current value), and the only thing separating it from them in the old file was the query mirrors. A module created by where an unrelated region happened to sit would carry that accident as its name.
- **Keeping `projectionFramesOf` in the entry.** It reads `SessionId` and the world's control relay calls it directly, so it could have stayed. Rejected: it shares `isFixtureTokenDelta` and the usage folds with `projectionValuesOf`, so keeping it in the entry would force the entry to import five private names from the module, growing the coupling instead of shrinking it.
- **Routing the four projection interfaces and the shared types through `src/types.ts`.** Rejected for the reason the sibling cut records: these are client-face fixture internals, not this package's seam vocabulary, and none of them appears in the RPC seam the package publishes.
- **Exporting the ten private helpers so the entry could reuse them.** Rejected: the entry calls none of them, and OXC's `no-unused-vars` would have nothing to say — an unread export is a name the next reader has to rule out.
- **Turning the module into a `createProjectionFold(log)` closure the world instantiates once.** Rejected: every fold is called with a different log (`logOf(id)`, a snapshot, the full log), and the world's handlers already pass the log they mean, so a captured log would be wrong more often than it was convenient.

## Consequences

`fixture.ts` is 578 lines shorter and holds the wire vocabulary, the query mirrors, and the world. A reader changing how the fixture projects plan mode opens `fixture-projections.ts`; a reader changing how it answers a session query stays in the entry. The two regions no longer interleave.

The cost is one more file, one more coverage exemption entry carrying a `TODO(gui)` that outlives this cut, and one comment moved to the function it describes. The module imports nine names in five statements from `@deepseek-ai/dsh-llm`, `dsh-session`, and `dsh-tool-todo`, and the entry imports twelve back; nothing else changed direction.

`fixture.ts` is still 2897 lines. The plan's remaining cuts inside it are the query mirrors and the world's own regions; `createFixtureWorld` at 1596 lines is now the largest single body in the package, and carving it needs a boundary decision this move did not have to make.

## Related

- [Splitting the seven god files](../../implemented/simplification/2026-09-14-god-file-split-plan.md) (the plan; this is its second batch-2 `fixture.ts` item)
- [Extracting the fixture provider's fx-alpha history script and message vocabulary](2026-09-14-fixture-history-module-extraction.md) (the batch-2 sibling cut in this package)
- [Extracting the trajectory ledger's record model and presentation helpers](2026-09-14-trajectory-ledger-module-extraction.md) (batch 1, `ui-trajectory`)
