---
description: "The **`BenchmarkEvolveEngine`** is the provider of `ctx.selfEvolveBenchmark`. It adds a quantitative target dimension to the self-evolve capability: a benchmark is a bounded set of cases, each scored against a private rubric, and the provider optimizes the agent state under a strict improve-or-rollback policy backed by whole-state snapshot versioning. This complements `ctx.selfEvolve`, which mines failure patterns from the session stream, with an objective score a loop can chase."
kind: "package-reference"
---

# @deepseek-ai/dsh-self-evolve-benchmark

English | [中文](README.zh.md)

## Summary

The **`BenchmarkEvolveEngine`** is the provider of `ctx.selfEvolveBenchmark`. It adds a quantitative target dimension to the self-evolve capability: a benchmark is a bounded set of cases, each scored against a private rubric, and the provider optimizes the agent state under a strict improve-or-rollback policy backed by whole-state snapshot versioning. This complements `ctx.selfEvolve`, which mines failure patterns from the session stream, with an objective score a loop can chase.

No runtime invariant companion is published; the provider's invariants live in its on-disk storage layout (statement/rubric separation, monotonic snapshot versions), not in an observable event sequence.


## Table of Contents

- [Role](#role)
- [Configuration](#configuration)
- [Public API](#public-api)
- [On-disk layout](#on-disk-layout)
- [Optimization loop (C1 + C3)](#optimization-loop-c1--c3)
- [Statement/rubric separation (C2)](#statementrubric-separation-c2)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Role

| Package | Role |
|---|---|
| `@deepseek-ai/dsh-self-evolve` | Service Definition: abstract `SelfEvolveEngine` + durable events |
| `@deepseek-ai/dsh-self-evolve-basic` | Service Provider: projection-driven idle-pressure evolution over failure patterns |
| `@deepseek-ai/dsh-self-evolve-benchmark` (this) | Service Provider: benchmark-driven target evolution with snapshot versioning |

## Configuration

`BenchmarkEvolveConfig` controls where benchmark data lives and the defaults the public methods fall back to:

| Field | Default | Semantics |
|---|---|---|
| `baseDir` | `~/.dsh/self-evolve-benchmark` | Data root for benchmark stores and snapshots (`$DSH_HOME` overrides `~/.dsh`). |
| `agentStateDir` | `process.cwd()` | Agent-state directory snapshotted before each candidate round and restored on rejection. |
| `runsPerCase` | `1` | Runs per case when a method does not specify one. |
| `maxRoundsPerLoop` | `1` | Default maximum candidate rounds per optimize loop. |
| `targetScore` | none | Default score goal for optimize loops; absent disables early acceptance. |

## Public API

All work routes through a `BenchmarkEngineCore` whose seams are injected; the real defaults run over the `fork` subagent provider.

| Method | Contract |
|---|---|
| `runBenchmark(benchmarkId, options)` | Evaluate every case × `runsPerCase` against the current agent state and persist the aggregated `ScoreboardEntry`. |
| `establishBaseline(benchmarkId, options)` | A single-run benchmark entry, the reference an optimize loop must strictly beat. |
| `optimizeLoop(benchmarkId, options)` | Optimize under strict improve-or-rollback; without a reference entry (explicit or latest scoreboard) it fails loud. |
| `readScoreboard(benchmarkId)` | All persisted entries for a benchmark, oldest first. |

## On-disk layout

```
<baseDir>/
├── benchmarks/<id>/
│   ├── benchmark_config.yaml   # { title }
│   ├── <caseId>/statement      # public task text — the only input a target agent sees
│   ├── <caseId>/rubric         # private scoring standard — a physically separate file
│   └── scoreboard.yaml         # versioned entry history
└── snapshots/v<version>.tar.gz # whole agent-state snapshot, excluding .vault.toml
```

## Optimization loop (C1 + C3)

Each round of `optimizeLoop` mints a fresh snapshot version (versions only increase and never recycle), packs the current agent state, proposes one candidate against the reference using only the public statement surface, applies it, evaluates the full matrix, and accepts the round only when the candidate score strictly beats the reference. A rejected candidate is rolled back to its snapshot; an accepted one becomes the new reference, and a configured `targetScore` stops the loop early.

## Statement/rubric separation (C2)

A case's `statement` is the only benchmark content a target or optimizing agent ever sees; the `rubric` is private and stored as a physically different file. The optimizer prompt states that the scoring standard is absent and instructs the child to stop and report contamination if it ever sees one, and `publicBenchmarkView`/`assertNoPrivateLeak` mechanically strip and guard the private vocabulary (`rubric`, `rubrics`, `gold`, `goldAnswer`, `expectedAnswer`) from optimizer-facing surfaces. The evaluator is the only role allowed to receive the rubric.

## Model Experience

### Default seam prompts

#### What the model sees

The provider registers no stable prompt section or tool schema; every model-visible contribution comes from the child requests its default seams fork. Each case run first forks one executor subagent told it is a task executor, handed the `statement` and the agent-state directory's guidance, and instructed to produce the deliverable text directly. The engine then forks one evaluator subagent told it is a benchmark evaluator and handed the `statement`, the deliverable, the private `rubric` (legitimate here, and only here), and an instruction to output exactly one JSON object with a numeric `score`. Each optimize round forks one optimizer handed only the reference score and the joined public statements — explicitly told the context contains no rubric — and one applier handed the candidate and the agent-state directory.

#### Token effect

`runBenchmark` and `establishBaseline` spend one executor and one evaluator request per case run. Each optimize round spends one optimizer request, one applier request, and one executor and one evaluator request per case run, plus one filesystem snapshot.

#### KV Cache effect

These child prompts are request-local: their content varies with each case, round, and reference, so they never form a stable prefix for the parent request. The parent request prefix is unaffected by this provider.

## Known Limitations and Deferred Work

- **Live runtime required for the default seams** — execution, evaluation, proposal, and apply fork a child over `ctx.subagents`, which needs the `fork` provider and a live parent agent resolved through a `sessionId`; without them the loop fails loud rather than degrading. Consumers without the subagent runtime must inject their own seams.
- **No retries on child output** — a child that ends before `completed`, or emits non-JSON or field-invalid output, fails the whole operation; the loop does not re-fork. The executor's deliverable is free text (no JSON wrapper); only the evaluator must emit JSON.
- **Snapshot versions never recycle** — monotonic `max + 1` minting is deliberate (a rejected round's archive stays on disk as evidence), so long-lived loops accumulate archives until the caller prunes them.
- **No UI or CLI surface** — this is a programmatic service; nothing in `dsh` exposes it yet.
- **No keyed end-to-end verification** — the default seams are exercised through unit tests that mock the subagent runtime; a live `dsh --profile` loop run requires a keyed environment.
- **Live parent agent must be resolvable by session id** — the engine threads a `sessionId` through the seams, not a direct agent reference; callers that hold an `Agent` must map it to a session first.

### Dev Note

None.
