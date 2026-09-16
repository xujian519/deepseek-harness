# Agent Note: The SDK client's stream-settle window clears its timer

Status: implemented

English | [中文](2026-09-16-sdk-stream-settle-timer.zh.md)

## Problem

`HarnessClient.settleStreams()` raced `streamsSettled` against a `setTimeout(resolve, STREAM_SETTLE_MS)` through `Promise.race`. The race abandons its loser, so whenever `streamsSettled` won, the 100 ms timer stayed scheduled, uncleared and unref'd. Every request against a runtime that had already exited or failed to spawn runs that method before it throws `TransportClosedError`, so each such request armed one dangling timer per call. A batch that closes many sessions issues one dead-runtime request per session, and the accumulated timers kept the Node event loop alive for up to 100 ms after the last client-side result.

## Decision

`settleStreams()` constructs the promise directly: it schedules the timer, and when `streamsSettled` settles first it clears that timer and resolves.

The observable wait is unchanged — a caller still waits at most `STREAM_SETTLE_MS`, and `streamsSettled` still shortens that wait. What changed is that the timer no longer outlives the call that armed it, so a dead-runtime request leaves the event loop as clean as it found it. When the timer wins the wait, the handler attached to `streamsSettled` clears an already-fired timer when the runtime's stdio finally settles.

## Alternatives considered

**Only `unref()` the timer.** Rejected: the handle would still stay scheduled for its full window and accumulate across requests; unref exempts the timer from holding the loop open, which is a weaker statement than not creating the work at all, and it leaves the per-call accumulation the leak report is about.

**Await `streamsSettled` with no timer.** Rejected: the window exists because stdio need not settle when the runtime dies — a surviving grandchild holding the pipe keeps `stderr` and the exit edge apart — so removing the bound turns a dead-runtime failure into a request that never returns.

**Hoist one timer per runtime instead of one per call.** Rejected: the window bounds a caller's wait, and concurrent requests against the same dead runtime each need their own deadline.

**Leave the timer and document the cost.** Rejected: the timer is not a configured retention like `STDERR_TAIL_LIMIT`; it serves one caller's wait and has no reason to survive it.

## Consequences

A dead-runtime request now waits on `streamsSettled` and the 100 ms bound exactly as before, and leaves no scheduled timer behind.

The client still offers no way to cancel a settle wait: a caller that needs a shorter bound than `STREAM_SETTLE_MS` has none, which is unchanged by this decision.

## Testing

`packages/sdk/client/tests/sdk-client.spec.ts` pins the acceptance path: with fake timers installed after the runtime death is observed, a request against that dead runtime rejects with `TransportClosedError` and `vi.getTimerCount()` is `0`. Against the racing implementation the same assertion reported the one dangling timer.
