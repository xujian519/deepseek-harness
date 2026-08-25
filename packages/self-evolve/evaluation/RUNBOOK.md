# Self-Evolve P1.10 Evaluation Runbook

English | [中文](RUNBOOK.zh.md)

Run the 60-task offline paired baseline-vs-self-evolve evaluation, record the continue/rollback decision, and arm the CI stop switch.

## Honest status

- **What it measures**: a paired net-win signal over a deterministic SWE-bench_Verified subset — baseline harness vs. the same harness with the `self-evolve-app` bundle mounted (per-task `uv` venv, local `pytest` FAIL_TO_PASS verdict, **P-B light path, no Docker**).
- **What it is not**: this is **local-reproduction** verdicts, not official SWE-bench scoring. Report the result as a local-reproduction net-win signal, and cross-check any do-or-die conclusion against a Docker/cloud run (path P-C).
- **The gate feels only the decision record**: `verify-self-evolve-eval` fails when `packages/self-evolve/evaluation/eval-decision.json` records `rollback`. The scaffold never fabricates results; it fails honest when the data is missing.

## 0. Preflight — environment self-check

Run from the repository root. All commands below assume this directory.

```sh
# Toolchain
node -v                                  # ^22.19 || >=24
pnpm  -v                                  # any recent
git   --version
uv    --version                           # if using --env-tool uv (default); else python3 -m venv path

# Agent key
test -f .env || echo "WARN: no root .env — export DEEPSEEK_API_KEY (and optional DEEPSEEK_BASE_URL)"

# Dataset export deps (only needed in step 1)
python -c "import datasets; print(datasets.__version__)" || echo "WARN: install 'pip install datasets'"

# Scaffold self-check (the eval unit suite must be green)
pnpm exec vitest run packages/test-support/self-evolve-eval
#   Expect: Test Files 9 passed (9), Tests 111 passed (111)
```

> If `pnpm`/`node` are not found, prepend the nvm/homebrew bin dir, e.g. `export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:/opt/homebrew/bin:$PATH"`.

## 1. Export the task manifest (networked, one-time)

```sh
python -c "from datasets import load_dataset; \
  load_dataset('princeton-nlp/SWE-bench_Verified').to_json('swebench-verified.jsonl')"
sha256sum swebench-verified.jsonl        # record this + the HF revision into REPORT.md
```

## 2. Select the deterministic 60-task subset

```sh
pnpm eval:self-evolve subset \
  --manifest swebench-verified.jsonl \
  --seed 20260821 \
  --out packages/self-evolve/evaluation/subset.json
```

Pass criteria: exactly 60 items; re-running produces a byte-identical `subset.json` (determinism); every row carries `instanceId/repo/baseCommit/failToPass/passToPass` with a non-empty `failToPass`.

## 3. Smoke pilot — 5 tasks, both arms

Print the plan first (does not read the manifest):

```sh
pnpm eval:self-evolve campaign \
  --manifest swebench-verified.jsonl \
  --subset packages/self-evolve/evaluation/subset.json \
  --results packages/self-evolve/evaluation/results.json \
  --stats  packages/self-evolve/evaluation/campaign-stats.jsonl \
  --work-dir /tmp/self-evolve-campaign \
  --arm both --env-tool uv --task-limit 2 --dry-run
```

Then actually run the pilot:

```sh
pnpm eval:self-evolve campaign \
  --manifest swebench-verified.jsonl \
  --subset packages/self-evolve/evaluation/subset.json \
  --results packages/self-evolve/evaluation/results.json \
  --stats  packages/self-evolve/evaluation/campaign-stats.jsonl \
  --work-dir /tmp/self-evolve-campaign \
  --arm both --env-tool uv --task-limit 5 --concurrency 2
```

Pass criteria: 5/5 tasks produce a `baselinePassed`/`evolvedPassed` verdict; manually inspect one collected patch and its local `pytest` verdict for correctness.

## 4. Full 60×2 campaign (resumable)

```sh
pnpm eval:self-evolve campaign \
  --manifest swebench-verified.jsonl \
  --subset packages/self-evolve/evaluation/subset.json \
  --results packages/self-evolve/evaluation/results.json \
  --stats  packages/self-evolve/evaluation/campaign-stats.jsonl \
  --work-dir /tmp/self-evolve-campaign \
  --arm both --env-tool uv --concurrency 4
```

- After an abort, resume with `--skip-existing`.
- Defaults: `--dsh-entry apps/cli/src/bin.ts`, `--tsx-import tsx/esm`, `--build-command '{python} -m compileall -q .'`, `--python 3.11`, `--agent-timeout 1800000`, `--verify-timeout 1800000`.
- The other timeouts: `--setup-timeout 300000`, `--install-timeout 600000`.
- **The `{python}` placeholder is replaced by the per-task venv python**, so `--build-command` controls the evolved arm's held-in workspace verifier. Use a real project health command (e.g. `{python} -m compileall -q <src>` or the repo's own test-collection command) — a no-op compiler command leaves the verifier's build dimension nearly uninformative.

Pass criteria: `results.json` has exactly 60 task rows matching `subset.json`, a per-arm pair for each, and **0 infra error rows** (a `--skip-existing` merge must not leave verdict-less rows).

## 5. Score, decide, and check the gate

```sh
pnpm eval:self-evolve score  --results packages/self-evolve/evaluation/results.json
pnpm eval:self-evolve decide --results packages/self-evolve/evaluation/results.json --write
pnpm run verify-self-evolve-eval
```

Decision rule (spec P1-10): `continue` **only** when the bootstrap 95% CI low bound is strictly `> 0`; `rollback` when the CI crosses zero (randomness cannot be excluded) or lies at/below zero (harm evidence). `--write` persists `eval-decision.json` (default path), which is exactly what the gate reads.

## 6. Commit the artifacts

Commit into `packages/self-evolve/evaluation/`:

- `subset.json` — the deterministic task selection.
- `results.json` — paired per-task verdicts (add a top-level `meta` block: model name, per-arm config incl. `buildCommand`, run window, manifest sha256/HF revision).
- `campaign-stats.jsonl` — per-arm run stats.
- `eval-decision.json` — the continue/rollback record. **Must be committed for the gate to take effect in repo CI.**
- `REPORT.md` — per-task win/loss/tie table, cost/timing stats, environment and reproduction info; stated as **local-reproduction**, not official SWE-bench.

## Rollback meaning (if the record says `rollback`)

Per spec, roll back scope: keep the self-evolve bundle **off by default**, keep L1-skill only, do not proceed to P2/P3/P4. Record the decision, the rollback action, and the evidence in the same PR, and update `check_list.md`/`tasks.md`/`spec.md` accordingly. A rollback is the spec's falsification-first design working — not an evaluation failure.

## Caveats

- **install-vs-arm workspace**: the dataset `install` runs once into the shared venv from the base checkout; the arm checkouts are independent clones, so an editable-package install may resolve from the base checkout rather than the arm's prediction. This is a known local-reproduction caveat and the reason verdicts are reported as such.
- **Verdict non-retry**: the runner retries an agent process **crash** once (infra), never a settled verdict. Re-do a task only by re-running that task's arms deliberately.