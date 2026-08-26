# Agent Note: Benchmark-driven self-evolution, output-level scoring, and the patent preset wiring

Status: implemented

English | [中文](2026-08-26-self-evolve-benchmark-output-scoring-patent-preset.zh.md)

## Problem

The existing self-evolve family is runtime failure-mode mining: `BasicSelfEvolveEngine` mines `failure-patterns` from session events and proposes L1–L4 changes with held-in/held-out validation, but it has no quantitative score target a loop can chase. Penguin-harness (RSI, "Let AI Build AI") supplies the missing half — a benchmark-driven ability evaluation loop: design a benchmark → score the agent → optimize → snapshot and roll back under strict improvement. The harness also had no way to make a patent preset optimize against real deliverable quality.

## Decision

**Add a complementary benchmark-driven dimension as a new package, `@deepseek-ai/dsh-self-evolve-benchmark` (C1+C2+C3), without touching the runtime `BasicSelfEvolveEngine` core.** `BenchmarkEvolveEngine` exposes `establishBaseline` / `optimizeLoop` / `readScoreboard`; a scoreboard persists per-run score/cost/duration chained to session traces; whole-state snapshots are versioned `v<version>.tar.gz` archives that exclude `.vault.toml` and never reuse a version.

**Scoring is output-level, not config-level.** `evaluateCase` measures the deliverable, not the agent-state directory: each case run first executes the task through the new `executeCase` seam (a fork subagent that inherits the patent preset and reads the task `statement` plus the work specification), then hands the produced output to the evaluator as the required `attempt`. The default evaluator prompt scores the deliverable against the private `rubric`.

**Agent state is a model-visible patent work specification (checklist), not the preset configuration.** The optimizer edits `guidance.md`; the executor reads it to produce the deliverable; the applier writes it back. This sidesteps the hard architectural limit that an executor cannot recompose an agent from an arbitrary config directory (`composeFrom` only inherits the parent agent's standing preset).

**The assembly lives in the agent-preset layer.** `patent/agent.cordis.yml` mounts `@deepseek-ai/dsh-self-evolve-benchmark` inside a `cordis:group` with `isolate: selfEvolveBenchmark`, programmatic only — no model-facing tool. `agentStateDir` points at the seeded `patent-state` work copy under the data root, never a real docket directory: a real case or knowledge base can never be snapshotted wholesale or rewritten in place by an optimize loop.

**A runnable example benchmark `patent-oas` ships** with four cases (`oa-answer`, `claim-drafting`, `infringement-comparison`, `novelty-creative`), each keeping the public `statement` physically separate from the private `rubric`, plus a `patent-state/guidance.md` seed and an idempotent `seed.mjs` script.

## Alternatives considered

**Config-level scoring.** Rejected: measuring "the configuration looks compliant" is meaningless for deliverable-driven patent work and would let the optimize loop tune the prompt toward self-corroboration. Output-level scoring makes the score equal real deliverable quality.

**Agent state as the full preset configuration.** Rejected: `composeFrom` cannot rebuild an agent from an arbitrary config directory, so an executor could not replay the optimized configuration; a work-specification checklist keeps the optimization object and the execution object identical.

**Assembly in the profile-bundle layer.** Rejected: the self-evolve seam lives in the profile-bundle layer (`dsh.profile.bundles` + `cordis.patch.yml`) while the patent preset is an agent-preset-layer fork of `standard`; the layers are orthogonal and do not communicate via preset `extends`.

**A model-facing `tool-self-evolve-benchmark` consumer in this phase.** Deferred: this phase ships the programmatic service only; a consumer that surfaces `self_evolve_benchmark_*` tools stays an explicit future option.

## Consequences

- Fork subagents inherit the patent preset: evaluator, optimizer, and applier children run with the patent tools/persona, with approval pinned to `'never'` (approval-gated operations are refused in children) and plan-mode discipline carried in — the executor prompt explicitly exits plan semantics so a deliverable can be produced directly.
- The runtime closure now requires `@deepseek-ai/dsh-self-evolve-benchmark` in the python sdk-runtime deploy manifest; the catalog generators registered the new service (`gen-cordis-catalog`, `gen-doc-graphs`, `gen-config-catalog`) and regenerated `docs/config-catalog`, `docs/capability-seams`, and `docs/subsystems/self-evolve`.
- The contamination guard is unchanged: `publicBenchmarkView`/`assertNoPrivateLeak` keep rubric vocabulary out of optimizer context, and snapshots still exclude `.vault.toml`.
- Verification: 80 unit tests at per-file 100% coverage, `typecheck`, `lint`, `doc-sync` (28 gates), `verify-cordis-config`, `verify-runtime-closure` (6 presets / 133 packages), and `verify-package-invariants` all pass. Remaining hygiene reds are pre-existing debt on `master` (the `constraints` false positive on the manifest-less `packages/self-evolve/evaluation` directory, and knip on `@xmanrui/dsh-im` in `packages/bundle/im` plus a redundant `@deepseek-ai/dsh-fs` devDependency in `packages/memory/openviking`); the single `test:snapshot` failure in `examples/acp-agent` reproduces on `master` (a Node `ExperimentalWarning: SQLite` leak into an asserted-empty stderr, an environment-Node-version artifact unrelated to this change).
