# Agent Note: self-evolving plugins capability seam

Status: proposed

English | [中文](2026-08-17-self-evolving-plugins-capability-seam.zh.md)

## Problem

The harness has no structured seam for plugins to observe their own failures and propose harness improvements. Ad-hoc self-modification would bypass approval flows, sandbox boundaries, and rollback mechanisms. We need a capability seam that defines how an engine mines session failures, proposes harness changes, and validates them without compromising host integrity or model-visible history.

## Proposal

Establish the `ctx.selfEvolve` capability seam and the execution boundaries for L1-L4 self-improving plugins. The seam maps Cordis spatiotemporal composition to a three-stage evolution loop: weakness mining, bounded proposal generation, and proposal validation.

The capability follows the standard three-part seam:

- **Service Definition**: `SelfEvolveEngine` declares the evolution lifecycle and triggers.
- **Service Provider**: implements the three-stage loop and snapshot-isolated regression testing.
- **Consumer**: `tool-self-evolve` exposes the evolution triggers and status to the model.

The engine hooks into the agent loop via `runMaintenance()`, executing weakness mining and validation testing asynchronously when the agent is idle. A rate-limiting policy restricts the number of autonomous proposals per session to prevent token exhaustion and diversity collapse.

### Session projection and weakness mining

Weakness mining reads from the append-only session log. Instead of traversing the log during the maintenance phase, the engine uses a `SessionProjection` to incrementally fold `session/event` streams into a failure-pattern state tree. This projection isolates the mining logic from the raw log structure and maintains constant-time access to historical failures.

### Sandbox execution boundaries

Language-level access controls and the `cordis-host-runner` 5-second `vm` timeout do not constitute a secure execution boundary for model-generated L4 harness code.

- L4 harness proposals apply and execute exclusively within the `subprocess`/`landlock` sandbox.
- Human approval remains the default policy for client code updates. Autonomous pipelines do not bypass the approval flow (`clientVersionUpdatesApproved` remains `false` for L4 proposals).

### Reversible effects and data rollback

Cordis reversible effects (`ctx.effect`) cleanly unwind plugin registrations, listeners, and framework-level side effects when a proposal validation fails.

Reversible effects do not undo business data mutations. The validation harness provides explicit snapshot isolation and teardown for the filesystem and SQLite databases during the held-in and held-out regression tests.

## Alternatives considered

**Allow ad-hoc model-driven file edits.** Rejected because unbounded edits have no isolation, no rollback, and no approval gate; a failed edit could corrupt the running harness.

**Run proposed harness code in-process.** Rejected because model-generated L4 code must not share the host process; the existing `vm` timeout is not a security boundary.

**Implement evolution as a separate service outside the harness.** Rejected because an external service would lose direct access to session context, Cordis effects, and the plugin lifecycle, forcing a redundant wire protocol and stale snapshots.

## Acceptance criteria

- `SelfEvolveEngine` exposes the evolution lifecycle and triggers through a Service Definition.
- The provider runs weakness mining through an incremental `SessionProjection` over `session/event`.
- L4 harness proposals apply and execute only inside the `subprocess`/`landlock` sandbox.
- Client code updates keep the human approval flow by default.
- Failed proposals unwind through Cordis reversible effects; regression tests use snapshot isolation for filesystem and SQLite state.

## Risks

- Autonomous loops could exhaust tokens or collapse proposal diversity. Mitigated by per-session rate limiting and a proposal cap.
- Sandbox escape remains a host-level concern; this proposal relies on the existing `subprocess`/`landlock` boundary, not on the `vm` timeout.
- Reversible effects cannot roll back business data, so held-in and held-out tests must provide their own snapshot isolation.
