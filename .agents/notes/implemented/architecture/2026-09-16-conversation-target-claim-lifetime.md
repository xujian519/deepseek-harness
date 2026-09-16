# Agent Note: Conversation view targets stay assembled only while something claims them

Status: implemented

English | [中文](2026-09-16-conversation-target-claim-lifetime.zh.md)

## Problem

Every `ConversationNodeAssembler.flush()` applies the dirty Contexts of each **active** target, and before this change a target became active permanently: selecting it once, or subscribing to its source once, added it to a monotonic set that had no removal path. The trajectory target therefore kept receiving work after the user left its tab. Its builder walks the whole loaded window on every call — `TrajectorySnapshotBuilder.apply` re-derives the complete snapshot, allocating `eventNodes`, `eventLocations`, `requests`, and `callSchemas` and sorting the requests and the finalized nodes — so the per-flush cost followed the loaded window rather than what the user could see.

The magnitude is smaller than the audit that motivated this work estimated. It claimed 1–3 ms per flush without measuring; driving the real `TrajectorySnapshotBuilder` directly over a synthesized window measures far less, and linearly in the loaded window:

| Loaded contributions | `apply` median | `apply` maximum | 40 flushes |
|---|---:|---:|---:|
| 3,000 (a 240-turn window) | 0.13 ms | 0.72 ms | 7.0 ms |
| 10,000 | 0.59 ms | 2.55 ms | 28.6 ms |

A second corpus of Assistant contributions carrying node payloads and partial state measures 0.08 ms and 0.28 ms per `apply` at the same two sizes, so the cost is the walk and the two sorts, not the payload.

The end-to-end case agrees. [`benchmarks/long-session-browser`](../../../../benchmarks/long-session-browser/long-session.bench.ts) already walks the reported path — open a 240-turn Session, load every older page, visit the Trajectory tab, return to Chat, then stream a paced reply — and reports Chromium main-thread `TaskDuration` for the stream phase. Restoring monotonic activation and rebuilding changes that median from 1338 ms to 1377 ms, inside the case's own sample spread of 1314–1431 ms: at a 240-turn window the released target is worth about half a percent of the stream, and the gate cannot resolve it.

What the change fixes is therefore the invariant rather than a measured bottleneck: main-thread assembly work should follow what the shell shows, and with a monotonic set it instead accumulated the cost of every View the user had ever opened, on every flush, for the rest of the Session.

## Decision

**A target is assembled while the shell selects it or while at least one subscriber claims its source; the last claim releases it without discarding what it built.**

- `packages/client/ui-conversation/src/client/conversation/assembler.ts` derives activity instead of storing it: `selectedTarget` holds the shell's current View, `subscribers` counts per-target source subscribers, and `isActive(target)` is their union. The `flush()` replace and incremental loops, and `markDirty`, read that predicate instead of a monotonic set.
- `selectTarget(target)` replaces the previous selection. The shell shows one View at a time, so selecting another View releases the target behind it; `retainTarget(target)` adds one subscriber claim and `releaseTarget(target)` removes it.
- `ConversationBinding.target(target).subscribe` now returns an unsubscribe that releases the claim it took, and `ConversationBinding.activate` is renamed `select` because its contract changed from adding a permanent active target to naming the shell's View.
- Releasing keeps `view.builder` and `view.snapshot`: nothing built is thrown away, and the next claim takes the existing `replaceView` path, so re-entry is byte-identical to first activation but costs one full rebuild instead of one per frame.
- A subscriber claims a target without selecting it, so a target that something off-screen reads (an approval card in the composer reading the Chat snapshot while the Trajectory tab is open) stays assembled.
- `activityTargets()` keeps reading the shell selection alone. A subscriber keeps a target live without reporting shell activity, so `conversationPhase` still follows what the shell shows.

## Alternatives considered

- **Keep the monotonic set and release only subscriber claims.** Rejected as a no-op: the shell selects a View through `activateView`, and both paths that open Trajectory — the View ring's `selectView` and Chat's tool-card `openView` — select it first, so Trajectory would have remained active after the user switched back to Chat, which is the reported cost.
- **Drop the assembler snapshot and builder on release.** Rejected: the released target would rebuild from scratch on every re-entry, and a target that is selected and subscribed at once would rebuild when the last subscriber left even though the shell still shows it.
- **Let subscribers report shell activity too.** Rejected: `conversationPhase` would then depend on which components happen to be mounted, and a blank Session could read as active because an off-screen reader claimed Chat.
- **Unmount the released target's React tree instead of freezing its snapshot.** Rejected: it changes what the user sees when they return — scroll position and fold state are component-local — where the frozen snapshot keeps the shipped rebuild path.
- **Release on Session switch instead of on View switch.** Rejected as insufficient: the reported cost is paid by the Session the user is looking at, after the user leaves the Trajectory tab without switching Sessions.

## Consequences

A View that the user leaves stops costing main-thread time on every subsequent flush, so the cost of a long Session no longer depends on which Views were visited earlier. The measured size of that saving is small on the path this change was justified by — about 0.13 ms per flush at a 240-turn window — and the public API change below is the price paid for it. The trade-off inside the engine is one full `replace` at each re-entry: the released target's snapshot may be arbitrarily stale, so the first flush after a claim rebuilds it from the complete Context set rather than incrementally. Release also keeps the retained snapshot readable, so `target().getSnapshot()` returns the last assembled value until a claim rebuilds it.

`ConversationBinding` loses `activate` and gains `select`; the assembler's `activateTarget` becomes `selectTarget`, plus `retainTarget` and `releaseTarget`. Test harnesses that only need a materialized target to read assert their own claim with `retainTarget`, which states that they act as subscribers.

Two boundaries remain. The shell's selection is not released when the user switches to another Session, so a Session whose View is open stays assembled while it is in the background; that is the pre-existing behavior and remains owned by the Session binding lifecycle. And a peer plugin that switches a view through `ctx.conversation.setActiveView` writes the store without selecting the target, so the shell's selection follows the persisted preference at its next selection event while the switched-to View is assembled by its own mounted subscriber.

## Testing

- `packages/client/ui-conversation/tests/conversation-assembler.client.spec.ts` pins the claim lifetime: a first claim materializes and subsequent claims do not; one of two claims leaving still receives `apply`; the last claim leaving stops `apply` and keeps the snapshot object identity; the next claim rebuilds exactly once and lands on the content a continuously assembled target holds. It also pins selection: selecting another target stops the previous target's `apply`, an already selected target is not rebuilt, and reselecting a released target rebuilds it once from current Contexts.
- `packages/client/ui-conversation/tests/conversation-registry.client.spec.ts` drives the binding: a first subscriber materializes an unselected target and observes the rebuild, an arriving and leaving second subscriber neither rebuilds nor releases, the last subscriber's departure keeps the snapshot, the next claim rebuilds once and notifies every Session-snapshot subscriber, and selecting an already claimed target does not rebuild it.
- `pnpm exec vitest run packages/client/ui-conversation` — 419 passed across 32 files. `packages/client/ui-conversation/src/client/*` sits under the existing GUI-debt coverage exemption in `vitest.config.ts`, so the per-file gate does not apply here; the new branches are covered directly by the cases above instead.
- `pnpm exec vitest run packages/client apps/web` — 7328 passed, 5 skipped. One unrelated failure remains in the untouched `ui-sidebar-documentpreview` suite (`keeps every bundled license in the packed client artifact`), which throws inside its own `pnpm pack --json` parsing before asserting anything; it fails identically with this change's files stashed.
- Negative control, run and reverted: restoring monotonic activation (`isActive` returning true for every target that was ever claimed) fails the release assertions in `conversation-assembler.client.spec.ts` and `conversation-registry.client.spec.ts`.
- `pnpm exec vitest run --config vitest.bench.config.ts benchmarks/long-session-browser`, before and after the change on the same machine, reports the stream-phase `TaskDuration` below.

## Browser measurement

The case's gated budgets are still open, page, and first Trajectory use, so this change needs no new budget and no new case. Three samples, median per phase, same machine and synthetic Session, with monotonic activation restored and the Client bundle rebuilt for the comparison:

| | stream `TaskDuration` | stream wall time | first reply visible |
|---|---:|---:|---:|
| Monotonic activation | 1338 ms | 2256 ms | 342 ms |
| This change | 1377 ms | 2273 ms | 347 ms |

The two runs are indistinguishable at this case's sample spread (stream `TaskDuration` samples 1314–1431 ms), which matches the probe above: at a 240-turn window the released target is worth about 7 ms of a 1.3-second stream. The case's assertions on transcript state, reply overlap, and page errors passed in both runs, and the transcript reached the settled reply in every sample.

## Related

- [Client Conversation business-node assembly](../../../../packages/client/ui-conversation/README.md) — the package README's description of View selection and target assembly this change revises.
- [Client Conversation assembly decision](2026-08-09-client-conversation-node-assembly.md) — the engine this claim lifetime belongs to.
