# Agent Note: Latch a waking send that lands after the driver's last inbox claim

Status: implemented

English | [中文](2026-10-16-agent-loop-last-claim-wake-latch.zh.md)

## Problem

The `node 24 / snapshots` lane failed once on `replays subagent-list-agents through dsh --profile sdk`: the case consumed its complete 120 s budget and failed as `Test timed out in 120000ms`, while the other 224 cases in the same lane finished normally. The same commit passed on rerun, the scenario finishes in 1–3 s in every recorded CI run of the branch lineage, and 60 filtered local runs plus 24 full-file runs under parallel load never reproduced it. The failure is timing-dependent, not a property of the merged tree.

Investigation found a deterministic defect in the driver's exit path. A waking send — `followup` or `steer` — delivered after the driver's final inbox claim of an activity and before that driver's idle transition is never claimed and never wakes the driver again: the message stays pending, the agent stays idle, and a caller waiting for that input's turn waits until its own deadline. `send` classifies the wake against `this.phase`, which is still `running` at that point; `wakeDriver` returned without latching (only maintenance and post-abort deliveries latched), and no step boundary remained to claim the message.

The scenario's wake has exactly this shape: the continuation manager delivers a background continuable child's settlement notice to its parent, and the child's in-process chain can resolve beside the parent's turn end. When the notice lands in the window, the parent never runs its second turn, so the SDK snapshot harness waits for that turn's `turn/end` until the test budget expires. The delivery target also explains the two shapes an unlucky run can take: a notice that lands while a step boundary is still open is claimed as steering and changes the recorded log, while one that lands in the exit window previously hung.

`packages/core/agent-loop/src/agent.ts` is identical to upstream at `dsh-v0.2.1-alpha.5`, so the fork's lane inherits the defect rather than introducing it.

## Decision

The running phase carries `claimsClosed`, set when the driver takes the claim that finds the inbox empty and cleared when the same driver continues into another turn. `wakeDriver` latches a waking send when the phase is maintenance, when the send arrived after an abort, or when the phase is running with `claimsClosed`; the existing replay at convergence then starts the driver, whose first pre-step claims the message.

`inject` keeps its documented boundary: it never wakes the driver, so context that lands in the window stays pending for the next wake rather than opening a turn. The two exits that stop a driver for a decision rather than an empty queue keep their behavior too — a rejected first claim and a wake whose message was cleared before the claim both leave staged input pending, which `packages/core/agent-loop/tests/interception.spec.ts` pins as deliberate.

## Consequences

A waking send can no longer be lost to the driver's exit, so delivery timing no longer decides whether the message ever runs. The fork now diverges from upstream in one core-loop file; the divergence is one phase field, one latch condition, and one assignment pair, and each upstream sync must re-check it and retire it once upstream ships an equivalent.

The scenario that exposed the defect stays timing-sensitive in a narrower way: which inbox boundary the manager chooses for the settlement notice (`queue` while the parent is idle, `steer` while it is running) decides the splice the recording contains, so an unlucky replay can still fail the log comparison. It can no longer wait forever, because a latched wake always starts the turn that claims it.

## Alternatives considered

**Latch every pending message at the idle transition.** Rejected: `inject` deliberately leaves context pending without waking the driver, and starting a turn for injected context would break that boundary; a pre-step listener that injects on every turn could then keep the driver alive indefinitely.

**Restart the driver from `kick()`'s finally whenever the inbox is non-empty.** Rejected for the same reason, and it would also discard the replay's suppression rule — a latched wake whose message was removed before the idle transition must not start a turn.

**Deliver the notice again from the fork's subagent manager when the parent stays parked.** Rejected: the manager observes `Agent.status`, which cannot distinguish "a live driver will claim the message at its next step" from "the driver already took its last claim", so the manager would re-deliver on correct deliveries.

**Report the defect and change nothing.** Rejected: the fork's own merge gate flakes on it, upstream's issue tracker is unreachable from this remote, and the fix is small enough to carry with a named retirement condition.

## Testing

`packages/core/agent-loop/tests/loop.spec.ts` adds two cases. `runs a waking send that lands after the driver took its last inbox claim` queues the send from a microtask scheduled while the final `turn/end` is appended, which is the deterministic form of the window, asserts the phase was still running when the send landed, and requires the message to run as its own turn; it fails without the phase field. `leaves injected context in the same window pending for the next wake` pins the boundary the first case must not cross.

`pnpm exec vitest run --coverage --coverage.include='packages/core/agent-loop/src/agent.ts' packages/core/agent-loop/tests/` passes 453 cases with the file at 100% statements, branches, functions, and lines.

## Related

- [Name the awaited state when a snapshot-harness wait times out](../../implemented/testing/2026-09-12-snapshot-wait-diagnostic.md) — the earlier change for the same failure family: an unbounded wait reports its state instead of a library message.
