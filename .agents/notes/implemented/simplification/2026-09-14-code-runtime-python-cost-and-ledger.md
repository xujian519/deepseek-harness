# Agent Note: Extracting the python runtime's cost and log-ledger modules (Issue #86)

Status: implemented

English | [中文](2026-09-14-code-runtime-python-cost-and-ledger.zh.md)

## Problem

`packages/experimental/code-runtime-python/src/index.ts` reached 2405 lines holding three concerns that never share a line: child-process supervision, the fd-3 frame reader, and the accounting of everything a run returns in `logs`. Changing the byte budget or the truncation marker meant reading past the spawn, escalation, and teardown code, and the only way to exercise a truncation boundary was to spawn a real python child — the ledger had no surface a test could call.

[The split plan](../../implemented/simplification/2026-09-14-god-file-split-plan.md) names this cut as batch 1's first item and as the pilot for the whole program, because the sibling backend `packages/code-runtime/code-runtime-worker-thread/src/index.ts` already ships an extracted `OutputLedger` whose boundary cases can be compared against. This note records what the cut produced.

## Decision

Two modules hold what the entry module used to inline, and `src/index.ts` is 1801 lines.

| Module | Lines | Owns |
| --- | --- | --- |
| `src/cost.ts` | 131 | Byte-cost and truncation vocabulary: `jsonStringCostUpTo`, `capMessage`, and the module-private marker both agree on. |
| `src/output-ledger.ts` | 619 | `class OutputLedger`, plus the fragment-accumulation primitives the fd-3 frame reader shares with it. |

The entry module exports the same names it exported before. `detachResidual` and `MAX_PENDING_CHUNKS` moved out and stay re-exported from `src/index.ts`, so `tests/residual-detach.spec.ts` imports from `../src/index.ts` unchanged. No snapshot, fixture, or test needed an edit.

### The ledger's surface

One instance per run holds the `logs` the run's promise resolves with, the `maxLogBytes` budget every log entry and every stray stdout/stderr byte is billed against, and the truncation state the finish paths funnel into. The entry module constructs it, wires four stdout/stderr listeners to it, and calls five methods: `admitFrame(text, open)` and `markChildTruncated()` from the `log` frame arm, `sealOpen()` where the run used to seal a trailing open frame, `flushStdout()`/`flushStderr()` where the pipes close, and reads `ledger.lines` at resolution.

`admitFrame` is one method rather than the three the original `case 'log':` arm dispatched between. The arm chose among *open frame*, *frame closing an open hold*, and *closed frame* by reading the ledger's own counters — so splitting the decision from the state would have meant exporting `openParts`, `openSealed`, and `budget` to the entry module. The ledger decides; the entry module only reports what the frame said.

Two `/* v8 ignore ... */` annotations moved with their arms and keep their exact line counts: the mid-sequence budget-flush boundary in `flushStray`, and the defensive `!this.truncated` guard in `closeOpen`.

### The shared fragment primitives

`MAX_PENDING_CHUNKS`, `Utf8CostState`, `accrueStrayCost`, and `detachResidual` were used by both the ledger and the fd-3 frame reader that stays in the entry module. They live in `src/output-ledger.ts` rather than a third module, which keeps the dependency direction one-way (`index.ts` → `output-ledger.ts`) and holds the module count to the two the plan promised. `detachResidual` is the one the fd-3 reader calls; it keeps its entry-module re-export for the test that imports it there.

### Verification

`pnpm exec tsc -p packages/experimental/code-runtime-python/tsconfig.json --noEmit` is clean; `pnpm exec vitest run packages/experimental/code-runtime-python` reports 283 passed | 2 skipped, identical to the count before the cut; `pnpm exec tsx scripts/run-oxlint.ts packages/experimental/code-runtime-python` is clean; `pnpm exec jscpd --config .jscpd.json packages/experimental` finds no clones. Both new modules report 100% statements, branches, functions, and lines under the coverage run. `index.ts` reports 98.84% statements, entirely from `readProcessStart`'s Linux `/proc/<pid>/stat` arm, which the Darwin coverage lane cannot reach — the same gap the file carried before the cut.

Neither `jscpd:ignore` symmetry block was touched: the moved region contained no `jscpd` marker, so the pairing with `code-runtime-worker-thread` is intact.

## Alternatives considered

- **A closure factory instead of a class.** Rejected: the plan promised `class OutputLedger` on the worker-thread precedent, and the class is what gives a test a constructible surface — a budget in, frames and stray bytes in, `lines` out — with no child process.
- **A third module (`chunks.ts`) for the shared fragment primitives.** Rejected: two modules reference them and the direction is one-way either way; a third file would exist only to hold four symbols that the ledger module already has to import.
- **Moving the fd-3 frame reader in the same cut.** Rejected: its frame callback carries the raw line length, an interface the plan settles in batch 2. Cutting it here would have invented that protocol as a side effect of a move.
- **Keeping the three-way frame decision in the entry module and exposing three ledger methods.** Rejected: the decision reads the ledger's own counters, so this is the option that exports state rather than importing behavior.
- **Extracting the ledger as a plain function taking accumulated state as arguments.** Rejected: the state it threads (budget, stray buffers, open holds, truncation flag) is a per-run lifetime; passing it through every call site moves the file's structure into every caller.

## Consequences

`index.ts` is 604 lines shorter, one class smaller, and the ledger is testable without a child process. The cost is the accounting the pilot measured: two new files, 750 new lines against 625 deleted from the entry module, 21 inserted lines of wiring — the net growth is module headers, the class scaffold, and the method JSDoc the moved comments became. No snapshot moved.

One constraint surfaced: at class-field indentation the two `StrayBuffer` initializers that fit on one line inside the old closure exceed the 140-column lint limit, so they became an `emptyStray()` factory. Extraction into a class is not line-neutral for formatting.

## Related

- [Splitting the seven god files](../../implemented/simplification/2026-09-14-god-file-split-plan.md) (the plan; this is its batch-1 pilot)
- [Closing out the hardcoded-tunable audit](2026-09-14-hardcoded-tunable-closeout.md) (Issue #88; batch-1 change rule: no constant or default moves)
- `packages/code-runtime/code-runtime-worker-thread/src/index.ts` (the `OutputLedger` precedent)
