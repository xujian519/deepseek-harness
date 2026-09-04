---
description: "The **P1-10 evaluation scaffold** for the self-evolve capability: deterministic 60-task subset selection, paired baseline/self-evolve result collection, net-win scoring, a percentiled-bootstrap 95% confidence interval, and the recorded continue/rollback decision that arms the CI stop switch."
kind: "package-reference"
---

# @deepseek-ai/dsh-self-evolve-eval

English | [中文](README.zh.md)

## Summary

The **P1-10 evaluation scaffold** for the self-evolve capability: deterministic 60-task subset selection, paired baseline/self-evolve result collection, net-win scoring, a percentiled-bootstrap 95% confidence interval, and the recorded continue/rollback decision that arms the CI stop switch.

This is dev/test infrastructure, not a runtime plugin: it owns no service and no model-visible surface. The campaign runner takes the light-weight local path (per-task venv, local pytest verdict — no Docker); the official per-instance container verdict stays as a cross-check. The scaffold covers everything around the campaign and fails honest when the data is not there.

No runtime invariant companion is published; this evaluation scaffold owns no production event stream or mutable data — it only consumes campaign result files authored by keyed external runs.


## Table of Contents

- [Usage](#usage)
- [Result schema](#result-schema)
- [Environment requirements](#environment-requirements)
- [Honest status](#honest-status)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Usage

Run from the repository root. All artifacts default to `packages/self-evolve/evaluation/`.

```sh
# 1. Select the deterministic 60-task subset from a SWE-bench manifest.
#    Export the dataset first (networked environment):
#      python -c "from datasets import load_dataset; load_dataset('princeton-nlp/SWE-bench_Verified').to_json('swebench-verified.jsonl')"
pnpm eval:self-evolve subset --manifest swebench-verified.jsonl --seed 20260821 --out packages/self-evolve/evaluation/subset.json

# 2. Run the paired campaign over the subset (light-weight local path, P-B).
#    No Docker: one shared venv per task plus a local pytest verdict. Run from the repo root.
pnpm eval:self-evolve campaign \
  --manifest swebench-verified.jsonl \
  --subset packages/self-evolve/evaluation/subset.json \
  --results packages/self-evolve/evaluation/results.json \
  --stats packages/self-evolve/evaluation/campaign-stats.jsonl \
  --work-dir /tmp/self-evolve-campaign
#    Add `--dry-run` to print the plan; `--arm evolved|baseline` for a single arm;
#    `--skip-existing` resumes a killed run; `--keep-work` keeps per-task checkouts.
#    Collect one paired result row per task into results.json — see the schema below.

# 3. Score and record the decision:
pnpm eval:self-evolve score  --results packages/self-evolve/evaluation/results.json
pnpm eval:self-evolve decide --results packages/self-evolve/evaluation/results.json --write
```

**Constraint — install vs arm workspaces**: the dataset `install` command runs once into the shared venv from the base checkout; the two arm checkouts are independent clones made before that step, and the verdict runs in an arm after a pristine reset. For tasks whose `install` is an editable package install, the package under test may resolve from the base checkout instead of the arm's prediction — a known local-reproduction caveat, and the reason verdicts are reported as such.

`decide --write` persists `eval-decision.json`; `pnpm run verify-self-evolve-eval` (a CI gate) fails when the recorded recommendation is `rollback` — the "CI 跨零自动停开关".

## Result schema

`results.json` is the paired campaign report:

```json
{
  "seed": 20260821,
  "subsetSize": 60,
  "generatedAt": 1755780000000,
  "tasks": [
    { "taskId": "django__django-12345", "baselinePassed": false, "evolvedPassed": true }
  ]
}
```

A task resolved by the self-evolve run but not by baseline is a **win**; the reverse is a **loss**; `netWin = wins − losses`. The primary statistic is the paired rate delta (`evolvedPassed − baselinePassed` over N); its 95% confidence interval is a seedable percentile bootstrap over resampled task differences (10,000 resamples). The decision rule (spec P1-10 rollback condition): `continue` only when the interval lies strictly above zero; `rollback` when it crosses zero (randomness cannot be excluded) or lies at or below zero (harm evidence).

## Environment requirements

- **Manifest export**: Hugging Face (`princeton-nlp/SWE-bench_Verified`) + the `datasets` package; the scaffold itself takes the exported JSONL/JSON.
- **Campaign run (local, P-B)**: `git`, `uv` (or `python3 -m venv` via `--env-tool venv`), and `DEEPSEEK_API_KEY` for the agent arms; no Docker. Each task provisions one shared venv and runs the dataset `install` command into it; the verdict is a local `python -m pytest` in the arm checkout and is reported as **local-reproduction, not official SWE-bench**. The scaffold does not run agents by itself; the collected `results.json` is the contract.
- **Campaign run (official cross-check, P-C)**: `DEEPSEEK_API_KEY` and a docker-capable host (the SWE-bench per-instance protocol). The official verdict can differ from the local one (dependency/system drift) and remains the formal evidence route.
- **Reproducibility**: keep the subset seed and the manifest pinned in the campaign record; the bootstrap seed only needs to be stable for the decision record.

## Honest status

The scaffold is landed and unit-tested (subset determinism, scoring, interval, decision I/O). The `campaign` runner's dry-run plan, git-pathspec prediction exclusion, and merge/verdict pure logic are unit-tested; its subprocess path (git/venv/pytest) is exercised against temp repos with a stubbed verdict. A keyed e2e (`pnpm run test:e2e`, requiring `DEEPSEEK_API_KEY` and the exported manifest at `SELF_EVOLVE_E2E_MANIFEST`) is wired to drive one real task through the pipeline but self-skips without them. **No real SWE-bench task has been run in this repository** — the keyed agent plus a per-task environment is required and the recorded decision file does not exist yet, so the CI stop switch is dormant.
## Known Limitations and Deferred Work

- **Local reproduction, not official SWE-bench** — the P-B verdict is a local `python -m pytest` in the arm checkout; dependency and system drift can make it differ from the official per-instance verdict, which remains the formal evidence route.
- **Install-vs-arm workspace caveat** — the dataset `install` command runs once into the shared venv from the base checkout, so for editable-package installs the package under test may resolve from the base checkout instead of the arm's prediction; verdicts are reported with that caveat.
- **The keyed path has never run here** — no real SWE-bench task has been executed in this repository. The recorded `eval-decision.json` does not exist yet, so the CI stop switch is dormant.

### Dev Note

None.
