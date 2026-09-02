# Agent Note: /proc stat read failure ESRCH means the pid is gone

Status: implemented

English | [中文](2026-09-02-procfs-stat-read-esrch-means-gone.zh.md)

## Problem

The `spawnSubprocess` process-group spec failed once on the Linux CI lane with `Error: ESRCH: no such process, read` thrown from the spec's `waitGone` helper. The helper polls exit with `process.kill(pid, 0)` and, on Linux, reads `/proc/<pid>/stat` to see through the zombie state. `readFileSync` opens the procfs file and then reads it; when the task is reaped between the two syscalls — exactly the window after a process-group kill — the already-open read returns `ESRCH`. The helper only accepted `ENOENT` as "gone" and rethrew `ESRCH`, so the case failed even though the behavior under test had succeeded: `done` had already settled with SIGTERM before the helper crashed. The window is narrow, which is why the case passed on every earlier Linux run.

## Decision

`waitGone` in `packages/subprocess/subprocess-local/tests/spawn.spec.ts` treats `ESRCH` from the `/proc/<pid>/stat` read like `ENOENT`: both codes mean the pid no longer exists, which is the condition the helper polls for. The catch comment names the reap-between-open-and-read race. The `process.kill(pid, 0)` probe already treats every error as gone and is unchanged.

## Consequences

The Linux exit poll now recognizes all three procfs signals of a vanished task: `ENOENT` before open, `ESRCH` on the post-open read, and zombie state `Z`. Sibling probes keep their own policies: `terminal-bash`'s `processIsRunning` treats any procfs read error as gone; `lsp-stdio`'s `processAlive` still rethrows non-`ENOENT` read errors and carries the same latent race, left unchanged because it has not failed and its owner may prefer the broader catch. Verification evidence: the pre-fix failure is CI run 33510696039 on 9bbdc210; the signature is Linux-procfs-specific and the workspace host is macOS without a Linux container, so the next Linux lane after this change is the post-fix reproduction.

## Alternatives considered

**Treat any procfs read error as gone, as `terminal-bash`'s `processIsRunning` does.** Rejected for this helper: `EACCES` or `EIO` on the stat read do not distinguish "gone" from "unreadable", while `ENOENT` and `ESRCH` each exactly mean gone; rethrowing the rest keeps the poll loud about unexpected platform behavior.

**Wrap the poll in a retry or widen the timeout.** Rejected: the awaited state was already named and the poll already bounded; the defect was misreading one kernel signal for that state, so retrying or waiting longer would mask the misreading rather than fix it.
