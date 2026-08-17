# @deepseek-ai/dsh-patent-workflow

English | [中文](README.zh.md)

Service Definition for the patent execution pipeline (`ctx.patentWorkflow`): the declarative workflow executor, the flexible-plan layer, and the plantask human-in-the-loop state machine, ported from Sati. The service appends durable `patent/plantask` and `patent/workflow-run` events to the calling agent's session log and resolves plantask approval through the optional `ctx.approval` seam.

## Service

The `PatentWorkflow` service exposes the pipeline entry points and re-exports the pure pipeline API (workflow, workflow-dag, workflow-store, flexible-plan, flexible-plan-store, plantask, worker-contract, approval, output-gate, quality-gate) from this package's root export.

### runWorkflow(manifest, ctx, executor?, options?, agent?)

Runs a workflow manifest through the ported executor and appends a `patent/workflow-run` event to `agent.session` when an agent is given. Stages declare an atom or fall back to `executor`; an approval-gate `InterruptStageError` pauses the run and returns `interrupted` instead of failing, and the host resumes by re-running with the stage id in `options.approvalGrants`.

### runPlantask(agent, caseId, planSteps, options?)

Drives a plantask plan through planning → awaiting_approval → executing. The awaiting_approval gate resolves through `ctx.get('approval')`; without an approval service the plan fails closed (replanning) rather than auto-approving. `options.autoApprove: false` parks the plan at awaiting_approval for an out-of-band decision.

### approve(caseId) / reject(caseId, feedback?)

Decision entries for a plantask parked at awaiting_approval: `approve` resumes to executing, `reject` rolls back to replanning with feedback. They key on `caseId` and throw when no pending plantask matches.

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
