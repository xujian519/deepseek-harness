# Agent Note: self-evolve P1-10 evaluation scaffold

Status: implemented

English | [中文](2026-08-21-self-evolve-p110-eval-scaffold.zh.md)

## Problem

The spec's P1-10 acceptance — a 60-task offline subset evaluation with a net-win 95% confidence interval and a CI-crossing-zero auto-stop switch — had no code: no subset selection, no paired result contract, no statistics, and no mechanical way for CI to enforce the rollback condition. The whole self-evolve premise (Cordis composability + Self-Harness three-stage loop delivering net positive gains) remained unmeasured, and the workspace verifier (P1.9b) made commit paths reachable without any evidence that they should stay on.

## Decision

Land the evaluation scaffold in a new test-support package `@deepseek-ai/dsh-self-evolve-eval` (dev/test infrastructure, no runtime plugin surface) plus one CI gate:

- **Subset** (`src/subset.ts`): `normalizeSwebenchInstances` maps dataset rows (`instance_id`/`repo`/`base_commit`/`FAIL_TO_PASS`/`PASS_TO_PASS`) into `EvalTask`s; `selectSubset` sorts by instance id, then seeded-Fisher-Yates (mulberry32) into a reproducible subset of `count` tasks (default 60). Input order never influences the result.
- **Results contract** (`src/types.ts` + `validateResults`): one `results.json` per campaign with a paired `TaskOutcome` per task (`baselinePassed`/`evolvedPassed`, optional per-side errors that count as not passed). Malformed reports fail loud instead of scoring as zeros.
- **Statistics** (`src/score.ts`): `summarize` (wins/losses/netWin, paired rate delta), seedable percentile bootstrap over resampled task differences (10,000 resamples default) for the 95% CI, and a `wilsonCi` reference statistic under the standard-normal quantile solver.
- **Decision + stop switch** (`src/decision.ts` + `scripts/verify-self-evolve-eval.ts`): `decide` records `continue` only when the interval lies strictly above zero; `rollback` when it crosses zero or lies at/below zero. The record lands at `packages/self-evolve/evaluation/eval-decision.json`; the gate fails CI on `rollback` and passes on absence (dormant until a campaign settles) or `continue`.
- **CLI** (`src/cli.ts`, `pnpm eval:self-evolve`): `subset`, `score`, `decide [--write]`; artifacts default to `packages/self-evolve/evaluation/`.
- The gate is registered in `ciSharedStaticGates` of `scripts/run-gates.ts`, so every CI mode carries the switch.

## Alternatives considered

**Download and commit a real 60-task subset now.** Rejected: the Hugging Face dataset is unreachable from the working environment, and committing fabricated instance ids would be a data lie. The exporter script path is documented instead; the subset command stays deterministic and reproducible from any real manifest.

**Implement the full campaign runner (docker per instance + agent solve + FAIL_TO_PASS validation) in the package.** Rejected: it needs a keyed, docker-capable host and outsized volume of unverifiable code; the honest boundary is the results contract plus a documented procedure. The runner belongs to a keyed follow-up, not to this scaffold.

**Use a Wilson interval as the primary statistic.** Rejected: the campaign is a matched pair (same task in both arms), so resampling paired differences is the correct distribution; Wilson is kept as a reference statistic for single-arm rates.

## Consequences

- `pnpm eval:self-evolve subset/score/decide` produce a deterministic subset, a paired summary, the bootstrap interval, and the decision record; `verify-self-evolve-eval` arms the CI stop switch with a "dormant until recorded" semantics.
- Unit tests cover subset determinism and normalization, summary math, interval reproducibility and degenerate cases, Wilson reference values, decision transitions, and record I/O.
- Honest status: the scaffold is landed; **no real 60-task campaign has been run** (keyed/docker environment required). The P1-10 checkbox stays open until results and a recorded decision exist.
- The spec.md/tasks.md track P1.10a as done and P1.10 as open; the previous note's "still deferred" list does not change here.
