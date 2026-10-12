---
description: "Service Definition for the patent execution pipeline (`ctx.patentWorkflow`): the declarative workflow executor, the flexible-plan layer, the plantask human-in-the-loop state machine, and the case-docket issue schema, ported from Sati. The package appends durable `patent/plantask`, `patent/workflow-run`, and `patent/model-call` events to the calling agent's session log and resolves plantask approval through the optional `ctx.approval` seam."
kind: "package-reference"
---

# @deepseek-ai/dsh-patent-workflow

English | [中文](README.zh.md)

## Summary

Service Definition for the patent execution pipeline (`ctx.patentWorkflow`): the declarative workflow executor, the flexible-plan layer, the plantask human-in-the-loop state machine, and the case-docket issue schema, ported from Sati. The package appends durable `patent/plantask`, `patent/workflow-run`, and `patent/model-call` events to the calling agent's session log and resolves plantask approval through the optional `ctx.approval` seam.

## Table of Contents

- [Service](#service)
- [Case-docket issues](#case-docket-issues)
- [Approval wiring](#approval-wiring)
- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Service

The `PatentWorkflow` service exposes the pipeline entry points and re-exports the pure pipeline API (workflow, workflow-dag, workflow-store, flexible-plan, flexible-plan-store, plantask, worker-contract, checker-verdict, docket-issue) from this package's root export. `CheckerVerdict` is the structured review-outcome schema for checker-tier workers (`pass`/`needs_revision`/`blocked` + per-issue severity); `parseCheckerVerdict` validates model JSON on that boundary.

### runWorkflow(manifest, ctx, executor?, options?, agent?)

Runs a workflow manifest through the ported executor and appends a `patent/workflow-run` event to `agent.session` when an agent is given. Stages declare an atom or fall back to `executor`; a stage listing upstream stage ids in `consumes` hands those outputs to the executor (each executed stage stores its output under its own id, in both the manifest and graph paths), an atom stage reads the shared state directly, and an approval-gate `InterruptStageError` pauses the run and returns `interrupted` instead of failing, with the host resuming by re-running with the stage id in `options.approvalGrants`.

`builtinPatentManifests` is the data catalog of the eight built-in manifests: patent_novelty_v1, patent_disclosure_v1, patent_inventiveness_v1, patent_patentability_v1, patent_oa_response_v1, patent_invalidation_v1, patent_reexamination_v1, patent_infringement_v1. The invalidation and reexamination manifests share one stage builder and differ only in how their deterministic stages are wired: the invalidation manifest reads the invalidation grounds table and the `invalidity` chart mode, the reexamination manifest the reexamination table (one extra utility-model subject-matter ground under 专利法第2条第3款, with the patent subject reported separately) and the `reexamination` chart mode, which also keeps the two cases' persisted charts apart.

### runPlantask(agent, caseId, planSteps, options?)

Drives a plantask plan through planning → awaiting_approval → executing. The awaiting_approval gate resolves through `ctx.get('approval')`; without an approval service the plan fails closed (replanning) rather than auto-approving. `options.autoApprove: false` parks the plan at awaiting_approval for an out-of-band decision.

### approve(caseId) / reject(caseId, feedback?)

Decision entries for a plantask parked at awaiting_approval: `approve` resumes to executing, `reject` rolls back to replanning with feedback. They key on `caseId` and throw when no pending plantask matches.

### loggedPatentModel(port, agent, context)

Wraps a patent model port so every call it serves appends one `patent/model-call` event to `agent.session`, recording the call site, the manifest, the provider route, the token usage, and the complete output text. The agent loop logs its own calls as `request/*` + `assistant/*`; a model call a patent tool makes inside its body has neither, which leaves the request invisible to the log and the keyless replay unable to rebuild the call order. The request side stays reconstructable without a record of its own: the tool call's arguments are logged, and the manifest plus the run's stage outputs make up the prompt. A call whose stream fails mid-flight, or one a consumer stops consuming, appends nothing — it produced no complete visible output, and its degraded stage is recorded by the run result. Without an agent (direct library use, unit tests) the port is returned unchanged.

## Case-docket issues

`DocketIssue` is one case problem as a machine-readable record: `id`, `summary`, `kind`, `disposition`, `status`, `blocking`, `round_opened`, plus an optional `anchor` (claim, paragraph, or file path). `kind` is a closed vocabulary of six (machine format, amendable substantive defect, evidence gap, scope/strategy choice, defect no amendment can cure, noise). The package ships `assets/issue-dispositions.json`, the kind → default table; `loadIssueDispositions()` validates it on load (every kind present exactly once, in-vocabulary values, non-empty criteria) and throws `IssueDispositionError` otherwise. `resolveDocketIssue(draft, round, dispositions)` fills an omitted `disposition`/`blocking` from the kind's row, sets `status: 'open'`, and stamps `round_opened`; a value on the item overrides the row.

`blocking` is three grades because a binary one stalls the pipeline on every question asked: `none` does not hold up dispatch, `blocking` holds it up until the item closes, and `terminal` lets the round end only in a terminal state. The shipped defaults follow what closing actually costs — an amendable substantive defect is `none`, since dispatching the next round is how it gets closed, while an evidence gap is `blocking` and a defect no amendment can cure is `terminal`.

Two pure predicates express the invariants: `openBlockingIssues` (open and not `none`) and `openTerminalIssues` (open and `terminal`). The plantask machine runs them in its transition guards — entering `executing` is refused while a blocking item is open, entering `replanning` while a terminal item is open — and `finished` has no outgoing transition, so a finished plan cannot dispatch again. The machine reads the case's items from `PlanTaskTransitionContext.issues`; omitting them means the case has no registered items, and the guards do not refuse on that basis. `roundCapReached(rounds, maxRounds)` is the third predicate, guarding the round cap described under Configuration.

## Approval wiring

Sati's `approval_pending` event plus `approvalDecide` command maps to the `approval/request` waterfall (`ctx.approval.request(req)`). The plantask awaiting_approval state is one outstanding approval request; `allowed-once` is approve (resume), and `rejected`/`cancelled`/`unavailable` are reject (replanning and roll back). Approval is an optional seam read via `ctx.get('approval')`, so the package holds no compile-time dependency on dsh-user-approval.

## Configuration

| Field | Default | Meaning |
| --- | --- | --- |
| `maxRounds` | `3` | Planning rounds one case may spend on replanning. At the cap, rejection feedback can no longer drive `replanning`: the plan goes to `finished` and the result carries `roundCapExhausted: true`. `0` allows no replanning at all. |

Rounds count per `caseId`, and the registration clears once a plan reaches `finished`, so a case can be planned again from scratch. The counter lives in the service and is not persisted, so a process restart starts the count over.

| Method | Key | Default | Meaning |
| --- | --- | --- | --- |
| `runPlantask` | `autoApprove` | `true` | When false, leave the plan pending for out-of-band `approve`/`reject`. |
| `runPlantask` | `approvalReason` | (none) | Human-readable reason given to the approval answerer. |

## Model Experience

None, as the pipeline executes work for the tool layer; tool schemas, results, and approval prompts are owned by dsh-patent-tools and the interaction seam.

#### KV Cache effect

Independent; the pipeline registers no prompt, tool schema, or result of its own.

## Known Limitations and Deferred Work

- **Storage optional via `ctx.get('storage')`** — file products (workflow-run and flexible-plan stores) use the caller-provided `JsonFileStore` backends; the service does not wire the storage-domain seam, so ctx.storage integration is deferred.
- **Approval fails closed without an answerer** — with no approval service mounted (or no answerer composed), `runPlantask` rejects the plan to replanning instead of auto-approving.
- **Docket production is unwired** — the schema, the disposition asset, and the invariant predicates ship here, but no surface yet turns a review's issue list into docket items or supplies them to a transition, so a caller that omits `issues` gets no item-based refusal.
- **The round counter is per process** — `maxRounds` is counted in the service, not in the session log: a restart clears it, and a plan that reaches `finished` clears its registration.

### Dev Note

None.
