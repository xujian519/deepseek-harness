# Agent Note: state waits in place of fixed sleeps, and what each clock bound decides

Status: implemented

English | [中文](2026-09-13-state-waits-over-fixed-sleeps.zh.md)

## Problem

Issue #92 lists four reliability families. Two earlier batches on the same Issue fixed the snapshot-harness wait diagnostics (#115) and the keyless corpus drift (#120); this batch takes the rest.

- `apps/desktop/tests/bridge-server.spec.ts` synchronized 20 socket round-trips with a fixed 20 ms sleep after each write — the largest single cluster in the repository. A fixed delay is not evidence that the peer wrote a frame: on a loaded runner the sleep expires first, the assertion reads an empty `frames` array, and the failure names nothing about what was awaited.
- Wall-clock bounds had accumulated across five suites without stating which of them is the observable under test and which merely repeats what another assertion already proves.
- `vitest.e2e.config.ts` holds the repository's only retry, and its comment attributed the retry to concurrency-quota jitter alone while `retry: 2` reruns any failure, assertion failures included.
- The compiled-bundle import sweep in `packages/experimental/webworker-runtime/tests/compile/transform-corpus.spec.ts` skipped itself whenever the workspace held no build output — every lane that does not run `pnpm run build`, including this fork's CI job — so a lane that lost its build step would degrade to a silent pass.
- Two items were unregistered: the permanently disabled real-API probe in `packages/web/web-search-deepseek/tests/deepseek.e2e.ts`, and proposal 3 of the deterministic-testing note (a repeat/shuffle race-stress job), which has no owner and no CI mechanism behind it.

## Decision

**Bridge server round-trips wait for frames.** `waitForFrame(predicate)` parses the lines the client already accumulates, polls until one matches, and reports the frames that did arrive when none does. Three details follow from the bridge's own behavior:

- `beforeEach` performs a readiness handshake with an allow-listed no-op method (`desktop/unregisterGlobalShortcut`). The bridge attaches its backend socket inside the accept callback, so a connection event is not proof that a later `notify()` push reaches this client; a completed round-trip is.
- The id-less-frame case asserts an absence, which has no event to await, so it now sends a valid frame behind the invalid one and asserts the total frame count. The bridge answers in request order, so a reply to the id-less frame would have to appear before the id 1 response.
- `afterEach` replaces the fixed settle with a bounded retry around `unlinkSync`, which covers POSIX unlinking the socket file when the closing server releases it and Windows freeing a pipe name asynchronously.

**Clock bounds keep only what they decide.** Three elapsed assertions in `packages/experimental/code-runtime-python/tests/runtime.spec.ts` are deleted: in each, the assertion of record is the reported outcome, and a run that consumed its wall budget would report `timeout` (or a defined `error`) instead of the asserted value, so the bound could only fail spuriously. The bounds kept are the ones that separate two live outcomes, and each now names what it separates: the wall deadline against a program that would otherwise run forever (`maxWallMs: 500`), the CPU hard limit against the wall ceiling, the grace window that `dispose()` must wait out, the close-deadline backstop against a setsid orphan's own self-exit, and the fallback-work ceiling in `ui-primitives` whose measured cost is ~60 ms against a 3 s bound.

**The e2e retry stays at the external boundary, described accurately.** `retry: 2` remains, with a comment recording that it reruns any failure because a real-API test cannot separate its own expectation from the provider: one shared internal key serves the run, so a quota or provider transient arrives wrapped in whatever assertion it broke. A narrowed `condition` regex cannot express that, and the keyless snapshot tier is named as the lane where an intermittent defect must be reproduced instead.

**The corpus sweep announces its skip.** Under CI it emits `::warning::compiled-bundle import sweep skipped: the workspace has no build output`, mirroring the sandbox-windows-acl probe skip, and passes the same reason to `context.skip`. The warning is the consumer: it turns a silent pass into a run annotation.

**Registrations.** The disabled search probe stays disabled with its existing reason and is recorded in the debt ledger. Proposal 3 of the deterministic-testing note is now tracked as [Issue #121](https://github.com/xujian519/deepseek-harness/issues/121), and the note records that the Vitest 4 option names differ from its `--repeat`/`--shuffle` wording (`test.repeats`, `--sequence.shuffle`).

## Alternatives considered

- **Narrow the e2e retry with a `condition` regex.** Rejected: the failure text of a transient provider fault is the assertion it broke, not the fault, so a message filter would remove the retry exactly when it applies.
- **Delete every elapsed bound.** Rejected: several are the only observable that separates the deadline under test from an unbounded wait; deleting them would trade a flake for a blind spot.
- **Widen the kept bounds for load headroom.** Rejected: it would reduce the separation each bound is there to make, and the measured margins already exceed any plausible scheduler delay.
- **Make the corpus sweep fail without build output.** Rejected: a unit-only lane legitimately has none, so failing would break lanes that are correct; the annotation is what removes the silence.
- **Rewrite the two better-sidebar EditorHost cases onto `vi.waitFor`.** Rejected as speculation: those cases failed once in the audit's full-suite run, ten runs under a saturated CPU pool passed all 18 cases each, and no awaited state is identifiable from the failure. The ledger records the observation and the reproduction attempt instead.
- **Land the race-stress job in this batch.** Rejected: it is CI topology, not a test fix, and it needs its own range, budget, and failure-consumption decisions.

## Consequences

Every socket round-trip in the desktop bridge suite now fails with the frames it saw instead of an empty read, and the suite completes in ~4 s where the sleeps alone cost 20 ms per case. The delete-and-document split on clock bounds leaves the repository with one rule: an elapsed assertion must name the two outcomes it separates. Two blind spots remain by construction: the e2e lane still retries assertion failures, so an intermittent defect there is masked until the snapshot tier or a manual rerun reproduces it, and the compiled-bundle sweep still does not run in this fork's CI — it now says so rather than passing quietly. The EditorHost observation is registered, not fixed.

## Testing

`pnpm exec vitest run apps/desktop/tests/bridge-server.spec.ts` (19 passed, 4.0 s); `pnpm exec vitest run packages/client/better-sidebar/tests/cov-host-git.spec.ts packages/client/ui-primitives/tests/markdown.client.spec.tsx packages/experimental/code-runtime-python/tests/runtime.spec.ts packages/experimental/webworker-runtime/tests/compile/transform-corpus.spec.ts` (302 passed / 2 skipped); the corpus skip branch exercised through a temporary forced-empty corpus with `CI=1`, which printed the `::warning::` line and skipped (reverted); `pnpm run lint` (0 warnings / 0 errors) and `pnpm run typecheck`.

## Related

- [Snapshot-harness wait diagnostics](2026-09-12-snapshot-wait-diagnostic.md) — the same rule applied to the session-snapshot waits.
- [Repairing the keyless recorded-session corpus](2026-09-12-snapshot-corpus-repair.md) — the preceding batch on Issue #92.
- [User-patch transactions control filesystem event delivery](2026-09-09-user-patch-hmr-test-delivery.md) — the fixture whose `eventually` helper reports load average and waited time, already covering that family's load-sensitive case.
- [Tech-debt tracking in same-repository Issues](../process/2026-09-11-tech-debt-issue-tracking.md) — where Issue #92 and the new Issue #121 are registered.
