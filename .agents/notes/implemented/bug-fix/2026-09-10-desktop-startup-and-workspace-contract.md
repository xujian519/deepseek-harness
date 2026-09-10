# Agent Note: Report a stalled desktop start and keep the workspace contract exact

Status: implemented

English | [中文](2026-09-10-desktop-startup-and-workspace-contract.zh.md)

## Problem

Two failure modes left a desktop installation unusable without saying why.

**A start that never settles is silent.** One launch after a hard-killed instance produced a running process with no window, no backend child, nothing on stderr, and an idle main thread — indistinguishable from a slow start, and impossible to diagnose from the machine afterwards. Each startup stage (bridge, packaged-profile transaction, backend) was awaited without a deadline, so any stage that never settled held the shell in that state indefinitely.

**pnpm rewrites the profile's workspace file, and the profile contract compares it exactly.** pnpm 11 records supply-chain release-age exemptions in the project's own `pnpm-workspace.yaml`; installing `@dely0/dsh-personal-workbench@1.12.1` and `dsh-checkpoint-rewind@0.6.9` appended a `minimumReleaseAgeExclude` block. `projectManifest` compares that file against the exact text it generates, so the annotating transaction failed its own next manifest read — the recorded desktop unit tests reproduce it — and a profile annotated by an earlier GUI plugin install refuses to start.

## Decision

`withStartupDeadline` bounds each startup stage at 180 seconds and names the stage in its failure, which reaches the existing startup-failure dialog instead of an idle process.

Inside one pnpm call, `runPnpm` passes `--config.minimumReleaseAge=0` so pnpm does not record the exemption, and rewrites `pnpm-workspace.yaml` to the contract text after every successful call, so no annotation from any pnpm version survives a transaction.

## Alternatives considered

**Log more and treat the hang as environmental.** Logs do not turn a hung start into a reported one; the operator still sees only a missing window.

**Relax the workspace comparison to ignore unknown keys.** That comparison is what keeps every core package resolving from the packaged local tarballs; accepting extra keys would stop detecting hand edits and tooling writes that change resolution.

**Rely on `--config.minimumReleaseAge=0` alone.** It depends on the packaged pnpm's current behavior; the rewrite is the version-independent guarantee.

## Consequences

A genuinely slow start — hashing the packaged seed and the profile's local tarballs on a cold cache, then booting every installed plugin — must finish inside the deadline or report a named failure. A stalled stage now costs a dialog and a diagnostic instead of an unexplained idle process.

Every transaction rewrites the workspace file, so any other pnpm annotation there is discarded. That is intended: the profile contract, not pnpm's bookkeeping, owns the file.

The root cause of the observed stall was not reproduced; the deadline changes its symptom from silence to a named failure rather than fixing a known defect.
