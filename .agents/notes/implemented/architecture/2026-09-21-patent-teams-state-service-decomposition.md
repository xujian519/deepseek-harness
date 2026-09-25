# Agent Note: Decompose the patent-teams service and state modules by lifecycle owner

Status: implemented

English | [中文](2026-09-21-patent-teams-state-service-decomposition.zh.md)

## Problem

`packages/patent/patent-teams/src/service.ts` and `packages/patent/patent-teams/src/state.ts` are the durability and collaboration centre of the team subsystem, and each carried several responsibilities whose owners change for different reasons. `service.ts` held the team lifecycle, the task state machine, contract validation and the quality gate, the member runtime, and status/archive projection. `state.ts` held team persistence, the mailbox lease protocol, task reassignment, key hashing, and the file lock plus atomic-write primitives.

The cost showed up in review, not only in size. Two `v8 ignore` regions in `service.ts` carried reasons that described a different version of the payload and the return value than the code they exempted, and the mismatch survived because reading one responsibility no longer implied reading the others coherently. `state.ts` kept the lock and atomic-write primitives beside the record types they protect, so a change to the mailbox lease protocol required reading code that has nothing to do with leases.

## Decision

Split by lifecycle owner, one commit per step, with the package's export surface and the durable file format unchanged.

- **`state.ts` keeps the record layer and the task state machine; the lock and the mailbox left.** `team-lock.ts` owns the workspace-state derivation and the lock (`withTeamLock`, `stateRootOf`, `teamLockKey`, `sanitizeKey`, `stripLeadingBom`), plus the atomic-replace primitives (`replaceFileAtomicOrDirect`, `atomicWriteText`, `renameWithRetry`). `mailbox.ts` owns the message record and the delivery protocol (`createMessage`, `appendMailbox`, `readMailbox`, `readUnreadMailbox`, `claimMailboxDelivery`, `releaseMailboxDelivery`, `acknowledgeMailbox`). `state.ts` (455 lines) keeps the team record types and their validation, the task state machine with its attempt generations, team read/write/scan/find, the retired-member list, and the archive-directory moves.
- **`service.ts` keeps the service surface; the per-operation work left.** `task-ops.ts` owns create, reassign, claim, and update with their validation and quality-gate branches; `member-runtime.ts` owns adding and removing a member; `team-access.ts` owns the team lookups, member/task requirements, and the lock-scoped re-reads the other two need. The third module is deliberate: leaving those accessors in `service.ts` would have made both new modules depend back on it.
- **`evidence/engine.ts` keeps the engine; rule parsing left.** `packages/patent/patent-core/src/evidence/rule-set.ts` owns `parseRuleSet` and `DEFAULT_WEIGHTS`; the engine keeps the condition table, the three-property and type-specific evaluation, and `EvidenceEngine`.
- **Both consumers of a task operation keep the caller's view.** `PatentTeamsService.createTask`, `reassignTask`, `claimTask`, and `updateTask` are one-line delegations, so the service definition still reads as the team's whole surface while the state machine lives in one file.

## Consequences

`state.ts`, `service.ts`, and `evidence/engine.ts` now hold 455, 756, and 761 lines against 907, 1382, and 876 at proposal time.

The proposal's fourth acceptance item did not ship. It expected `isOptionalString` and `isNonEmptyString` to end up with one definition per package, since `state.ts` and `invariant.ts` define the optional-string guard identically. The extraction attempt was withdrawn: a new `guards.ts` module produces a content-hashed chunk in `patent-teams`, which `verify-built-package-invariants` refuses, so deduplicating the guards costs the package's published chunk layout. The two definitions stay, and they are the cheaper side of that trade; the pair is recorded in `scripts/duplication-baseline.json` like the domain's other accepted clones. What the item was after — one home for the guard — is not worth a change to the release surface.

The two `v8 ignore` regions whose drifted reasons motivated the split were resolved separately, in issue #214: the regions are gone rather than re-worded. Every task-event emit site now spreads one `attemptFields(task)` helper, whose JSDoc states that `attempt` and `attemptId` are optional because a task that never started an attempt has neither, and the `patent-teams/task-updated` invariant validates both as optional.

Splitting a 1382-line module touches every test that imports an internal symbol rather than the package entry. That was the intended discovery, and it settled the boundary: the durable-format tests and the mailbox lease tests separated cleanly, which is the evidence that the two responsibilities did not share state. The guard duplication above is the one place where the boundary the review drew could not be carried through.

## Alternatives considered

**Leave both files and add section comments.** Rejected: the failure is not that the file is hard to navigate, it is that two independent responsibilities share one error vocabulary and one lock order. Comments do not separate those; the `v8 ignore` reasons that drifted are proof that reading the file does not imply reading its parts coherently.

**Split into packages.** Rejected: the split is within one package's ownership — the lock, the records, and the task transitions are all parts of one durable store's contract. Package boundaries would add publish and dependency overhead for no ownership gain, and the mailbox lease protocol must be able to change in one commit with the record it protects.

**Split `service.ts` first and defer `state.ts`.** Rejected as an ordering: `service.ts` calls into the state layer for its lock and lease semantics, so extracting `task-ops.ts` before separating lock and lease pulls the same entangled code into the new file. The state-layer split is the cheaper first step and the one that makes the second step mechanical.
