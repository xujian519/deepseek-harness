# Agent Note: Gate patent-team task completion

Status: implemented

English | [中文](2026-08-23-quality-gate-into-teams.zh.md)

## Problem

A contract-backed team task (one created with a `worker`) completed with a soft acceptance only: `update_task(completed)` wrote a `contractValidation` verdict and a `patent-teams/task-validated` event but never blocked a low-quality submission. The standalone `patent_eval` (comprehensive score) and the `patent-rule` output gate had been wired into the tool path only, never into team task completion, so a member could report a task done regardless of score, missing contract fields, or rule violations.

## Decision

Bounce a contract-backed completion back for rework unless a composite quality gate clears:

- **Trigger**: `config.qualityGate === true` (default `false`, set to `true` in the patent preset's `patent-teams` row) AND the task has a `worker` AND the caller targets `completed` with an `output`. This keeps gate-free and non-contract tasks on the prior path.
- **Composite gate**: bounce on `validateWorkerOutput` (contract hard fields), content sufficiency (`evaluatePatentContent('comprehensive', ...)` → `内容充分性`), and, when present, the `patentRuleGate` rule gate (`ctx.get('patentRuleGate')` returning the same `RuleOutputGate` case `patent-rule` uses for `tools/post-execute`). The `comprehensive` score is advisory — it is reported in the feedback and `config.passThreshold` controls when it is called out — but is never a bounce reason on its own, because its structure/workflow dimensions penalize section-less segments that a worker contract already obliges.
- **Bounce**: if the gate fails, `completed` is not admitted; the task stays `in_progress`, `TaskGateFeedback` (score / failures / feedback) is recorded, a `patent-teams/task-gated` event is appended, and `update_task` returns `gated: true` with the feedback so the member revises and resubmits with the same `attempt_id`. On success the prior logic runs (`contractValidation` + `task-validated`).

## Alternatives considered

**Hard white-list shrinks (`toolFilter.allow` per role).** Left separate: it changes member capability edges and requires deriving a per-role tool union plus the team-lifecycle tools; the soft gate already raises the acceptance bar without that blast radius.

**Running `patent-workflow` manifests per member task.** A larger effort that rewrites the team task model; the gate is a narrower, closed-loop improvement.

## Consequences

- `patent-teams` newly depends on `@deepseek-ai/dsh-patent-tools` (`evaluatePatentContent`) and peers `@deepseek-ai/dsh-patent-core` (the `RuleOutputGate` type); `patent-rule` registers the same gate at `ctx.patentRuleGate` for reuse. Dependency is one-directional, no cycle.
- `TeamTask` gains `worker` / `contractValidation` / `gateFeedback`; new `patent-teams/task-gated` event. `patent_teams_status` surfaces role-contract summaries, worker validation, and the gate verdict.
- Backward compatible: `qualityGate` defaults off, so existing suites and non-contract tasks are unchanged. The patent preset enables it under `config.qualityGate: true`.
- Known limitation: repeated bounces are not auto-capped; the captain handles chronic failures with `reassign_task`. The gate enforces machine checkable quality, not every judgment call.
- After review the gate was tightened to the dimensions that apply to a single work-product segment (contract fields, content sufficiency, rule violations); the `comprehensive` composite is advisory (`passThreshold`) rather than a hard threshold, fixing a mis-block that bounced every section-less, contract-complete submission below `0.7`.
- Note: the worktree was reverted between sessions, so the wiring and role→contract layers were rebuilt alongside this gate (patent-teams mount, `apps/cli` dependency, catalog hooks, SKILL tool names).

## Non-attributable failures (waiting on the concurrent window)

Repository-wide gates red from the concurrently in-progress `self-evolve` window (`packages/test-support/self-evolve-eval`, `packages/host/apiproxy`, `packages/bundle/web-app` synapse rows). This change touches none of them. Re-validate after that window lands; do not treat as a regression here:

- `verify-cordis-config` / `verify-config-catalog` / `verify-doc-graphs` / `verify-package-readme-model-experience` — synapse / self-evolve listing gaps.
- Full-repo `build` and `tsdown` do not complete in this worktree because `dsh-root`'s `lib/types/startup.js` is missing (its `tsc` type check fails on `self-evolve-eval`), so cross-package runtime imports resolve to stale bundle `lib/index.js`; per-package `tsc -b` and per-package tests pass, and the composite gate logic is verified over a source-alias vitest config.
