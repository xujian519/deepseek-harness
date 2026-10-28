# Agent Note: A kill reports the settled job

Status: implemented

English | [中文](2026-10-28-job-kill-waits-for-settlement.zh.md)

## Problem

`job_kill` returned as soon as cancellation was requested. The producer settles asynchronously — `jobs-local` appends `job/settled` only when the work actually stops — so the result described a `stopping` job and the model had to poll `job_output` to learn whether the slot was free. That is the very sequence the admission error asks for: “use job_kill to stop an unneeded job, wait for it to finish, then retry”.

The session log inherited the same gap. Where the settlement lands relative to the next step depended on how fast the killed process exited, and a following foreground command could be refused admission while the slot was still `stopping`; `tool-bash` then runs it without a job registration. The `background-job-admission` scenario recorded the fast interleaving, passed locally, and failed on a loaded CI runner ([run 40653383460](https://github.com/xujian519/deepseek-harness/actions/runs/40653383460): 1 failed / 228 passed) with the settlement one step late and two job records missing.

## Decision

`job_kill` waits for the settlement before it returns, bounded by a new `killTimeoutMs` (default 30s, capped by `maxWaitTimeoutMs`):

- the job is terminal → `job <id> [status: killed, <detail>]`;
- the bound expires first → `requested cancellation of job <id>; [status: stopping]`;
- the job had already finished → unchanged `had already finished` result.

The output schema keeps its `cancellation-requested | already-finished` outcome; the terminal truth is the `job` snapshot the result already carries. `jobs-local.settle()` appends `job/settled` before it resolves waiters, so a returned wait guarantees the event precedes the tool result — the ordering no longer depends on process-exit timing.

The model's own kill still suppresses its completion notice through the existing `killedByModel` set. A settlement that releases the wait is `awaited` regardless, and a kill that times out leaves the later settlement suppressed exactly as before, so no extra notice reaches a step.

The tool description, parameters, and output schema are unchanged. The wait is documented in the package README, the `Config` JSDoc, and the rendered result; the description “Request cancellation of a running background job” stays true, and changing it would rewrite the committed tool-schema sidecar in 88 snapshot scenarios for wording alone.

## Alternatives considered

**Normalize concurrent job lifecycle ordering in the snapshot harness.** Cheaper than a product change, but it would hide real ordering regressions between steps and every other session event; this repository fixes fixtures, not normalizers.

**Insert a `job_output(wait: true)` step after the kill in the fixture.** Measured and rejected: the wait only guarantees the settlement before the *later* step, so its position relative to the next `step/start` stays racy. It cannot make the fixture deterministic.

**Drop the kill and let shutdown reclaim the job.** `bash-startup-timeout` shows an unsettled job produces no shutdown event, so the log would become deterministic — but the scenario would lose the only `job_kill` snapshot coverage and its slot-freeing assertion.

**Make the description say the call waits.** It would regenerate the committed tool-schema sidecar in every scenario that mounts `tool-jobs`, for a wording change that does not alter the schema.

## Consequences

A kill normally returns as soon as the work stops; a producer that ignores cancellation holds the step for at most `killTimeoutMs`. The `background-job-admission` fixture records the settlement before the kill result, and the following foreground command is admitted deterministically. `job_output` waits are unchanged.

The rendered result is model-visible text, so its consumers moved with it: `tool-bash`, `tool-pwsh`, and `tool-terminal` assert the terminal line, and the Web `job_kill` detail card renders the settled status while still recognizing the `requested cancellation` text that earlier sessions recorded.

## Testing

`packages/jobs/tool-jobs/tests/tool-jobs.spec.ts` covers the settled kill, the bound expiring on a job that keeps `stopping`, a settlement that lands mid-wait, the already-finished path, notice suppression, and the output caps that apply to the new rendering. The consumer suites (`tool-bash`, `tool-pwsh`, `tool-terminal`) and the Web detail-card spec assert the settled result and the retained `requested cancellation` receipts.

`snapshots/session/background-job-admission` replays green over six consecutive local runs (three idle, three under an eight-process CPU load), and the full snapshot lane reports 227 passed / 2 platform skips. Package coverage stays at 100% (171/171 statements, 147/147 branches); `typecheck`, lint, and `test:docs` pass.

## Related

[`docs/testing.md`](../../../../docs/testing.md) owns the snapshot lane policy; the scenario's [cordis overlay](../../../../snapshots/session/background-job-admission/cordis.snapshot.yml) carries the one-slot admission configuration this decision exercises.
