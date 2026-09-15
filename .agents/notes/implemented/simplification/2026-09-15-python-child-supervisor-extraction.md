# Agent Note: Extracting the python backend's child supervisor (Issue #86)

Status: implemented

English | [中文](2026-09-15-python-child-supervisor-extraction.zh.md)

## Problem

`packages/experimental/code-runtime-python/src/index.ts` was 1180 lines after the load-time gates came out. What remained was the plugin — `Config` registration, `teardown`, `run`, binding validation, per-run staging — and a 760-line `execute` that owned an entire child process: the spawn, the fd-3 frame reader and its dispatch, the reply channel with its backpressure and backlog caps, the wall timer and abort listener, the SIGTERM → grace → SIGKILL escalation, and the settlement that waits for the process group to empty.

[The split plan](../../implemented/simplification/2026-09-14-god-file-split-plan.md) names this item in batch 3 as "the config gates and the process supervisor"; the gates [landed first](2026-09-15-python-config-gates-extraction.md), and this is the other half.

## Decision

`packages/experimental/code-runtime-python/src/supervisor.ts` (899 lines) exports `superviseChildRun`; `index.ts` is 364 lines and its `execute` builds that call's inputs.

| Moved | Form in the new module |
| --- | --- |
| `execute`'s 760-line body | `superviseChildRun`'s body, moved verbatim |
| `this.pythonBin`, `this.config`, `this.frameParseCapBytes` | `ChildRunDeps` fields of the same names |
| `this.live` | `ChildRunDeps.liveRuns`, because the body already had a local `live`: one run's own record |
| `request.program`, `request.signal` | `ChildRunDeps` fields, so the supervisor never reads the seam request |
| `ValidatedNamespace`, `LiveRun` | exported from the supervisor: the namespace map is its input, and the run record is the state it registers for teardown |
| `MAX_PENDING_REPLIES`, `GROUP_REAP_POLL_MS`, `readProcessStart` | the supervisor's own caps and its pid-reuse guard; the entry re-exports `readProcessStart`, which its tests import from there |

The entry keeps `execute` as a ten-line delegation, so the method set a reader saw before (`run` → `execute`) stays as it was, and the export list is unchanged. The dependency direction is one-way: `supervisor.ts` imports `config.ts`, `cost.ts`, `frame-reader.ts`, `output-ledger.ts`, and `protocol.ts`, and nothing imports it except the entry.

### The second `jscpd` marker is retired, on measurement

The wiring block traveled with its `/* jscpd:ignore-start */` markers, and the gates cut had already measured that pair as suppressing nothing. Re-measured under the new layout — scoped `jscpd` over this package's `src` plus the sibling backend's, with the markers removed — the answer is the same: 0 clones either way. So the suppression was protecting nothing, and the block now carries a comment stating the parallel the worker backend shares, which is the part worth keeping; a later edit that does create a clone is reported by the duplication gate instead of being hidden.

The other marker pair (constructor/teardown/run in the entry) is untouched and still load-bearing: without it, 24 lines and 88 tokens match the sibling's constructor and teardown.

## Verification

| Check | Result |
| --- | --- |
| `pnpm exec vitest run packages/experimental/code-runtime-python/tests` | 7 files / 295 passed, 2 skipped — the real-subprocess suite drives the moved body unchanged |
| scoped coverage over this package's `src` | every file 100% on statements, branches, functions, and lines except `supervisor.ts`'s `readProcessStart`, whose `/proc` read no macOS host executes (armed by `process.platform === 'linux'` and `v8 ignore`d, exactly as it was inside the entry) |
| `pnpm exec tsc -b packages/experimental/code-runtime-python` | exit 0 |
| `pnpm exec tsx scripts/run-oxlint.ts packages/experimental/code-runtime-python` | 0 warnings, 0 errors |
| `pnpm run duplication` | 0 clones over 2228 files |
| `pnpm run test:docs` | 18/18 |

## Alternatives considered

- **Move the body into a `ChildRun` class.** Rejected for this cut: the body is a closure over state that methods would each have to become fields for — `settled`, `decided`, `pendingCalls`, `pendingReplies`, `nextCallId`, `draining`, `killing`, `runSent`, `closeDeadline` — and it relies on initialization order that a class would move into field initializers (the boot-frame write is last because its failure path reads the wall timer and the abort listener). The function keeps the order the code was written and reviewed with, and the deps list is what makes its inputs explicit.
- **Split the reply channel and the kill escalation into their own modules now.** Both are real candidates — the reply channel touches only the fd-3 handle, the settled flag, and the settlement callback — but each is a separate interface decision and deserves its own evidence rather than riding along here.
- **Keep the wiring's `jscpd` markers.** Rejected by the measurement above: a marker that suppresses nothing is a claim a reader cannot check.
- **Leave `execute` in the entry and hand it the plugin.** Rejected: nothing else in the entry reads the child, and the deps object is exactly the boundary.

## Consequences

The entry now holds the plugin's own concerns — registration, the seam's binding validation, and staging — and the child lives in one module. Batch 3's remaining item is the analyzer's Remote/RPC slice; this package's batch-3 work is done.

## Related

- [Splitting the seven god files](../../implemented/simplification/2026-09-14-god-file-split-plan.md) (the plan; this is batch 3's seventh landed cut)
- [Extracting the python backend's load-time gates](2026-09-15-python-config-gates-extraction.md) (the first half of this batch-3 item)
- [Extracting the log ledger](2026-09-14-code-runtime-python-cost-and-ledger.md) (batch 1's cut of this file)
- `packages/experimental/code-runtime-python/src/supervisor.ts`, `packages/experimental/code-runtime-python/src/index.ts`
