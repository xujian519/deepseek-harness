# Agent Note: Name the awaited state when a snapshot-harness wait times out

Status: implemented

English | [中文](2026-09-12-snapshot-wait-diagnostic.zh.md)

## Problem

`packages/test-support/session-snapshot/src/harness.ts` polls persisted state for the wait steps a scenario script can request: `waitForTurnStart`, `waitForTurnEnd`, `waitForSubagentTurnEnd`, `waitForGoalPhase`, `waitForInboxMessage`, `waitForTitleAfterTurnEnd`, `waitForEventAfterTurnEnd`, and `waitForFile`. Each of the eight waits delegated to `vi.waitFor(callback, { interval: 10, timeout })`, and the callback threw the caller's own diagnostic (`snapshot-harness: session "…" did not persist turn/end within 20ms`) while the awaited state was missing.

`vi.waitFor` rethrows a callback error only when an attempt already threw one before the budget ran out — its `handleTimeout` reads `let error = lastError; if (!error) error = new Error("Timed out in waitFor!")`. Every callback here is asynchronous: it harvests the sessions directory and parses JSONL. On a loaded machine the first attempt can therefore still be awaiting its own file I/O when the deadline fires, and the failure becomes `Timed out in waitFor!`, which names neither the awaited state nor the session.

Two consequences were visible in the repository:

1. **CI flake.** The first CI run of PR #114 failed on `waitForGoalPhase requires the requested durable goal phase` with `Timed out in waitFor!`; the same commit passed on re-run. That assertion uses a 20ms budget and is the only wait-timeout assertion here with no protection against the race.
2. **Two workarounds had accumulated around it.** `waitForPersistedChildTurnEnd` wrapped its wait in try/catch and rethrew the diagnostic with the underlying failure as `cause`, commented as covering "the deadline can precede the first harvest". The spec's `isolateDiagnosticTimeout` monkey-patched `vi.waitFor` so that 20ms-budget assertions ran one callback directly before entering the timed wait. A third site, `titleDiagnosticTimeoutMs`, raised the budget to 5s on Windows for the same reason.

## Decision

All eight waits now call one shared helper, `waitForPersisted(probe, diagnostic, timeoutMs)`:

- **The probe is a predicate.** It returns whether the awaited state is present, and the diagnostic moves to the call site, so each wait names its state exactly once and no probe signals "not yet" by throwing.
- **The deadline bounds the state appearing and the probe itself.** The helper races each probe against the remaining budget, so a probe that is still awaiting its own file I/O — or blocked outright — still reports the caller's diagnostic.
- **A throwing probe stays retryable.** `harvestSessionLogs` can race a session file being rotated, so a failed read is retried rather than fatal; once the deadline passes the last failure is reported in place of the diagnostic, because a read that failed says more than a state that never arrived.
- **An abandoned attempt is caught.** A probe the deadline walks away from gets a no-op rejection handler, so it cannot surface later as an unhandled rejection.

Both workarounds are deleted with the defect they covered: `waitForPersistedChildTurnEnd` no longer needs its try/catch, and the spec drops `isolateDiagnosticTimeout` and the Windows budget branch, so the title assertion uses the same 20ms budget on every platform.

## Alternatives considered

**Wrap every `vi.waitFor` in try/catch and rethrow the diagnostic with the underlying error as `cause`.** This is the smallest edit and matches what the child wait already did. Rejected: it buries the probe's own failure identity, and `waitForPersistedTurnStart` deliberately reports a malformed record as that validation error rather than as a missing state — a path its own comment and test pin. Eight duplicated try/catch blocks would also restate the same decision in eight places.

**Detect vitest's own timeout message and replace only that.** Rejected: matching a library's internal string is brittle, and the failure mode of a vitest update is silent — the waits would quietly return to reporting the library message.

**Raise the budgets.** Rejected: this is a reporting defect, not a slow-machine allowance. Larger budgets slow every scenario and still lose the state's name whenever the first attempt is slow enough — the same 5s Windows budget did not make the child wait deterministic on its own.

**Keep `vi.waitFor` and pre-run one callback before entering it.** Rejected: a blocked first callback hangs the whole wait, which is exactly the case the child-wait test exercises by making the first `readdir` never resolve.

## Consequences

A wait that times out now always names the awaited state, the session (or child and turn), and the budget, on every platform. A failing read inside a poll is reported as that read failure — previously the child wait reported it as the diagnostic with the failure attached as `cause`, while the other waits rethrew it directly, so this makes the eight waits agree.

The harness no longer uses `vi.waitFor`, so its tests assert the harness's own diagnostics instead of patching the library. Attempts that the deadline abandons keep running their file I/O to completion in the background, as they did under `vi.waitFor`.

## Testing

`pnpm exec vitest run --coverage packages/test-support/session-snapshot` — 344 passed, 1 skipped, with `harness.ts` at 100% statements, branches, functions, and lines.

- `identifies the child wait when its first log harvest outlasts the deadline` (existing): a mocked `readdir` never resolves, and the wait must still name the child and turn.
- `reports the harvest failure when a listed log cannot be versioned` (new): a session log whose filename and header declare different format versions is seeded into the sessions root, and the wait must report that mismatch rather than a missing state — the branch that reports a probe's own failure.

`pnpm run test:snapshot` replays the recorded sessions that drive this harness: 127 passed, 5 failed — the same five failing on a clean checkout of the merge base, and the fork CI runs no snapshot replay, so that suite was already red before this change.

## Related

- [ACP snapshot tests](2026-06-19-acp-snapshot-tests.md) — the suite that introduced this harness and its wait steps.
- Issue #92 — the test-reliability family this fix belongs to.
