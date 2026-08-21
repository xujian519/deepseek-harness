# @deepseek-ai/dsh-self-evolve-eval

English | [中文](README.zh.md)

The **P1-10 evaluation scaffold** for the self-evolve capability: deterministic 60-task subset selection, paired baseline/self-evolve result collection, net-win scoring, a percentiled-bootstrap 95% confidence interval, and the recorded continue/rollback decision that arms the CI stop switch.

This is dev/test infrastructure, not a runtime plugin: it owns no service and no model-visible surface. The real campaign — per-task docker images, agent runs, and FAIL_TO_PASS validation — requires a keyed environment; the scaffold covers everything around it and fails honest when the data is not there.

## Usage

Run from the repository root. All artifacts default to `packages/self-evolve/evaluation/`.

```sh
# 1. Select the deterministic 60-task subset from a SWE-bench manifest.
#    Export the dataset first (networked environment):
#      python -c "from datasets import load_dataset; load_dataset('princeton-nlp/SWE-bench_Verified').to_json('swebench-verified.jsonl')"
pnpm eval:self-evolve subset --manifest swebench-verified.jsonl --seed 20260821 --out packages/self-evolve/evaluation/subset.json

# 2. Run baseline and self-evolve campaigns over the subset (keyed + docker).
#    Collect one paired result row per task into results.json — see the schema below.

# 3. Score and record the decision:
pnpm eval:self-evolve score  --results packages/self-evolve/evaluation/results.json
pnpm eval:self-evolve decide --results packages/self-evolve/evaluation/results.json --write
```

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
- **Campaign run**: `DEEPSEEK_API_KEY` and a docker-capable host (the SWE-bench evaluation protocol per instance). The scaffold does not run agents by itself; the collected `results.json` is the contract.
- **Reproducibility**: keep the subset seed and the manifest pinned in the campaign record; the bootstrap seed only needs to be stable for the decision record.

## Honest status

The scaffold is landed and unit-tested (subset determinism, scoring, interval, decision I/O). **No real 60-task campaign has been run in this repository** — the keyed/docker environment is required and the recorded decision file does not exist yet, so the CI stop switch is dormant.
