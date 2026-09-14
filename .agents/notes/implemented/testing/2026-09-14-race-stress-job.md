# Agent Note: Nightly race-stress job with repeats and shuffle

Status: implemented

English | [中文](2026-09-14-race-stress-job.zh.md)

## Problem

Scheduling, lifecycle, and teardown races in the core loop, session, ACP, subagent, and subprocess suites are easy to introduce and hard to catch in a single deterministic run. A test that only fails when files or tests run in a particular order looks green on CI and then flakes randomly in later work.

## Decision

Add a dedicated nightly GitHub Actions job that runs a focused subset of the suite many times in random order. A failure in this job is treated as a race bug to fix, not as noise to retry away.

## Scope

The job focuses on the six directories where scheduling, lifecycle, and teardown races are most likely:

- `packages/core/agent-loop/tests/**/*.spec.ts`
- `packages/core/session/tests/**/*.spec.ts`
- `packages/acp/acp/tests/**/*.spec.ts`
- `packages/subagent/subagent-acp/tests/**/*.spec.ts`
- `packages/subprocess/subprocess-local/tests/**/*.spec.ts`
- `packages/subprocess/subprocess/tests/**/*.spec.ts`

Client jsdom suites are excluded: the 227-file cost outweighs the race value for this first pass.

## Mechanism

Files:

- `vitest.race-stress.config.ts` — dedicated Vitest config with `pool: 'forks'`, `sequence.shuffle: true`, `retry: 0`, and coverage disabled.
- `scripts/vitest-race-stress-runner.ts` — custom runner that injects `repeats` into every collected test before it runs.
- `.github/workflows/race-stress.yml` — nightly workflow triggered by cron at 02:00 UTC and by `workflow_dispatch`.
- `package.json` — `test:race-stress` script.

Vitest 4 exposes `repeats` only as a per-test option, not as a global config or CLI flag. The custom runner reads `DSH_RACE_STRESS_REPEATS` (default 10) from the environment and sets it on each test that does not already declare its own repeats, so individual specs can still opt out.

`sequence.shuffle: true` randomizes both file and test order. `retry: 0` keeps the job honest: a flake is a bug. Coverage is disabled because repeats would distort the per-file coverage gate and the purpose is finding flakes, not measuring coverage.

## Trigger and consumption

- Trigger: nightly cron (`0 2 * * *`) plus manual `workflow_dispatch`.
- Failure consumption: investigate and fix the underlying race; do not add retry or rerun to make the job green.

## Verification

A temporary negative-control spec with two tests that share mutable state failed under the race-stress config, confirming that shuffle and repeats surface ordering dependencies. After removing the control, the full job passed locally:

```
Test Files  61 passed | 3 skipped (64)
     Tests  1408 passed | 13 skipped (1421)
  Duration  182.53s
```

## Alternatives considered

**Add a `--repeat` CLI flag to Vitest or patch it.** Rejected: maintaining a fork or patch of Vitest for one job is far more expensive than a ~30-line custom runner that uses the public `TestRunner` extension point.

**Run the whole suite with repeats.** Rejected: the full suite includes 227 client jsdom files that are slow to start and not the highest-value race surface; the focused subset keeps the nightly job fast enough to finish and be actionable.

**Use Vitest's built-in retry instead of `retry: 0`.** Rejected: retries would hide the flakes this job is meant to catch. A failure here must be triaged as a bug.

## Consequences

- Nightly signal: the repository gains a daily, high-volume check for ordering and scheduling races in the most sensitive areas.
- Cost: ~3 minutes of runner time per night for the focused suite at 10 repeats; scaling repeats or scope increases this linearly.
- Failure handling: a red race-stress job requires a fix; suppressing it with retries or reruns is not allowed.
- The custom runner is an extension of Vitest's public runner API; if Vitest changes the API shape, the runner must be updated together with the Vitest version bump.

## Related

- Issue #121 — the tracking item that requested this mechanism.
- `.agents/notes/proposed/testing/2026-06-11-deterministic-and-stress-testing.md` — the broader proposal; its nightly-race-stress item (proposal 3) is now implemented.
