# Agent Note: naming the swallowed failure in the merged-in catch sites

Status: implemented

English | [中文](2026-09-16-merged-in-catch-sites.zh.md)

## Problem

`AGENTS.md` requires an empty catch to name what it swallows and why nothing else can reach it. Issue #85 closed with every `catch(() => {})` site in `src` judged against the six shapes the two batches established ([the lifecycle batch](2026-09-12-lifecycle-catch-sites.md) and [the cross-package batch](2026-09-12-cross-package-catch-sites.md)).

The upstream v0.1.6-alpha.1 merge then carried in package groups that had never been scanned — `ssh/` (first commit 2026-09-11), `ptc-runtime/` (09-12), and `experimental/browser-use-stagehand-native` (09-12) — whose sites were written in those same shapes with no reason attached. Twenty-four `src` sites dropped a rejection with nothing at the site saying which one or why the drop is contained.

## Decision

Twenty-four sites in 7 files across 5 packages now name their dropped failure next to the statement that drops it: `ssh/ssh` (15), `ssh/subprocess-ssh` (6), `ssh/fs-ssh` (1), `ptc-runtime/ptc-runtime-node` (1), and `experimental/browser-use-stagehand-native` (1).

The sites fall into five of the six established shapes, with no shape or wording invented here.

- **Unhandled-rejection guards on a promise that keeps its own consumers** (6: `ssh`'s `track()` and `helper-processes`' two completion chains and its `connected.promise`; `subprocess-ssh`'s process `done` and terminal `done`): the guard covers the window before those consumers attach, and `dispose()`/`done()` already receives the outcome.
- **Best-effort work with no observer** (5: `ssh`'s forward cancellation after its socket closes; `helper-processes`' preparation-expiry release, forwarded terminal output, and stdin forwarding; `subprocess-ssh`'s `live` bookkeeping): the absence of the effect changes nothing a caller can act on — the process outcome or the next cleanup pass is the authority.
- **Cleanup that must not replace the primary error** (9: `ssh`'s `ready` in `disposeOnce`; `helper-processes`' missing-control-channel drop, its two joined forward streams, and its `preparing`/`start` joins; `subprocess-ssh`'s termination join and its two helper-lease releases; `fs-ssh`'s stream close): the reported error is the one the caller receives.
- **An abandoned request or response** (2: `subprocess-ssh`'s abort handler, and `browser-use-stagehand-native`'s abort teardown): the caller's own abort is the authority, and the aborted work has no observer left.
- **Teardown's join on the process it is killing** (1: `ptc-runtime-node`'s `handle.done`): `waitForExit()` is the teardown's evidence, and the run's own failure or value is already settled.

No behavior changes: comments only, so nothing observable depends on this batch.

## Alternatives considered

**Log each dropped rejection.** Rejected on the same grounds as both earlier batches, sharpened by these sites: the guards' rejections still reach their waiter, so a log would duplicate a failure the caller already handles, and the timer-driven expiry release and the abort handlers have no destination that a user or caller would read.

**Extract a named helper such as `settleQuietly(handle)`.** Rejected: the guard shape keeps the promise's consumers while the abandoned-request shape has none, so one helper would have to guess which promise it holds, and the reason is only readable where the drop happens.

**Add a gate that enforces the rule mechanically.** Rejected: the only mechanical signal is a comment near the `catch`, and the sites show that proxy misfires — `client/synapse/src/client/index.ts:185` carries a reason adjacent to the statement that owns its `catch`, six lines above the `catch` itself because that statement spans a multi-line object literal, and every line-window scan reports it as missing. A gate on the proxy would push authors to write comments for the checker rather than for the reader, so this stays a manual batch.

**Change the sites instead of commenting on them.** Rejected: propagating a failed forward, expiry release, or abort-side termination would replace the outcome the caller receives, and the surfaces that drop these rejections have nowhere to report one.

## Consequences

The `src` population is self-describing again after the merge, and the six shapes remain the vocabulary a new site is judged against.

The reason is prose the compiler cannot check, so a refactor that moves one of these calls must carry its comment, and a genuinely lost failure added in a known shape looks pre-approved unless the reviewer reads the named owner.

The issue's list recorded 23 sites; judging the tree by the same rule found 24, the extra being `helper-processes.ts`'s preparation-expiry release, which its evidence list omits.

## Testing

`pnpm exec vitest run` over the five packages (47 files, 470 passed, 1 skipped). Comments cannot alter runtime behavior, so no snapshot is owed.

## Related

- [naming the swallowed failure in the remaining catch sites](2026-09-12-cross-package-catch-sites.md) — the batch that established the shapes and closed Issue #85.
- [naming the swallowed failure in lifecycle catch sites](2026-09-12-lifecycle-catch-sites.md) — the first batch and the vocabulary this one reuses.
- [tech-debt tracking in same-repository Issues](../process/2026-09-11-tech-debt-issue-tracking.md) — the scan practice that produced the finding.
