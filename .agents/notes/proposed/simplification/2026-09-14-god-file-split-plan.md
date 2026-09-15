# Agent Note: Splitting the seven god files (Issue #86)

Status: proposed

English | [中文](2026-09-14-god-file-split-plan.zh.md)

## Problem

Issue #86 asks that the oversized files under `packages/` be split. Its inventory lists twelve files, with generated files already excluded by the issue itself, and proposed an order by size, largest first:

| File | Lines | Form | In this plan |
| --- | --- | --- | --- |
| `packages/client/connection/src/client/fixture.ts` | 2288 | Shipped browser-mode provider (not a test fixture) | yes |
| `packages/client/ui-trajectory/src/client/TrajectoryTable.tsx` | 3208 | Multi-component file with two inline JSX regions | yes |
| `packages/typert/generator/src/analyzer.ts` | 3235 | Pure build-time library | yes |
| `packages/experimental/code-runtime-python/src/index.ts` | 1801 | One class, one oversized method | yes — pilot landed |
| `packages/core/session/src/index.ts` | 904 | Four concerns sharing a module | yes |
| `packages/core/tools/src/ptc.ts` | 372 | One tool factory over the extracted dispatch lane | yes |
| `packages/acp/acp/src/index.ts` | 543 | One 341-line `apply` | yes |
| `packages/client/better-sidebar/src/client/state.ts` | 1900 | Clone center | no |
| `packages/client/better-sidebar/src/client/Sidebar.tsx` | 1775 | Clone center | no |
| `packages/core/tools/src/index.ts` | 1913 | ToolRuntime plus five responsibilities | no |
| `packages/self-evolve/self-evolve-basic/src/index.ts` | 1857 | Flat since the audit | no |
| `packages/subagent/subagent/src/continuation.ts` | 550 | Converged from 1483 | no — the issue closes it |

Five entries are outside this plan, each for a stated reason rather than by omission. `continuation.ts` converged and the issue itself recommends closing it. `better-sidebar`'s `state.ts` and `Sidebar.tsx` are flagged by the issue as clone centers: their remedy is deduplication, and cutting two files that already mirror each other would turn one in-file clone into a cross-file one — that work belongs to the M1 dedup family, not here. `core/tools/src/index.ts` and `self-evolve-basic/src/index.ts` are at or below the size the issue recorded, and this plan's own standard — every cut justified by a test that becomes possible, an interface that becomes explicit, or a method that becomes readable — has no answer for them yet; they stay open on the issue rather than entering a batch without a reason. Line counts are as measured when each extraction landed, most recently 2026-09-15: after the pilot, the session-folds extraction, the fixture RPC dispatch extraction, and the ptc dispatch-pool extraction.

A structural survey of the seven in scope found that size is not what makes them hard to split. Every one already has visible cuts — module-level pure functions, already-extracted helpers, section boundaries a reader can see. What none of them has is a settled answer to **where a cut boundary belongs**, and several carry explicit contracts that a naive split would break silently:

- `code-runtime-python` contains two `/* jscpd:ignore-start */` blocks — the constructor/teardown/run shape (542–774) and the timer/abort/live-set block (1576–1592) — whose comments declare a shape parallel to its sibling worker-thread backend. Cutting one side breaks the declared symmetry. `fixture.ts` carries no such block; the package's only one is in `fixture-projections.ts`, which mirrors host timing without importing a target implementation.
- `fixture.ts` deliberately re-implements host behavior rather than importing it, so a web client package does not acquire host dependencies. A split that "deduplicates" by importing would pull host packages into the client bundle — the exact regression the file was written to avoid.
- `code-runtime-python` has no `src/types.ts`, so the vocabulary its cut pieces would share has no home; giving it one collides with the exception already recorded for Issue #99. `ui-trajectory` had none either and gained one in its batch-1 cut, the same way `analyzer` did.
- Tests import internal symbols through source paths (`code-runtime-python/tests/runtime.spec.ts` from `../src/index.ts`; `ui-trajectory/tests/table.client.spec.tsx` from `../src/client/TrajectoryTable.tsx`), so a split must keep the entry module re-exporting what it re-exports today.

Left unanswered, those four questions get re-litigated in each review, and the answers drift between files. The order by size also points the wrong way: the largest file is among the least safe to cut first.

## Proposal

Settle the four boundary questions once, then split in batches ordered by how much of the file's behavior a cut has to preserve.

### Four rules that hold across every batch

1. **A `jscpd:ignore` block is a two-sided contract.** Cutting one side requires the matching cut on the other side in the same change, or an explicit amendment of the comment explaining why the symmetry no longer holds. This applies to `code-runtime-python` ↔ `code-runtime-worker-thread` (constructor/teardown/run shape, and the timer/abort/live-set block) and to whichever sibling each remaining `jscpd:ignore` block names.
2. **`fixture.ts` mirrors, it does not import.** Cuts inside it extract *within* the file. Any change that would make it import a host package is out of scope, however much duplication it would remove.
3. **New shared vocabulary lands in `src/types.ts`.** Where a package lacks that file, creating it is part of the batch that first needs shared vocabulary, and the change cites the Issue #99 exception for runtime values living there. The entry module keeps re-exporting everything it exports today.
4. **A cut that cannot keep the entry module's export list stable is not a batch-1 cut.** Moving a symbol the entry re-exports is fine; dropping one is not.

### Batch 1 — extraction that preserves behavior by construction

Each item moves code that is already self-contained: no instance state, no new interfaces, no behavior change. The entry module re-exports what moved.

| Package | Cut | Lines (estimated) |
| --- | --- | --- |
| `code-runtime-python` | Byte-cost and truncation vocabulary → `src/cost.ts`; log ledger → `class OutputLedger` | ~200, ~270 — landed at 131, 619 |
| `ui-trajectory` | Record projection layer → `trajectory-record-model.ts`; six presentation-helper families to their own files; the shared record vocabulary → a new `src/types.ts` | ~260, ~1050 — landed at 248, 1045, plus a 94-line `types.ts` |
| `core/session` | Validators and header handling → `validation.ts` | ~365 — landed at 345 |
| `analyzer` | Node-text helpers, `package.json` exports parsing, path utilities | ~250 each — landed at 397, 111, 201, plus a 26-line `types.ts` |
| `acp` | Cursor codec cluster | ~56 — landed at 75 |
| `ptc` | JSON presentation cluster; flavor table and resolver | ~90, ~107 — landed at 103, 110 |

The pilot is `code-runtime-python`, because its ledger cut has the strongest single piece of evidence in the repository: the sibling backend `packages/code-runtime/code-runtime-worker-thread/src/index.ts` already has an extracted `OutputLedger`. The two can be compared for the same boundary cases, and the package exports only `.` while being `private: true`, so the published surface cannot move. The pilot has landed: [the cost/ledger extraction note](../../implemented/simplification/2026-09-14-code-runtime-python-cost-and-ledger.md) records what the cut produced and what it cost.

### Batch 2 — cuts that need an interface settled first

- `code-runtime-python`: the fd-3 frame reader, [landed](../../implemented/simplification/2026-09-14-code-runtime-python-frame-reader.md) with a frame callback carrying only the rebuilt frame — no consumer reads a frame's raw byte length, so the protocol this bullet predicted it needed was not built; the ledger's contract with the `log` frame branch, which is two-way because the branch reports back that truncation occurred.
- `ui-trajectory`: the inspector `<aside>` as `RecordInspector` (~550 lines, about 10 values and 4 callbacks), plus a `useResizeHandle` for its pointer-capture drag.
- `core/tools` `ptc.ts` and `acp/acp`: the remaining bodies of the oversized methods, once batch-1 extractions have shrunk them.
- `fixture.ts`: the history script `buildAlphaLog`, then the projection fold family, both [landed](../../implemented/simplification/2026-09-14-fixture-history-module-extraction.md). The in-memory file system [landed](../../implemented/simplification/2026-09-14-fixture-file-system-module-extraction.md) and settles this batch's interface question for that file: a cluster takes the world's values as parameters and owns the state it mutates. The three remote clusters that capture one world-state binding each [landed](../../implemented/simplification/2026-09-14-fixture-configuration-remotes-extraction.md) against that template, whose degenerate case is a zero-parameter factory. The `rpc` dispatch table [landed](../../implemented/simplification/2026-09-14-fixture-rpc-dispatch-extraction.md) behind a `FixtureRpcDeps` list declared where its member types live; `fixture.ts` is 2288 lines. Batch 2 is complete.

### Batch 3 — cuts that sit on semantics, each with its own evidence

These do not land until the change can show what it preserves.

- `ptc.ts` dispatch pool: the ordered commit lane, the exclusive barrier, backpressure, and the wakeup-order defense are all behavior, not structure. [Landed](../../implemented/simplification/2026-09-15-ptc-dispatch-pool-extraction.md) into `src/ptc-dispatch-pool.ts` — `DispatchPool` takes `{ maxParallel, isRunOver }`, the transport submits, tracks side work, and drains, and `tests/ptc-dispatch-pool.spec.ts` drives the lane through eight cases; `ptc.ts` is 372 lines.
- `core/session`: the three incremental folds [landed](../../implemented/simplification/2026-09-14-session-folds-extraction.md) into `src/folds.ts` — `SessionFolds` takes the log array by reference and the surface, `Session` keeps three one-line delegations, and `index.ts` is 904 lines. The `Session` class remains open, whose `attachments` WeakMap and `SessionEntry` must stay co-located, and whose type string is asserted verbatim by a test.
- `code-runtime-python`: the config gates and the process supervisor.
- `ui-trajectory`: the row renderer. It captures roughly 30 `useMemo` derivations and 15 callbacks; passing them explicitly costs about 45 props, and a memo boundary handled carelessly re-renders every visible row on each parent render, giving back the virtualizer's benefit. Its stability is currently deliberate, as the `useStableVirtualRowStructure` hook documents.
- `analyzer`: the `Remote`/RPC analyzer and the type modeler rejoin batch 3 after a spell in batch 2, and the reading that moved them is the evidence they were missing. `allocateNodeId` mints `type:<file>:<line>:<column>#<ordinal>`, where the ordinal is a per-location counter incremented on every call, so an id is a function of **visit order at one source position** rather than of the type. Two sites make that order hard to predict: `resolvedRemoteCodecType` allocates inside its own `convert` closure against its own `completed`/`active` caches — one authored site yields `#1`, `#2`, `#3` by cache-miss order — and `convertType` allocates before recursing, so a union and its first member, which share `getStart()`, are ordered by call order rather than by structure. Both clusters write the same five maps (`nodes`, `declarations`, `declarationStates`, `crossFaceLinks`, `nodeOrdinals`), and `ensureDeclaration` re-enters across calls behind a `declarationStates` guard. `tests/__snapshots__/type-model.spec.ts.snap` records 578 occurrences of these ids, 294 of them distinct, so a reordered visit renames ids and arrives as a snapshot diff instead of a failure. The cut does not start until a test pins `allocateNodeId`'s id stability against a reordering it must survive.

## Alternatives considered

- **Follow Issue #86's order by size.** Rejected: the largest file carries the mirroring constraint that makes it one of the least safe first cuts, and the second-largest is a pure build-time library whose risk is snapshot drift rather than size. Order by how much behavior a cut must preserve instead.
- **Split `fixture.ts` by importing the host implementations it mirrors.** Rejected: it would add host package dependencies to a web client bundle, reversing the decision the file records in its own comments.
- **Cut only the `jscpd:ignore` blocks in one backend.** Rejected: those comments declare a symmetry with the sibling backend. Breaking it silently converts a documented contract into an undocumented difference.
- **Extract a large piece whenever a file exceeds a line threshold.** Rejected: size alone does not say which boundary is safe. `core/session` is not a persistence-mixing file — persistence already lives in its own packages — and splitting it as though it were would move the wrong pieces.
- **Introduce a translation context in `ui-trajectory` to shorten the prop lists.** Rejected: every component in the package takes `t` as an explicit prop today. Adding a second mechanism to make one split cheaper forks the package's style.
- **Do the whole batch 1 at once across six packages.** Rejected: the four rules above are the plan's actual deliverable, and a pilot is what tests whether they hold. Six parallel changes would put the rules into six reviews before any one of them is confirmed.

## Acceptance criteria

- Each batch lands as its own pull request; the pilot lands alone before the rest of batch 1 starts.
- A split batch is done when the touched package's entry module exports the same names as before, no test needed a new import path, and the package's own tests, `pnpm run typecheck`, and the documentation gates pass.
- Batch 1 changes no behavior: no constant, default, or schema value moves.
- This note moves to `implemented/` when batch 3 has landed or been explicitly deferred item by item.

## Risks

- **Symmetry debt.** Every `jscpd:ignore` block touched without its counterpart leaves a declared contract unstated. The rules require the pair or an amended comment, but a reviewer must still check it.
- **Performance regression behind a structural win.** The `ui-trajectory` row renderer is the clearest case: the split can look cleaner and cost frames. That is why it is in batch 3.
- **Snapshot drift.** No longer hypothetical for `analyzer.ts`: `type-model.spec.ts.snap` records 578 occurrences of `allocateNodeId`'s ids, and each id's ordinal comes from visit order at its source position. A cut that changes that order renames ids and lands as a snapshot diff rather than as a failing test — which is why the analyzer moved to batch 3 and starts with an id-stability test.
- **Vocabulary collisions with Issue #99.** Creating `src/types.ts` files resolves the missing-home problem but re-opens a settled question; each such change must cite the existing exception rather than argue it again.
- **Churn without benefit.** Splitting for its own sake moves lines without making anything easier to change. Each cut should be justified by a test that becomes possible, an interface that becomes explicit, or a method that becomes readable — the plan names that for each batch-1 item and asks for it before batch 2.

## Related

- `.agents/audits/2026-09-11-tech-debt-issue-manifest.md` Issue #86
- `docs/TECH_DEBT.md` (M6, and the ledger entry that names the two files the audit missed)
- [Extracting the session's incremental folds](../../implemented/simplification/2026-09-14-session-folds-extraction.md) (batch 3's first landed cut)
- [Extracting the `run_code` sub-dispatch lane](../../implemented/simplification/2026-09-15-ptc-dispatch-pool-extraction.md) (batch 3's second landed cut)
- `packages/code-runtime/code-runtime-worker-thread/src/index.ts` (the `OutputLedger` precedent)
- `packages/experimental/code-runtime-python/src/index.ts`, `packages/client/ui-trajectory/src/client/TrajectoryTable.tsx`
