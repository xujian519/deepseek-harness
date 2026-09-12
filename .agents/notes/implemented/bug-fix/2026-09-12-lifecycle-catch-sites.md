# Agent Note: naming the swallowed failure in lifecycle catch sites

Status: implemented

English | [中文](2026-09-12-lifecycle-catch-sites.zh.md)

## Problem

`AGENTS.md` requires an empty catch to name what it swallows and why nothing else can reach it. The 2026-09-11 scan found 62 `catch(() => {})` sites in `src/` with no such note, concentrated in process- and session-lifecycle paths, so a reader could not tell a deliberate best-effort cleanup from a lost failure. The scan named two packages to judge first because they own those lifecycles: `core/agent-loop` (7 sites) and `subprocess/subprocess-local` (8).

Reading all 15 showed the scan's "no explanation anywhere" was too broad: four already carried the reason. `agent-loop` states "Rollback swallows a disposal rejection: the setup failure is primary" above its rollback disposal and close, and `spawn.ts` states that `terminate()` keeps the shared range-observation rejection available to `waitForExit()` without leaking an unhandled rejection. Eleven sites had no note.

## Decision

Every one of the eleven dropped rejections is one nobody can act on, and each now says so at the site. The sites fall into five shapes:

- **Rollback after a failed setup** (`agent-loop/src/index.ts` in `create` and `setupAndPublish`): the setup failure is the primary error the caller must see, so the close rejection is dropped rather than allowed to replace it. This matches the wording the existing rollback comments use.
- **A handle that lost its owner to cancellation** (`createAgent`'s `raceAbortCall` abandonment): the caller receives its abort, and the handle finished creating after it, so nothing observes this close.
- **A close in a `finally`** (`resumeWith`): the block's outcome — a published agent, or the error that unwound it — is already fixed.
- **Teardown's join on a process it is killing** (`disposeManagedProcesses`, and the `release` callbacks that unregister ordinary and terminal handles): the direct result belongs to the caller that started the process, `waitForExit()` is the teardown's own evidence and is reported through `Promise.allSettled` (or thrown), and a failed range wait leaves the handle registered so teardown still force-kills it.
- **Unhandled-rejection guards on a promise that keeps its own consumers** (`WindowsJobOwner`'s constructor, `terminal.ts`'s post-settlement owner cleanup, `spawn.ts`'s deferred owner cleanup, and the pre-aborted branch of `managed-owner.ts`'s `waitWithAbort`): the failure still reaches whoever waits on the original promise, or the caller is already told the wait did not complete, so the guard only prevents browser/Node noise.

## Alternatives considered

- **Extract `settleQuietly(handle)` and call it from every site**, as the finding suggested. Rejected: the five shapes drop the failure for different reasons, and the reason is only readable where the drop happens; a helper would also need a package home, and `dsh-value` holds untrusted-input primitives rather than lifecycle policy.
- **Log each dropped rejection.** Rejected for the sites whose failure another path already reports (rollback's setup error, the caller's abort, teardown's aggregate): a log line would duplicate a failure the caller sees. For the guards, the promise's rejection still reaches its waiter, so a log would add noise without adding information.
- **Treat the whole 62-site finding as one change.** Rejected: the remaining 47 sites sit in 20 packages with their own lifecycles (subagent bridges, LSP stdio, OpenViking, e2b, browser UI), and judging each needs the same per-site reading this batch did. Issue #85 stays open for them.
- **Fix the count in the finding rather than the sites.** Rejected: the count is not the defect; the missing reason is.

## Consequences

The two lifecycle packages' silent sites are self-describing, and the five shapes give the remaining 47 sites a vocabulary to be judged against. No behavior changes: comments only, so nothing observable depends on this batch. The cost is that the reason is prose the compiler cannot check — a later refactor that moves one of these calls must carry its comment along, and a genuinely lost failure added in the same shape will look pre-approved unless the reviewer reads the named owner.

## Testing

`pnpm exec vitest run packages/core/agent-loop packages/subprocess/subprocess-local` — 685 passed, 13 skipped. `pnpm run typecheck`, `pnpm run lint`, and `pnpm run duplication` were run over the change; comments cannot alter runtime behavior, so no snapshot is owed.

## Related

- [tech-debt tracking in same-repository Issues](../process/2026-09-11-tech-debt-issue-tracking.md) — the scan that produced the finding, which Issue #85 records.
- [abort and key-set sink](../architecture/2026-09-12-abort-and-keyset-sink.md) — the same scan's helper-convergence batch.
