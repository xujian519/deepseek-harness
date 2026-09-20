# Agent Note: Approve one gate node, not the whole run

Status: implemented

English | [中文](2026-09-20-approval-grants-are-gate-scoped.zh.md)

## Problem

`grantApproval(store, checkpointId)` in `packages/patent/patent-core/src/graph/checkpoint.ts` recorded a human approval by writing `APPROVAL_GRANTED_KEY = '__approval_granted__'` into the checkpoint's shared state as the boolean `true`. `ApprovalGateHandler.execute` read that same key: present and truthy, the gate returned without interrupting.

The key lives in shared state, so the approval was not scoped to the gate it answered. A run that reaches two approval gates resumed past the second one with no human decision at all. Nothing in the manifest or graph contract prevents a run from carrying several gates.

The graph node could not avoid this on its own: `GraphNodeContext` carried no node name, so the gate handler had no way to ask whether *it* was the gate that had been approved. The only fact available to it was the run-wide boolean.

The manifest path (`packages/patent/patent-workflow/src/workflow/executor.ts`) already had the gate-scoped form. It matches the awaiting `stage.id` against an `approvalGrants` allowlist and injects the release mark into a per-stage `execState` copy, leaving shared state untouched.

`tests/graph/checkpoint.spec.ts` pinned the defective form as an expectation: its gate stub read the shared-state boolean directly, and the assertions were `.toBeTruthy()` on the written record and `.toBe(true)` on the shared key.

## Decision

`APPROVAL_GRANTED_KEY` survives, but only inside a handler's **local execution state**. Nothing writes it to shared state; the node or host injects it into the execution-state copy only after deciding, on the gate's own identity, that this gate was approved.

Shared state carries a different key, `APPROVAL_GRANTED_NODES_KEY = '__approval_granted_nodes__'`, whose value is the list of approved gate node ids for the run. `grantApproval` writes the checkpoint's own `activeNodes` — the nodes that were waiting when the run was interrupted — so one approval answers exactly one gate. `isGateApproved(state, nodeName)` is the membership test.

`GraphNodeContext` gained an optional `nodeName`, filled by `graph/engine.ts` with the node's registration name as it constructs each node's context. The two graph node factories use it according to what each knows:

- `handlerNode` (`graph/domains/shared.ts`) is a generic factory with no knowledge of the graph it is placed in, so it reads the engine-injected `nodeName`;
- `makeStageNode` (`graph/adapter.ts`) registers its node under `stage.id` and closes over that id, so it matches the manifest path's `approvalGrants: stageId[]` form directly.

Both compute the release only when the handler is an approval gate, and both fall back to no release when the node name is unavailable — a directly constructed context releases nothing (fail-closed). Both write the key only into the execution-state copy they pass to the handler.

Both keys begin with `_`, so `collectStateText` and the other business-text aggregations skip them.

## Alternatives considered

**Keep the shared-state boolean and add a "consumed" marker.** Rejected: consumption would need its own bookkeeping and its own commit point, and a run that is approved and never resumed would leave a consumed gate and an unconsumed one indistinguishable. Recording gate identity makes the question unnecessary.

**Have the gate node write its own id into shared state as it runs.** Rejected: a gate that interrupts has raised `InterruptStageError` and cannot write anything afterwards, and the fact being recorded — a human approved this gate — originates outside the graph, so the entry point of the approval is where it belongs.

**Rename the shared boolean and rely on callers writing it only for the current gate.** Rejected: a convention is not an enforcement point, and the next caller that writes the key reintroduces the leak.

**Pass the node name by closing over it inside each factory.** Rejected: `handlerNode` wraps handlers whose registration name is chosen by whoever builds the graph, which the factory never sees; the engine is the only place that knows the name a node was registered under.

## Consequences

One approval releases one gate. Approving a checkpoint whose `activeNodes` contains no approval gate releases nothing, and the run still stops at the next gate.

The two graph paths and the manifest path now agree on the release form: all three decide on a gate id and inject into an execution-state copy, and none writes a release mark to shared state. `APPROVAL_GRANTED_OUTPUT` remains the manifest path's placeholder stage output.

Checkpoints written before this change carry only the global boolean. `isGateApproved` does not read it, so resuming such a checkpoint stops at the gate again and requires a fresh approval. There is no compatibility read and no downgrade path.

Graph checkpoint state gains a key. The tests that asserted the boolean, and the gate stub that consumed it, were rewritten to the gate-scoped form; a probe against the pre-change implementation reproduced the two-gate leak before the fix landed.

## Testing

`packages/patent/patent-core/tests/graph/checkpoint.spec.ts` — approval records the gate-scoped list and resumes through the gate; approving a non-gate checkpoint releases nothing; a run with two gates that approves only the first still interrupts at the second.

`packages/patent/patent-core/tests/graph/adapter.spec.ts` — `handlerNode` releases on the engine-injected node name and leaves no release boolean in shared state; `manifestToGraph` resumes through a gate whose id is in the release record.

`packages/patent/patent-core/tests/atoms.spec.ts` — the gate handler's execution-state contract, and the gate-scoped membership test.

## Related

- [Sati patent domain as dsh plugins](../feature/2026-08-17-sati-patent-domain-dsh-plugins.md) — the port this package belongs to.
