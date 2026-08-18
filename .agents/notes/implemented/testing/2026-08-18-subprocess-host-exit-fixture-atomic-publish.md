# Agent Note: Subprocess host-exit fixture publishes the managed tree atomically

Status: implemented

English | [中文](2026-08-18-subprocess-host-exit-fixture-atomic-publish.zh.md)

## Problem

`process-exit.spec.ts` flaked on the fork's CI: two of five cases timed out after 30 seconds with `SyntaxError: Unexpected end of JSON input` from `readTree`, meaning `tree.json` existed but never carried content. The host fixture polled for the file with `access()` only, while the managed-tree fixture wrote it with an async `writeFile`, whose `open` creates the empty file before `write` completes. Under the fork's 4-core `ubuntu-latest` runner running all 816 files concurrently, that gap grew large enough for the host's 10 ms poll to hit it. The host's `JSON.parse` then threw an uncaught exception, the host exited, its `exit`-listener cleanup killed the managed tree mid-write, and the empty file stayed empty for the whole poll window. The same commit passed on rerun, so the failure was load-dependent, not a code regression.

## Decision

Both fixtures harden the publish handshake:

- `managed-tree.ts` writes `tree.json` to a staging path and renames it into place, so no reader ever observes a half-written file: `rename` is atomic.
- `process-exit-host.ts` replaces the existence-only poll with `waitForTreeState()`, which polls until the file parses to two valid, distinct, positive pids. A partial or empty read keeps polling instead of crashing the host, so a slow write can never strand the managed tree for the test.

## Alternatives considered

**Keep the existence poll and only raise timeouts or lower CI concurrency.** Treats the symptom: the race window scales with load, and the suite stays fragile on any busy runner.

**Use a synchronous write in the managed tree.** Shrinks but does not eliminate the visible-empty window, and the host still needs to tolerate a partial read. Atomic rename plus content-validated polling covers both directions.

## Consequences

The suite is stable under the fork's full-concurrency CI: a partially published tree no longer crashes the host, and no reader can see a half-written `tree.json`. The poll is unbounded, so a managed tree that never publishes valid content still fails the scenario's 30-second deadline loudly rather than hanging.
