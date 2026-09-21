---
description: "Service Definition for the patent execution pipeline (`ctx.patentWorkflow`): the declarative workflow executor, the flexible-plan layer, and the plantask human-in-the-loop state machine, ported from Sati. The package appends durable `patent/plantask`, `patent/workflow-run`, and `patent/model-call` events to the calling agent's session log and resolves plantask approval through the optional `ctx.approval` seam."
kind: "package-reference"
---

# @deepseek-ai/dsh-patent-workflow

English | [中文](README.zh.md)

## Summary

Service Definition for the patent execution pipeline (`ctx.patentWorkflow`): the declarative workflow executor, the flexible-plan layer, and the plantask human-in-the-loop state machine, ported from Sati. The package appends durable `patent/plantask`, `patent/workflow-run`, and `patent/model-call` events to the calling agent's session log and resolves plantask approval through the optional `ctx.approval` seam.

## Table of Contents

- [Service](#service)
- [Approval wiring](#approval-wiring)
- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Service

The `PatentWorkflow` service exposes the pipeline entry points and re-exports the pure pipeline API (workflow, workflow-dag, workflow-store, flexible-plan, flexible-plan-store, plantask, worker-contract, checker-verdict, approval, output-gate, quality-gate) from this package's root export. `CheckerVerdict` is the structured review-outcome schema for checker-tier workers (`pass`/`needs_revision`/`blocked` + per-issue severity); `parseCheckerVerdict` validates model JSON on that boundary.

### runWorkflow(manifest, ctx, executor?, options?, agent?)

Runs a workflow manifest through the ported executor and appends a `patent/workflow-run` event to `agent.session` when an agent is given. Stages declare an atom or fall back to `executor`; a stage listing upstream stage ids in `consumes` hands those outputs to the executor (each executed stage stores its output under its own id, in both the manifest and graph paths), an atom stage reads the shared state directly, and an approval-gate `InterruptStageError` pauses the run and returns `interrupted` instead of failing, with the host resuming by re-running with the stage id in `options.approvalGrants`.

`builtinPatentManifests` is the data catalog of the eight built-in manifests: patent_novelty_v1, patent_disclosure_v1, patent_inventiveness_v1, patent_patentability_v1, patent_oa_response_v1, patent_invalidation_v1, patent_reexamination_v1, patent_infringement_v1. The invalidation and reexamination manifests share one stage builder and differ only in how their deterministic stages are wired: the invalidation manifest reads the invalidation grounds table and the `invalidity` chart mode, the reexamination manifest the reexamination table (one extra utility-model subject-matter ground under 专利法第2条第3款, with the patent subject reported separately) and the `reexamination` chart mode, which also keeps the two cases' persisted charts apart.

### runPlantask(agent, caseId, planSteps, options?)

Drives a plantask plan through planning → awaiting_approval → executing. The awaiting_approval gate resolves through `ctx.get('approval')`; without an approval service the plan fails closed (replanning) rather than auto-approving. `options.autoApprove: false` parks the plan at awaiting_approval for an out-of-band decision.

### approve(caseId) / reject(caseId, feedback?)

Decision entries for a plantask parked at awaiting_approval: `approve` resumes to executing, `reject` rolls back to replanning with feedback. They key on `caseId` and throw when no pending plantask matches.

### loggedPatentModel(port, agent, context)

Wraps a patent model port so every call it serves appends one `patent/model-call` event to `agent.session`, recording the call site, the manifest, the provider route, the token usage, and the complete output text. The agent loop logs its own calls as `request/*` + `assistant/*`; a model call a patent tool makes inside its body has neither, which leaves the request invisible to the log and the keyless replay unable to rebuild the call order. The request side stays reconstructable without a record of its own: the tool call's arguments are logged, and the manifest plus the run's stage outputs make up the prompt. A call whose stream fails mid-flight, or one a consumer stops consuming, appends nothing — it produced no complete visible output, and its degraded stage is recorded by the run result. Without an agent (direct library use, unit tests) the port is returned unchanged.

## Approval wiring

Sati's `approval_pending` event plus `approvalDecide` command maps to the `approval/request` waterfall (`ctx.approval.request(req)`). The plantask awaiting_approval state is one outstanding approval request; `allowed-once` is approve (resume), and `rejected`/`cancelled`/`unavailable` are reject (replanning and roll back). Approval is an optional seam read via `ctx.get('approval')`, so the package holds no compile-time dependency on dsh-user-approval.

## Configuration

The service has no cordis.yml `Config` schema; `runPlantask` takes per-call options.

| Method | Key | Default | Meaning |
| --- | --- | --- | --- |
| `runPlantask` | `autoApprove` | `true` | When false, leave the plan pending for out-of-band `approve`/`reject`. |
| `runPlantask` | `approvalReason` | (none) | Human-readable reason given to the approval answerer. |

## Model Experience

None, as the pipeline executes work for the tool layer; tool schemas, results, and approval prompts are owned by dsh-patent-tools and the interaction seam.

#### KV Cache effect

Independent; the pipeline registers no prompt, tool schema, or result of its own.

## Known Limitations and Deferred Work

- **Rule engine injected at runtime (P4.1)** — the output gate's `ruleGate` seam accepts a dsh-patent-rule `RuleOutputGate` structurally but the engine is injected at runtime; there is no compile-time dependency on dsh-patent-rule, and a rule check that requires an engine fails loud when none is injected.
- **Storage optional via `ctx.get('storage')`** — file products (workflow-run and flexible-plan stores) use the caller-provided `JsonFileStore` backends; the service does not wire the storage-domain seam, so ctx.storage integration is deferred.
- **Approval fails closed without an answerer** — with no approval service mounted (or no answerer composed), `runPlantask` rejects the plan to replanning instead of auto-approving.

### Dev Note

None.
