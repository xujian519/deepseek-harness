# Agent Note: Decompose the patent-teams service and state modules by lifecycle owner

Status: proposed

English | [中文](2026-09-21-patent-teams-state-service-decomposition.zh.md)

## Problem

`packages/patent/patent-teams/src/service.ts` (1382 lines) and `packages/patent/patent-teams/src/state.ts` (907 lines) are the durability and collaboration centre of the team subsystem, and each carries several responsibilities whose owners change for different reasons.

`service.ts` holds the team lifecycle, the task state machine, contract validation and the quality gate, the member runtime, and status/archive projection. `state.ts` holds team persistence, the mailbox lease protocol, task reassignment, key hashing, and the file lock plus atomic write primitives.

The cost is visible in the review of this pair, not only in its size. Two `v8 ignore` regions in `service.ts` (around `:828` and `:853`) carry reasons that describe a different version of the payload and return value than the code they exempt; the mismatch survived because reading one responsibility no longer implies reading the others. `state.ts` keeps the lock and atomic-write primitives beside the record types they protect, so a change to the mailbox lease protocol requires reading code that has nothing to do with leases.

## Proposal

Split by lifecycle owner, one commit per step, keeping the package's export surface unchanged.

1. Extract `team-lock.ts` from `state.ts` — `withTeamLock`, `atomicWriteText`, `replaceFileAtomicOrDirect` — and `mailbox.ts` — lease, TTL, and delivery state. `state.ts` keeps the record types and the transitions over them.
2. Extract `task-ops.ts` from `service.ts` — the claim, update, validate, and gate branches — and `member-runtime.ts` — member spawn, wake, and delivery. `service.ts` keeps team-level operations and configuration.
3. Extract `rule-set.ts` from `packages/patent/patent-core/src/evidence/engine.ts`, moving `parseRuleSet` and its validation out of the engine class file.

Each step is a move, not a rewrite: no behavior change, no error-type change, no durable-format change. The existing `patent-teams/tests` suite (15 spec files) is the acceptance signal for steps 1 and 2 — it must stay green without edits, and any edit required by a move is evidence the move changed behavior.

Steps 1 and 2 also unlock the same-package duplicate guards: `isOptionalString` is defined identically in `invariant.ts:28` and `state.ts:707`, and both consumers are within this package, so the extraction gives those guards a natural home.

## Alternatives considered

**Leave both files and add section comments.** Rejected: the failure is not that the file is hard to navigate, it is that two independent responsibilities share one error vocabulary and one lock order. Comments do not separate those; the `v8 ignore` reasons that drifted are proof that reading the file does not imply reading its parts coherently.

**Split into packages.** Rejected: the split is within one package's ownership — the lock, the records, and the task transitions are all parts of one durable store's contract. Package boundaries would add publish and dependency overhead for no ownership gain, and the mailbox lease protocol must be able to change in one commit with the record it protects.

**Split `service.ts` first and defer `state.ts`.** Rejected as an ordering: `service.ts` calls into the state layer for its lock and lease semantics, so extracting `task-ops.ts` before separating lock and lease pulls the same entangled code into the new file. The state-layer split is the cheaper first step and the one that makes the second step mechanical.

## Acceptance criteria

- Each step is a pure move: `pnpm vitest run packages/patent/patent-teams/tests` and `pnpm vitest run packages/patent/patent-core/tests` pass with no test edits.
- `pnpm run typecheck` passes; the package's public exports and the durable file format are unchanged.
- The two `v8 ignore` regions in `service.ts` are resolved in the same change: verified, or deleted so the gate reports.
- `isOptionalString` and `isNonEmptyString` each have one definition in the package.
- `pnpm run duplication` still passes.

## Risks

Splitting a 1382-line module touches every test that imports an internal symbol rather than the package entry, so the first commit will surface any test that reached inside. That is the intended discovery, but it should be handled by importing the entry rather than by re-exporting internals from the new file, or the split buys nothing. If the durable-format tests and the mailbox lease tests cannot be separated cleanly, that is itself evidence the two responsibilities share state and the boundary must be redrawn before the move.
