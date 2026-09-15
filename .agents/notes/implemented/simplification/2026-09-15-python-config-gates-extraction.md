# Agent Note: Extracting the python backend's load-time gates (Issue #86)

Status: implemented

English | [中文](2026-09-15-python-config-gates-extraction.zh.md)

## Problem

`packages/experimental/code-runtime-python/src/index.ts` was 1638 lines. Roughly 450 of them were load-time admission rather than runtime: the `Config` interface, the fixed bounds its gates are written against, the interpreter lookup and version probe, and a constructor whose gates and interpreter resolution ran for 168 lines before registering anything. The code that actually supervises a child process — spawn, fd-3 frames, kill escalation, settlement — came after all of it.

[The split plan](../../implemented/simplification/2026-09-14-god-file-split-plan.md) holds this item in batch 3 and names the risk that keeps it there: the constructor sits inside a `/* jscpd:ignore-start */` block whose comment declares its shape parallel to the sibling `code-runtime-worker-thread` backend, and rule 1 of the plan requires the matching side or an amended comment before that block is touched.

## Decision

`packages/experimental/code-runtime-python/src/config.ts` (510 lines) owns load-time admission; `index.ts` is 1180 lines and its constructor is four statements.

| Moved | Form in the new module |
| --- | --- |
| `Config`, `ResolvedConfig` | the module's exported configuration types; the entry re-exports `Config` unchanged |
| the bounds the gates check (`FRAME_PARSE_CAP_BYTES`, `FRAME_ENVELOPE_BYTES`, `MIN_LOG_BYTES`, `CLOSE_REAP_MARGIN_MS`, `OUTPUT_BUDGET_WORST_CASE_ADDRESS_SPACE_MULTIPLE`, `INTERPRETER_BASELINE_BYTES`, `HOST_PARSE_WORST_CASE_MULTIPLE`, `HOST_PARSE_BASELINE_BYTES`, `MIN_CPYTHON`, `PYTHON_PROBE_TIMEOUT_MS`) | module-local consts beside the gate that reads them; `CLOSE_REAP_MARGIN_MS` is exported because the settlement deadline adds the same margin |
| the constructor's gates, their comments verbatim | `resolveRuntimeConfig(config, frameParseCapBytes)`, which throws or returns the resolved set |
| `resolvePythonBin`, `validatePythonBin`, the interpreter error message | `resolveInterpreter(bin)`: resolve, reject an unresolvable name, probe, return one absolute path |
| `hostFrameParseCeiling`, `pythonEnvironment` | unchanged; the entry re-exports the first and imports the second for `spawn` |

The gate order is preserved exactly, because it decides which message an operator sees when several configured values are wrong, and the module doc says so.

### The `jscpd` symmetry, measured rather than assumed

`jscpd` was run with each block's markers removed in turn (scoped to this package's `src` plus the sibling backend's):

| Block | With its markers removed |
| --- | --- |
| constructor/teardown/run | one clone: 24 lines, 88 tokens against the sibling's constructor and teardown |
| timer/abort/live-run wiring | nothing — the two backends' timers, abort listeners, and live-run records no longer match token for token |

So the first block is still load-bearing and keeps its text; the second suppresses no clone today, and its comment describes a parallel the detector does not see. Both stay as they are here: the second block's region is the next slice's subject, and retiring a marker is that change's decision, taken with the same measurement. The repo-wide gate reports 0 clones with this change.

### The test this cut makes possible

`tests/config.spec.ts` calls the gates directly, which the constructor-only form did not allow: one case pins that an admitted configuration comes back unchanged, and one pins that a float log budget is reported ahead of an address space below the interpreter baseline when both are wrong — the gate order the module doc claims.

## Verification

| Check | Result |
| --- | --- |
| `pnpm exec vitest run packages/experimental/code-runtime-python/tests` | 6 files / 293 passed, 2 skipped (the real-subprocess suite, unchanged) |
| scoped coverage over this package's `src` | `config.ts` 100% statements, branches, functions, lines; `index.ts`'s only uncovered block is `readProcessStart`'s `/proc` read, which no macOS host executes (it is armed by `process.platform === 'linux'` and pinned by the `v8 ignore` comment it already carried) |
| `pnpm exec tsc -b packages/experimental/code-runtime-python` | exit 0 |
| `pnpm exec tsx scripts/run-oxlint.ts <both files>` | 0 warnings, 0 errors |
| `verify-export-jsdoc` | every exported name documented |
| `pnpm run duplication` | 0 clones over 2227 files |

## Alternatives considered

- **Keep the gates as private methods on `PythonCodeRuntime`.** Rejected: they are pure over `(config, frameParseCapBytes)` and reach no instance state, so methods would have kept a 168-line constructor and left them testable only through a full plugin load.
- **Rewrite the first `jscpd` marker as unnecessary.** Rejected by the measurement above: the clone reappears without it.
- **Retire the second marker in this change.** Rejected: its block is the supervisor slice's region, and removing a declared parallel is that change's evidence to present.
- **Put the bounds in a `limits.ts`.** Rejected: every one of them has exactly one reader — the gate beside it — except `CLOSE_REAP_MARGIN_MS`, whose second reader is the settlement deadline; a separate file would separate constants from the only code that reads them.
- **Give the package a `types.ts` for the vocabulary the cut pieces share.** Rejected as unnecessary here: nothing crossed the new boundary except the `Config` type the entry re-exports, so the missing-home problem the plan recorded for this package did not arise.

## Consequences

The plugin entry now reads as a plugin: register, gate the configuration, supervise runs. Batch 3's remaining item for this package is the process supervisor — `execute`'s child lifecycle, which is about 770 lines of `index.ts`.

## Related

- [Splitting the seven god files](../../implemented/simplification/2026-09-14-god-file-split-plan.md) (the plan; this is batch 3's sixth landed cut)
- [Extracting the analyzer's type graph](2026-09-15-analyzer-type-graph-extraction.md) (batch 3's fifth landed cut)
- [Extracting the log ledger](2026-09-14-code-runtime-python-cost-and-ledger.md) (batch 1's cut of this file, and where its gates' bounds were first measured)
- `packages/experimental/code-runtime-python/src/config.ts`, `packages/experimental/code-runtime-python/tests/config.spec.ts`
