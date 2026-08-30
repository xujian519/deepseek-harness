# Agent Note: projection-cache durable-write assertions poll instead of sleeping

Status: implemented

English | [中文](2026-08-30-projcache-durable-write-poll.zh.md)

## Problem

`session-projection-cache`'s spec awaited a fixed 40 ms sleep before asserting that a write had landed. The write chain behind those assertions includes two fsyncs (the record file and its parent directory), and its tail latency under the full suite's parallel workers exceeds any fixed sleep: the same spec failed once in each of the last two local full-suite runs and once in CI, always on a positive assertion — the row still at the creation cut, or a `fresh` record file not yet present (`storedRows` folds "unreadable" into `undefined`, so the mid-rename window is invisible). Negative assertions were never the failures.

## Decision

Positive durable-write assertions now poll with `vi.waitFor` (10 s budget, 10 ms interval) through a local `eventuallyDurable` helper, matching the `vi.waitFor` convention already used by the session-persistence tests. The 40 ms `settle` sleep stays only for negative assertions ("never wrote within this window"), where a longer wait is strictly stricter; its comment now says so.

## Consequences

The spec no longer depends on wall-clock luck: the two previously flaky assertions retry until the atomic rename publishes the row, and a real regression still fails loudly with the assertion's own message after the 10 s budget.

## Alternatives considered

**Drive the write chain with fake timers, as the interval test does.** Rejected: fake timers advance the clock but cannot signal real IO completion — the assertion observes an fsync-and-rename chain, not a timer. The interval test is deterministic because it spies `write` to a resolved mock; these tests assert the real durability protocol, which is the point under test.

**Hand-roll a poll loop over `storedRows` instead of `vi.waitFor`.** Equivalent in effect; `vi.waitFor` was chosen because it is built in and already the convention in the neighboring session-persistence tests, so the spec gains no helper beyond the thin budget wrapper.
