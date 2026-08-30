# Agent Note: M1 last sink — the abort-race primitive (`abortable`)

Status: implemented

English | [中文](2026-08-30-abortable-abort-race-sink.zh.md)

## Problem

The ledger's abort-race row recorded five wrappers across three cancellation semantics. A fresh scan before this change found the row stale: the two e2b copies (`withinMs`, `waitWithSignal` — sentinel results) no longer exist, removed upstream. Three remained: skill's `waitWithAbort` (rejects `toError(signal.reason)`, and also coerces provider rejections, per skill's public contract that everything it escapes settles as an `Error`), terminal-bash's `startupSession` hand-rolled race (registers a `once` abort listener rejecting `signal.reason`, plus an inline pwsh deadline that cancels the outstanding send), and subprocess-local's `waitForExit` (resolves `false` on abort — a query, not a cancellation). Each repeated the same listener-registration boilerplate the `dsh-timeout` package was created to own.

## Decision

- `dsh-timeout` gains `abortable<T>(promise, signal): Promise<T>` with the standard cancellation semantics: an absent signal returns the promise unchanged, an already-aborted or mid-flight abort rejects with `signal.reason` verbatim — the same value `throwIfAborted` throws — the wrapped promise's rejection is always consumed through a paired handler so neither a late rejection nor an abort-time rejection can surface as unhandled, and the listener is removed when either side settles first.
- skill's `waitWithAbort` folded onto it as a four-line adapter that keeps the `Error` contract (`signal === undefined` passes through untouched, matching the old fast path; the rejection path coerces with `toError`). All existing skill abort tests — `rejects.toBe(reason)`, the hostile-reason placeholder pin — pass unchanged.
- terminal-bash's `startupSession` dropped its listener boilerplate for `abortable`; the pwsh deadline (timer + `startupOperation.cancel()`) stays inline because it is timeout semantics, not cancellation. `TODO(pty-initialize-race-home)` stands: folding the race into `LocalPtySession.initialize` remains the send-state consolidation's job.
- subprocess-local's `waitForExit` stays local: resolving `false` on abort answers "did the tree exit, or did we give up waiting" — a three-state query compressed into a boolean, not a cancellation race.

## Consequences

Every M1 row now records closure; the ledger's primitive list is fully landed. Abort-race semantics have one home: notification-only cancellation with the signal's own reason, matching `dsh-timeout`'s stated boundary that the library notifies and the capability stops its own work.

## Alternatives considered

**Make the canonical rejection an `Error` (`toError(signal.reason)` inside `abortable`).** Rejected twice over: the `util/` group's documented constraint is "no runtime dependencies, invariant-companion peer only", so `dsh-timeout` cannot depend on `dsh-value`; and forwarding the reason verbatim keeps the rejection identical to `throwIfAborted` at the same signal. Callers that need an `Error`-typed escape — skill — keep a local adapter with a pinned test.

**Fold `waitForExit` onto `abortable` via a catch that maps the abort rejection to `false`.** Rejected: the conversion re-derives "was this the abort?" from the caught value, which is exactly the ambiguity the resolve-false shape avoids, and the result reads no simpler than the current listener block.

**Leave terminal-bash untouched until the send-state consolidation folds the race away.** Rejected as a reason to skip convergence: swapping the boilerplate for `abortable` is mechanical today and makes the later fold a pure deletion.
