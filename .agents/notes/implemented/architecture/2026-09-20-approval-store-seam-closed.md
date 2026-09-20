# Agent Note: Close the ApprovalStore type seam with an in-memory implementation

Status: implemented

English | [中文](2026-09-20-approval-store-seam-closed.zh.md)

## Problem

`packages/patent/patent-workflow/src/approval.ts` declared `ApprovalStore` — `saveRecord` and `listRecords` — and `createApprovalRecord`, and shipped no implementation. Every `ApprovalStore` in the tree was an inline stub inside `output-gate.spec.ts`, so the interface carried no executable contract, and `stats()` — the source of the `AdoptionRate` the Golden Benchmark conversion needs — did not exist anywhere.

The type alone cannot tell a reader what an implementation must do with the records it is handed. `listRecords` could return the internal array and let a caller rewrite stored audit records; `saveRecord` could be synchronous or promise-returning; an empty store could report `NaN` or `0` for the adoption rate.

The finding that prompted this work also overstated two things, and the corrections belong here because a later reader will otherwise re-derive them:

- **`PatentOutputGate` has no production construction site.** `new PatentOutputGate(` appears only in `output-gate.spec.ts`. The gate that runs in production is `RuleOutputGate`, wired onto `tools/post-execute` in `patent-rule/src/index.ts`, routing review-level violations through `ctx.get('approval')` and failing closed when no answerer is present. So a store wired into `PatentOutputGate` would sit on a chain nothing reaches.
- **The domain is not without an audit trail.** `packages/interaction/user-approval/src/index.ts` appends the `approval/asked` and `approval/decided` pair, declared in `packages/core/session/src/known-event-types.ts`, and `packages/interaction/user-approval/src/invariant.ts` checks the pair. What is missing relative to the upstream design is the aggregate metric layer over those decisions, not the record of them.

## Decision

`InMemoryApprovalStore` implements `ApprovalStore`: append-only push, `listRecords` returning a deep copy, and `stats()` reporting `total`, the three verdict counts, and `adopted / total`, with `0` for an empty store.

**This closes the type seam only.** No gate is wired to a store, no caller's behaviour changes, and nothing is persisted. The durable audit database and the question of which gate should own a store are separate decisions, and this note deliberately leaves both open: an implementation that exists and is used by no one is a smaller commitment than an implementation wired into a gate whose place in the production path is itself unsettled.

`listRecords` copies through `structuredClone` rather than the shallow spread upstream uses. `InMemoryWorkflowRunStore` in the same package deep-copies on both save and load, and an audit log that a caller can rewrite through a returned reference is not an audit log. The records are plain JSON values, so the clone is exact.

`stats()` returns `0` for `adopted / total` when the store is empty rather than `NaN`. A benchmark consuming the rate should not have to guard against a value that means "no data" being spelled as a non-number.

`saveRecord` returns `void`, matching the interface's `void | Promise<void>` in the narrower direction, so a synchronous caller is unaffected. A persisting implementation returns the promise.

`createApprovalRecord` is unchanged; the two sides already agreed on its semantics.

## Alternatives considered

**Add a metric layer over the `approval/asked` + `approval/decided` session events, and leave the store out.** Rejected for this change: it is a real capability and the events exist to carry it, but it introduces a new session-event consumer with its own package home, its own snapshot obligations, and its own decision about where the `AdoptionRate` is published. Closing a type seam and building an aggregate layer are different sizes of change, and folding them together makes the smaller one wait on the larger.

**Port both implementations and wire a store into `PatentOutputGate`.** Rejected: `PatentOutputGate` has no production construction site, so the wiring would have to revive the gate first, and the revived gate would overlap the `RuleOutputGate` that is already wired and already routing approvals. Two gates both consuming `tools/post-execute` results is a behaviour change, not a port.

**Return the internal array from `listRecords`, as upstream does.** Rejected: the caller then holds a reference into the store's own state, and an audit record mutated after the fact is indistinguishable from one written that way. The deep copy is the point of the method.

**Persist to SQLite now.** Rejected: persistence needs a schema, a migration policy, and a home for the file, and it is only worth those once something writes through the store. Deferring it keeps this change free of durable-format commitments.

## Consequences

The `ApprovalStore` interface has an implementation a test can exercise, and `stats()` has defined behaviour for the empty case and for each verdict.

No behaviour changes for any caller. `PatentOutputGate`'s tests keep their inline stubs: those stubs exist to drive the gate's fail-open contract, and replacing them with a real store would test the store instead.

The golden-benchmark conversion still has no `AdoptionRate` to read in production, because nothing writes records in production. Closing that gap requires choosing where the metric layer lives, which this note does not decide.

## Testing

`packages/patent/patent-workflow/tests/approval.spec.ts` — save and list round-trip; `listRecords` returns a copy whose mutation does not reach the store; `stats()` counts each verdict and reports `adopted / total`; an empty store reports `adoptionRate === 0`.

## Related

- [Sati patent domain as dsh plugins](../feature/2026-08-17-sati-patent-domain-dsh-plugins.md) — the port this package belongs to.
