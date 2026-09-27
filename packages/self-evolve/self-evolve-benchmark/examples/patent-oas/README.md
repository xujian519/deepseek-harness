# patent-oas Example Benchmark

English | [中文](README.zh.md)

A patent-practice example benchmark for `@deepseek-ai/dsh-self-evolve-benchmark`, benchmark id `patent-oas`. Each case keeps the public `statement` (the task a target agent sees) physically separate from the private `rubric` (the scoring standard), honoring the engine's statement/rubric isolation (C2): executor, optimizer, and applier roles see only the statement; only the evaluator receives the rubric.

## Cases

| case | task | scored dimensions |
|---|---|---|
| `oa-answer` | Office-action response: search → distinguishing features → actual technical problem → technical teaching → conclusion (five steps) | distinguishing features, technical problem, teaching, conclusion and statute, search and format |
| `claim-drafting` | Disclosure → claims: independent claim + dependent claims + reference relationships | essential features, scope, dependent layout, reference hierarchy, form and support |
| `infringement-comparison` | Infringement comparison: all-elements + doctrine of equivalents, per-feature comparison + risk rating | comparison completeness, equivalents, conclusion clarity, risk rating, legal basis |
| `novelty-creative` | Novelty/inventiveness analysis: A22.2 separate comparison + A22.3 three-step | separate comparison, distinguishing features, technical problem, teaching, conclusion and statute |

Each case directory holds exactly two files:

```
cases/<case-id>/
├── statement   # 公开任务文本 —— 目标 agent 唯一可见的输入
└── rubric      # 私密评分标准 —— 与 statement 物理隔离
```

`patent-state/guidance.md` is the initial agent-state seed: a model-visible patent work specification (checklist) that executors follow and the optimize loop edits. It holds only general working method, never any case answer, and does not break rubric isolation.

## Problem-space DAG and regression gate

`problem-space.yaml` models the patent-practice problem space this gold standard covers as a directed acyclic graph: nodes are the facets a deliverable is judged on, `dependsOn` edges carry the prerequisite structure (search precedes distinguishing features, distinguishing features precede the actual technical problem, per-feature comparison precedes equivalents), and each rubric dimension is split by its own points onto the nodes it observes. `gate.yaml` pins the gold-standard digest and the score thresholds.

`pnpm run verify-patent-oas-gold` (CI, no key) checks that the gold standard and the DAG stay mutually pinned — every rubric dimension mapped, mapping weights equal to the rubric's own points, every node observable, no cycle in the prerequisite edges — that the recorded gold digest matches, and that a recorded baseline can satisfy its own thresholds. `--run <record.json>` judges one recorded run against the thresholds and attributes failures to problem-space nodes; `--accept <record.json>` promotes a validated run record to the baseline; `--write` re-records the gold digest after a deliberate gold edit.

A run record is the contract between measurement and the threshold: it stores only the raw per-dimension observations, and the gate derives case and node scores from the DAG so no second copy of either can drift. Its fields are `{ benchmarkId, recordedAt, provider?, modelId?, runsPerCase, cases: [{ caseId, dimensions: [{ index, label, points, score }] }] }`. The baseline lives at `packages/self-evolve/evaluation/patent-oas-baseline.json`; while that file is absent the gate reports the regression layer dormant and exits 0 rather than passing silently.

`pnpm run gate:patent-oas` captures a measurement. `--dry-run` prints the plan (cases, runs, total agent calls) without any model call; a real run needs `DEEPSEEK_API_KEY` (or a `.env` declaring it) and skips with exit 0 without one. It starts one `dsh --profile` process per call — one executor per case, working in a private copy of the agent state and writing its deliverable to `deliverable.md`, and one evaluator per rubric dimension, writing a `{"score": n}` JSON object to `score.json` — then writes the run record, keeps every artifact and agent log under `.artifacts/patent-oas/<stamp>/`, and judges the run against the thresholds. `--case <id>` and `--runs <n>` narrow and repeat a run; `--timeout-ms` caps one call and `--budget-ms` the whole capture; the baseline is promoted by the gate, not by the runner.

A captured score measures the model plus the work specification under the profile the caller passed (default `headless`), not the patent preset's tools and persona, so records are comparable with each other only under the same profile — which is what the `provider` and `modelId` fields are for.

No keyed run has been executed in this repository, so what is proven is everything but the model: the capture seam is injectable, and the specs drive the whole pipeline with a stub that writes the two artifacts. The prompts, the artifact contract, the dimension-wise aggregation, the launcher arguments, and the record's acceptance by the gate are covered; a real model writing the artifacts is not.

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
