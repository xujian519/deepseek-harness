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
