# patent-oas Example Benchmark

English | [中文](README.zh.md)

A patent-practice example benchmark for `@deepseek-ai/dsh-self-evolve-benchmark`, benchmark id `patent-oas`. Each case keeps the public `statement` (the task a target agent sees) physically separate from the private `rubric` (the scoring standard), honoring the engine's statement/rubric isolation (C2): executor, optimizer, and applier roles see only the statement; only the evaluator receives the rubric.

## Cases

| case | task | scored dimensions |
|---|---|---|
| `oa-answer` | Office-action response: search → distinguishing features → actual technical problem → technical teaching → conclusion → claim amendment (six steps) | distinguishing features, technical problem, teaching, conclusion and statute, search and format, amendment grounding |
| `claim-drafting` | Disclosure → claims: independent claim + dependent claims + reference relationships | essential features, scope, dependent layout, reference hierarchy, form and support |
| `infringement-comparison` | Infringement comparison: all-elements + doctrine of equivalents, per-feature comparison + risk rating | comparison completeness, equivalents, conclusion clarity, risk rating, legal basis |
| `novelty-creative` | Novelty/inventiveness analysis: A22.2 separate comparison + A22.3 three-step | separate comparison, distinguishing features, technical problem, teaching, conclusion and statute |

Each case directory holds exactly `statement` and `rubric`; a multi-round case adds one `rounds/02/statement` file:

```
cases/<case-id>/
├── statement             # 公开的第 1 轮任务文本 —— 目标 agent 唯一可见的输入
├── rubric                # 私密评分标准 —— 与 statement 物理隔离
└── rounds/02/statement   # 可选:第 2 轮脚本化审查意见
```

Multi-round cases are fixed at two rounds: the executor answers, receives the scripted review opinion as new public input, and revises the previous deliverable, which the runner hands it as `previous-deliverable.md`. The same rubric scores both rounds; the gate judges the final round only. Keeping the review opinion in the case makes the second turn reproducible instead of introducing a second, varying reviewer model.

`patent-state/guidance.md` is the initial agent-state seed: a model-visible patent work specification (checklist) that executors follow and the optimize loop edits. It holds only general working method, never any case answer, and does not break rubric isolation.

## Problem-space DAG and regression gate

`problem-space.yaml` models the patent-practice problem space this gold standard covers as a directed acyclic graph: nodes are the facets a deliverable is judged on, `dependsOn` edges carry the prerequisite structure (search precedes distinguishing features, distinguishing features precede the actual technical problem, per-feature comparison precedes equivalents), and each rubric dimension is split by its own points onto the nodes it observes. `gate.yaml` pins the gold-standard digest and the score thresholds.

`pnpm run verify-patent-oas-gold` (CI, no key) checks that the gold standard and the DAG stay mutually pinned — every rubric dimension mapped, mapping weights equal to the rubric's own points, every node observable, no cycle in the prerequisite edges — that the recorded gold digest matches, and that a recorded baseline can satisfy its own thresholds. `--run <record.json>` judges one recorded run against the thresholds and attributes failures to problem-space nodes, printing per-case and per-node range and sample standard deviation when the record keeps per-run scores; `--accept <record.json>` promotes a validated run record to the baseline, requiring every case to carry `retrieval` so a legacy record cannot silently reset the baseline to an unlabelled setting; `--write` re-records the gold digest after a deliberate gold edit.

A run record is the contract between measurement and the threshold: it stores only the raw per-dimension observations, and the gate derives case and node scores from the DAG so no second copy of either can drift. Its fields are `{ benchmarkId, recordedAt, provider?, modelId?, runsPerCase, cost?, tokens?: { input, output }, cases: [{ caseId, retrieval, dimensions: [{ index, label, points, score, scores? }], rounds?: [{ round, statementDigest?, dimensions: [{ index, score, scores? }], deliverableDigests }] }] }`. `retrieval` is the case's retrieval setting: `oracle` puts the comparison documents in the statement (`oa-answer`, `novelty-creative`), `none` means the case needs no prior-art retrieval (`claim-drafting`, `infringement-comparison`), and `simulation` reserves a controlled-corpus run. The gate rejects a comparison whose per-case setting differs from the baseline's, because a search-quality score and an oracle-answer score cannot share thresholds; a record without the field compares only with a baseline that also lacks it. The runner still writes a capture whose setting differs from the baseline's, but skips the verdict and exits non-zero; no simulation corpus is recorded yet, so a `simulation` run has no baseline to compare against. With `runsPerCase > 1`, `scores` keeps one raw score per run so a reader can recompute variance and intervals instead of trusting a lone mean; `tokens` and `cost` sum every call in the capture (`tokens.input` is billed input, with cache reads and writes folded in), with `cost` taken from the provider when every call reports it and otherwise converted from the tokens at the caller's per-million prices; a capture where only some calls report usage omits the total instead of recording a partial one. The single input price covers all billed input, cached tokens included; a caller that prices cache separately reports cost from the seam instead. For a multi-round case, `dimensions` is the final round while `rounds` keeps every round's per-dimension observation, the digest of the scripted review opinion that opened it (`statementDigest`; round 1 has none), and each run's deliverable digest for that round. The gate still judges the final round and prints the per-round totals, so whether a revision improved or regressed is visible without changing the decision rule. The baseline lives at `packages/self-evolve/evaluation/patent-oas-baseline.json`. While that file is absent the gate exits non-zero and prints the command that records one, so an absent regression layer and a passing one never share an exit code; the fork's required CI lane runs the gate, which is what carries that exit code to a pull request.

`pnpm run gate:patent-oas` captures a measurement. `--dry-run` prints the plan (cases, rounds, runs, total agent calls) without any model call; a real run needs `DEEPSEEK_API_KEY` (or a `.env` declaring it) and skips with exit 0 without one. It starts one `dsh --profile` process per call — one executor per case round, working in a private copy of the agent state and writing its deliverable to `deliverable.md`, and one evaluator per rubric dimension in each round, writing a `{"score": n}` JSON object to `score.json` — then writes the run record, keeps every artifact and agent log under `.artifacts/patent-oas/<stamp>/`, and judges the run against the thresholds. A multi-round case's second round runs under `run-N/round-2/`: the runner copies the first round's agent state, keeps its deliverable as `previous-deliverable.md`, and removes the old `deliverable.md` and `agent.log`, so the executor must write a new deliverable and the logs stay per-round. Under the `headless` profile every call also runs with `--json`, so the runner reads the `step_end` usage events and sums the capture's tokens. `--case <id>` and `--runs <n>` narrow and repeat a run; `--timeout-ms` caps one call and `--budget-ms` the whole capture; `--input-usd-per-mtok` and `--output-usd-per-mtok` supply token prices when the provider reports usage but no cost; the repository keeps no price table, because prices vary by contract and a checked-in number would silently age. the baseline is promoted by the gate, not by the runner.

A captured score measures the model plus the work specification under the profile the caller passed (default `headless`), not the patent preset's tools and persona, so records are comparable with each other only under the same profile — which is what the `provider` and `modelId` fields are for.

The checked-in baseline is one keyed measurement recorded on 2026-10-24 under the `headless` profile with `--provider deepseek-official --model deepseek-flash`, three runs per case: the three single-round cases come from one capture, and `oa-answer` was re-captured after the second review opinion was made conditional on whether the first response amended the claims. The aggregate is 95.70 with cases at 95.5, 97.2, 98.1, and 92.0. Each case records its retrieval setting: `oa-answer` and `novelty-creative` are `oracle`, the other two are `none`. The record keeps `scores` for every dimension (one raw score per run), `provider`, `modelId`, and `tokens` — 26,128,857 input, cache reads and writes included, and 517,527 output across the 96 calls; `cost` stays absent because no per-million prices were passed. `oa-answer` is a two-round case: round 2 runs the executor after a scripted second review opinion, the final round scores 92.0 against 92.7 in round 1, and amendment-grounding reads 83.7 in round 1 and 83.3 in round 2. `technical-teaching` reads 92.2, and every node now uses the unified floor: the `novelty-creative` rubric scores the quality of the combination-motivation argument in either conclusion direction, and the second review opinion no longer asserts an amendment the first turn may not have made. The run follows the `--runs=3` set by the B7 measurement protocol. Everything except the model calls is covered keylessly as well: the capture seam is injectable, and the specs drive the whole pipeline with a stub that writes the two artifacts, covering the prompts, the artifact contract, the dimension-wise aggregation, the two-round handoff, the launcher arguments, and the record's acceptance by the gate.

## Seeding

```sh
node seed.mjs [baseDir]
```

`baseDir` defaults to `~/.dsh/self-evolve-benchmark`, aligned with the engine's default `baseDir` (`$DSH_HOME` overrides `~/.dsh`). The script is idempotent: re-running overwrites case files in place.

Seeded layout:

```
<baseDir>/benchmarks/patent-oas/
├── benchmark_config.yaml
├── oa-answer/statement|rubric
├── claim-drafting/statement|rubric
├── infringement-comparison/statement|rubric
└── novelty-creative/statement|rubric
<baseDir>/patent-state/
└── guidance.md   # 初始 agent state 种子
```

## Usage

After seeding, drive the loop through the engine's public methods. Point the engine's `baseDir` at the same data root and `agentStateDir` at the seeded `patent-state` work copy:

```ts
await engine.establishBaseline('patent-oas', { runsPerCase: 1 })
await engine.optimizeLoop('patent-oas', {
  maxRounds: 3,
  targetScore: 80,
  runsPerCase: 1,
})
```

`agentStateDir` defaults to the `patent-state` work copy (see the patent preset assembly); **never** use a real docket directory as `agentStateDir` — that would snapshot real work product in full and let the optimize loop rewrite it in place.
