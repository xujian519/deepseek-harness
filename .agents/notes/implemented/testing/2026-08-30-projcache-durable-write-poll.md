# Agent Note: projection-cache durable-write assertions poll instead of sleeping

Status: implemented

English | [中文](2026-08-30-projcache-durable-write-poll.zh.md)

## Problem

`session-projection-cache`'s spec awaited a fixed 40 ms sleep before asserting that a write had landed. The write chain behind those assertions includes two fsyncs (the record file and its parent directory), and its tail latency under the full suite's parallel workers exceeds any fixed sleep: the same spec failed once in each of the last two local full-suite runs and once in CI, always on a positive assertion — the row still at the creation cut, or a `fresh` record file not yet present (`storedRows` folds "unreadable" into `undefined`, so the mid-rename window is invisible). Negative assertions were never the failures.

## Decision

Positive durable-write assertions now poll with `vi.waitFor` (10 s budget, 10 ms interval) through a local `eventuallyDurable` helper, matching the `vi.waitFor` convention already used by the session-persistence tests. The 40 ms `settle` sleep stays only for negative assertions ("never wrote within this window"), where a longer wait is strictly stricter; its comment now says so.

## Consequences

The spec no longer depends on wall-clock luck: the two previously flaky assertions retry until the atomic rename publishes the row, and a real regression still fails loudly with the assertion's own message after the 10 s budget.
