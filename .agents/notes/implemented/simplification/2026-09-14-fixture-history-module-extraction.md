# Agent Note: Extracting the fixture provider's fx-alpha history script and message vocabulary (Issue #86)

Status: implemented

English | [中文](2026-09-14-fixture-history-module-extraction.zh.md)

## Problem

`packages/client/connection/src/client/fixture.ts` was 4052 lines. It is not a test fixture: it is the browser-mode `ClientConnectionRpc` provider that fabricates a session without a server, re-exported through `src/client/index.ts` and consumed by two specs in the package. Two unrelated kinds of content sat above the world it builds.

The first was authored data. `buildAlphaLog` is a 328-line script that produces 75 turns of session events (~150+ messages, four pages at `PAGE_MESSAGES=50`) and renumbers their `seq`. Seventeen samples exist only to be rendered by it: `USER_MARKDOWN_LITERAL`, the `sgr` wrapper and the terminal-output sample it escapes, two search result sets with their text projections, the seven `READ_SAMPLE_*` fragments, `WEB_SEARCH_META`, `WEB_FETCH_META`, and `FIXTURE_SYSTEM_PROMPT`.

The second was the fixture's message vocabulary: the four constructors that wrap content blocks into `UserMessage`, `AssistantMessage`, and `ToolResultMessage` values, plus the samples the live world also renders — the Markdown body of the history's last assistant turn, the durable attachment ref, the base64 PNG behind it, and the settled-stream builder that replays a static message.

The two regions read that vocabulary and nothing else in common. A reader changing how the live world renders an image had to find `FIXTURE_IMAGE_DATA` between the history script's terminal-output sample and its read samples, and neither region had a call edge into the 2400 lines of world-building below it.

[The split plan](../../implemented/simplification/2026-09-14-god-file-split-plan.md) names this cut as its batch-2 `fixture.ts` item. This note records what the cut produced.

## Decision

Three modules now hold the file. `src/client/fixture.ts` is 3475 lines.

| Module | Lines | Moved | Owns |
| --- | --- | --- | --- |
| `src/client/fixture.ts` | 3475 (was 4052) | — | The world: `FixtureAssistantStreamFrame`, `FixtureOptions`, `FixtureWorld`, `createFixtureFaces`, `createFixtureConnectionRpc`, and the samples those read (`DEEPSEEK_REASONING`, `OPENAI_REASONING`, `PERMISSION_PRESETS`, the token-estimate constants) |
| `src/client/fixture-messages.ts` | 138 | 69 | `text`, `userMessage`, `assistantMessage`, `toolResultMessage`, `MARKDOWN_FIXTURE`, `FIXTURE_IMAGE_DATA`, `FIXTURE_IMAGE_REF`, `fixtureUsage`, `fixtureSettledStream` |
| `src/client/fixture-alpha-log.ts` | 519 | 490 | `buildAlphaLog` plus the seventeen module-private samples only that script renders: `USER_MARKDOWN_LITERAL`, `sgr`, `TERMINAL_OUTPUT_FIXTURE`, `SEARCH_MATCHES_FIXTURE`, `SEARCH_MATCHES_TEXT`, `SEARCH_PATHS_FIXTURE`, `SEARCH_PATHS_TEXT`, the seven `READ_SAMPLE_*`, `WEB_SEARCH_META`, `WEB_FETCH_META`, `FIXTURE_SYSTEM_PROMPT` |

The entry keeps all five of its exports under the same names, and its consumers keep their import paths: `tests/fixture.client.spec.ts` and `tests/fixture-commands.client.spec.ts` still import `../src/client/fixture.ts`, and `src/client/index.ts` still imports `./fixture.ts`. Nothing outside those three files imports either new module.

### The shared vocabulary left the entry, because the entry imports both modules

`fixture.ts` imports `buildAlphaLog` and the vocabulary it reads, so neither new module can import the entry — that is the cycle this split exists to avoid. The nine names the two readers share landed in `fixture-messages.ts`, and their readers partition cleanly: `text`, `userMessage`, `assistantMessage`, `MARKDOWN_FIXTURE`, `FIXTURE_IMAGE_REF`, and `fixtureUsage` are read by both; `FIXTURE_IMAGE_DATA` is read only by the world; `toolResultMessage` and `fixtureSettledStream` are read only by the history script.

### Why the shared vocabulary did not go to `src/types.ts`

The plan's third rule puts shared vocabulary in `src/types.ts`, and the batch-1 cut followed it for `TableRecord` and the label tables that file carries. This cut deviates, and the reason is what the names are. `packages/AGENTS.md` scopes `src/types.ts` to a package's seam vocabulary — "its types plus the runtime values that vocabulary defines." These nine names are not seam vocabulary: they are fixture content, built by function bodies that call the `@deepseek-ai/dsh-llm/message` constructors, and no consumer of this package's RPC seam sees them. `src/types.ts` here sits at the package root and serves both faces of the seam, while the moved names are client-face-only; the analyzer's `types.ts` holds brand constructors, constants, and label tables, not content builders. The exemption that file enjoys from the per-file coverage gate — declaration files carry no executable code — would also be false of a module full of constructors.

The name is the second reason. `fixture-messages.ts` says what it carries; `src/types.ts` would leave the next reader to discover that the package's seam vocabulary file also holds a PNG.

### Two of the shared module's exports have no entry-side reader

`toolResultMessage` and `fixtureSettledStream` are read only by `fixture-alpha-log.ts`. They stayed in `fixture-messages.ts` rather than following their only reader, because each closes a group that would otherwise split. `toolResultMessage` is the fourth of four contiguous constructors — `text`, `userMessage`, `assistantMessage`, `toolResultMessage` — that differ only in the message type they build. `fixtureSettledStream` pairs with `fixtureUsage`: one billing and one replay, the two pieces that produce a fixture message stream.

The asymmetry is recorded rather than resolved. If a later cut gives `fixture-messages.ts` a second consumer, that is when the question of whether these two belong with the history script gets a real answer.

### The move is behavior-preserving, and checked mechanically

The two modules were produced by slicing the original file's line ranges, so byte-identity is checkable: every one of the 559 moved lines appears in its module in the same order as in the `HEAD` revision of `fixture.ts`, and the ten declaration lines that gained an `export ` prefix — nine in `fixture-messages.ts`, `buildAlphaLog` in the history script — are the only textual difference. Nothing was renamed, re-indented, or reformatted.

The entry's diff accounts for the rest: 588 lines deleted, 11 added, and all 11 additions are import wiring. Of the 588 deleted lines, 559 are the moved bodies, 13 are the import block that left with them plus blank separators, and 16 were rewritten rather than moved — two import lines (`createSystemMessage` left with the history script, `ToolCallId` left with `toolResultMessage`) and four documentation lines the new modules expand.

Nothing is left in both places: the entry no longer mentions `buildAlphaLog`, `sgr`, or any of the seventeen samples.

### The JSDoc the move had to add

`verify-export-jsdoc` scans `packages/*/*/src/**/*.ts`, and both new modules are `.ts`, so their exports enter a gate the entry's `fixture.ts` already satisfied. `fixture-messages.ts` gained nine JSDoc blocks: six `@param`/`@returns` blocks for its functions, and a one-line description for each of its three constants. `fixture-alpha-log.ts` gained one: `buildAlphaLog`'s two-line doc, which named the script's size, became a block that carries `@returns` as well. The seventeen samples stay module-private, so they need no documentation, and the comments that describe them moved verbatim.

That JSDoc, the two module headers, the imports, and the blank separators are the 98 lines the new modules carry beyond the 559 lines of moved code.

## Verification

| Check | Result |
| --- | --- |
| `pnpm run typecheck` (the pre-push gate) | passes, building both of the package's compiler faces |
| `pnpm exec vitest run packages/client/connection` | 14 files / 164 passed — the count before the cut |
| `pnpm exec vitest run packages/client` | 531 files / 7150 passed, 5 skipped |
| `pnpm exec tsx scripts/run-oxlint.ts packages/client/connection/src` | clean |
| `pnpm exec tsx scripts/verify-export-jsdoc.ts` | passes |
| `pnpm run duplication` | 0 clones across 2207 files |
| `pnpm run test:docs` | 18 passed, 0 failed, 0 skipped |
| line-by-line comparison | 559 of 559 moved lines present, in order; the only difference is the `export ` prefix on ten declarations |
| entry export names | the same five names on both sides |
| per-file coverage | both new modules at 100% statements, branches, functions, and lines under the package's existing fixture specs |

The batch's acceptance criteria hold: the entry exports the same names, no test needed a new import path, and no constant, default, or sample value changed.

`pnpm run typecheck` is the check that proves the new modules reach the package's compiler faces. This package publishes `tsconfig.host.json` and `tsconfig.client.json` leaves whose explicit `files` lists name every source file, so both new modules are registered in `tsconfig.client.json`. A package-level `tsc -p packages/client/connection/tsconfig.json --noEmit` does not establish this: that config is a solution with `files: []`, and without `-b` it type-checks no file. The pre-push gate found the omission, and the registration is part of this cut.

The per-file coverage gate needs no new exemption. The plan allows adding `vitest.config.ts` entries for a module carved out of an exempted file, and this cut first added two. Measuring before keeping them showed they were unnecessary: with the entries removed, `--coverage.reporter=json-summary` reports `fixture-alpha-log.ts` and `fixture-messages.ts` at 100/100/100/100, because the package's fixture specs already drive both readers. `vitest.config.ts` is unchanged, and the entry that would have hidden a future regression is absent. The package README needed no edit: it describes the browser-mode provider's behavior and carries no module inventory, so no statement in it went stale.

## Alternatives considered

- **Keeping `buildAlphaLog` in the entry and moving only the vocabulary.** Rejected: the script is the largest authored region of the file and the one a reader is least likely to be looking for when they open a provider, so leaving it in the entry keeps the problem this cut exists to remove.
- **Putting the shared vocabulary in `src/types.ts`, per the plan's third rule.** Rejected for the reasons in the Decision section: the names are fixture content rather than seam vocabulary, they are client-face-only, and a module with function bodies sits badly in a file whose coverage exemption assumes declarations alone.
- **A new `fixture-types.ts` beside the other two files.** Rejected: the nine names are constructors and samples, not types, and a name ending in `types` would mis-describe them while creating a second vocabulary home inside one package.
- **Merging the history script into `fixture-messages.ts`.** Rejected: the two modules have different reader sets — the world reads one and not the other — and the plan's cut is defined by that split.
- **Moving `toolResultMessage` and `fixtureSettledStream` in with their only reader.** Rejected for the reasons in the Decision section: it would split the four-constructor block and separate the settled-stream builder from `fixtureUsage`.
- **Adding `vitest.config.ts` exemption entries for the two modules.** Rejected after measurement: both are already at 100% coverage, so an entry would hide regressions rather than record debt.
- **Exporting `sgr` and the samples.** Rejected: nothing outside the history script reads them, and exporting them would widen two new modules' export lists for no caller.
- **Turning the samples into a JSON fixture file.** Rejected: the samples stand in for typed tool results — `SEARCH_MATCHES_FIXTURE` declares `{ path: string; matches: { lineNumber: number; line: string }[] }[]` — and a JSON file would carry those values without the declarations that check them.
- **Splitting the history script itself in the same cut.** Rejected as premature: its body is one `push` sequence whose turns reference shared local state (`toolTurn`, `dispatchPair`), so separating the structured samples from the turn loop needs a decision about whether the loop is data or code. That decision is not this cut's to make.

## Consequences

`fixture.ts` is 577 lines shorter and holds the world plus the samples the world reads. The accounting is 559 lines moved, 657 lines in the two new files, and 11 lines of import wiring in the entry replacing the imports it no longer needs; the 98-line growth is module headers, imports, blank separators, and the JSDoc the export gate requires.

The fixture's behavior is unchanged, and the cut has a cost worth naming: the history script and the message vocabulary now live in files whose names say which reader they serve, so a change to how the fixture builds messages starts in `fixture-messages.ts` and a change to the shipped log starts in `fixture-alpha-log.ts`. The history script imports eight names from the message module and the message module imports nothing from it.

`fixture.ts` is still 3475 lines. The plan's remaining cuts inside it are the world's own regions, and this cut left them alone deliberately: `createFixtureFaces` and `createFixtureConnectionRpc` are the package's two provider entry points, and carving their internals needs a boundary decision this move did not have to make.

## Related

- [Splitting the seven god files](../../implemented/simplification/2026-09-14-god-file-split-plan.md) (the plan; this is its batch-2 `fixture.ts` item)
- `src/client/trajectory-record-inspector.tsx` and `src/client/trajectory-resize-handle.ts` (the batch-2 sibling cut in `ui-trajectory`, landing as its own pull request)
- [Extracting the trajectory ledger's record model and presentation helpers](2026-09-14-trajectory-ledger-module-extraction.md) (batch 1, `ui-trajectory`; established the `src/types.ts` home this cut deviates from)
- `packages/AGENTS.md` (where a package's seam vocabulary lives)
