# Agent Note: Self-evolve P1-10 campaign runner uses a local venv path (no Docker)

Status: implemented

English | [中文](2026-08-22-self-evolve-p1-10-campaign-runner.zh.md)

## Problem

P1-10 needs a paired offline campaign over 60 SWE-bench_Verified tasks: baseline vs self-evolve arm, per-task FAIL_TO_PASS/PASS_TO_PASS verdicts. The eval scaffold (`@deepseek-ai/dsh-self-evolve-eval`) deliberately does not run agents, and the official SWE-bench protocol needs a per-instance docker image (`swebench/swebench_verified:<instance>`) — 10–25 GB of images for a 60-task subset, which the local campaign budget cannot host. The missing piece is an orchestrator that prepares each task environment, runs both arms through `dsh --profile headless`, collects the agent's patch, settles the verdict, and merges paired rows into `results.json`. The [scaffold note](../feature/2026-08-21-self-evolve-p110-eval-scaffold.md) deferred exactly this runner to a keyed follow-up and rejected the in-package docker path; this note supersedes that rejection for the local path while keeping the docker path out of this package.

## Decision

Implement the campaign runner as a `campaign` CLI subcommand of the existing scaffold, using the **local light-weight path (P-B)** instead of docker:

- Per task: clone the repo at `base_commit`, apply `test_patch` to two independent arm checkouts, provision one shared venv (`uv venv --seed`, `--env-tool venv` fallback), run the dataset `install` command into it, then run one agent per arm (`node --import tsx/esm apps/cli/src/bin.ts --profile headless [--patch <generated overlay>] "<problem_statement>"`). The evolved overlay mirrors `packages/bundle/self-evolve-app/cordis.patch.yml` plus a per-task `workspaceVerifier.buildCommand` (default `{python} -m compileall -q .`) — without it the held-in verifier degrades to the weak path and the evolved arm never commits.
- Prediction = staged diff excluding `.dsh/` and every file the test patch owns (test-file edits never reach the verdict).
- Verdict = `python -m pytest <FAIL_TO_PASS> <PASS_TO_PASS>` in the task venv inside a pristine reset (base commit + test patch + prediction re-applied).
- Semantics: a dsh process crash (non-zero exit) is retried once — infra, not evidence; a verdict failure is final. Environment/manifest failures become retryable error rows without a boolean, which `validateResults` rejects at scoring, so an incomplete campaign never scores silently. Rows persist after every arm, so `--skip-existing` resumes a killed run.

## Alternatives considered

**Official docker protocol (path P-C)** — the official per-instance image verdict; kept as the cross-check/formal evidence route because the local venv verdicts can differ from the official image (dependency and system drift). The paired design limits that drift's effect on the net-win delta: both arms share one environment.

**Containerized dsh** — running dsh inside the SWE-bench image (bundle node/dsh/key in) is slow and heavy; rejected.

**Harness-internal smoke only (path P-A)** — using the held-in signals as "passed" verdicts exercises the plugin but cannot serve as P1-10 evidence; not adopted.

## Consequences

- The runner needs no Docker: peak disk ≈ 5–10 GB for the local path, with a per-task venv created from the global `uv` cache; a 60-task campaign fits a single keyed host.
- Verdicts are reported as "local-reproduction", not official SWE-bench; a report must state this, and the optional official cross-check remains part of path P-C.
- The scaffold's honest status stays: no real 60-task campaign has been run in this repository; the `campaign` runner's dry-run, git-pathspec exclusion, and pure logic are unit/smoke-tested.
