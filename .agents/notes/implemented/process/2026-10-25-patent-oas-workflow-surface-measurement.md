# Agent Note: Measuring the OA workflow surface through the product executor

Status: implemented

English | [中文](2026-10-25-patent-oas-workflow-surface-measurement.zh.md)

## Problem

`patent-oas` captured every round as one `headless` prompt call, so its score described the model plus the work specification. The parts of office-action practice the product implements — the `patent_oa_response_v1` stages (claim chart, response plan, adversary model, draft, adversary review, checks) and the `_matter-log.md` supersede chain — were outside the measurement, and a bad stage hand-off or a revision that never superseded the previous claim set scored the same as a clean run.

Feeding those surfaces into the benchmark had two constraints. First, the evaluator must not become a second workflow implementation: a harness that sequences stages itself measures its own sequencing, and the manifest is already the definition of this case type. Second, the recorded `headless` baseline stays readable, and its numbers must not be judged against a workflow capture, because the two measure different things.

## Decision

**One executor process per round runs the manifest through `patent_workflow_run`.** The runner pins `manifestId`, `caseId`, and the approval stage ids read from the manifest, then hands the round to the product tool. Stage order, upstream output hand-off, and the `requireAllSteps` verdict stay in the workflow engine. Before scoring, the runner reads the persisted run record back from `data/cases/<caseId>/workflow-runs/` and fails the capture when `completed` is false, so a degraded or paused workflow cannot be scored as a deliverable.

**The manifest and the audit tool own the vocabulary the runner uses.** `planRun` takes the stage list, the approval stages, and the deliverable stage from `builtinPatentManifests`; the deliverable stage is the manifest's single atom-less stage — atom stages execute deterministically, so that one is the model write-up — and a manifest that does not have exactly one fails the plan rather than being guessed at. The runner reads the log with `parseMatterEntries` and `MATTER_LOG_FILE` from patent-tools, so the entry grammar has one home. See [scripts/patent-oas-run-core.ts](../../../../scripts/patent-oas-run-core.ts).

**The claim version of a round is recomputed from the supersede chain.** `claimVersionOf` returns the depth of the round's deliverable artifact on the chain recorded in `_matter-log.md`, and `rounds[].claimVersions` stores one depth per run. Round artifacts are saved under new paths (`outputs/oa-response-r<N>.md`) and the case id is pinned per run (`patent-oas-<case>-run<N>`), which is what `matter_log_append` requires of a `修订` entry. `validateRunRecord` rejects a chain that does not strictly advance, so two rounds sharing one claim set read as a failed revision instead of a scored one.

**The measured surface is a capture-level axis, and baselines are declared per surface.** `RunRecord.execution` is `prompt` or `workflow`, with `workflowId` naming the manifest; one capture starts one kind of process, so the field sits beside `provider` and `modelId` rather than per case. `problem-space.yaml` declares which manifest a case may be captured under, and a capture under `workflow` of a case without that declaration fails before any call. `gate.yaml` lists one baseline per surface under `baselines`, and `--accept` and `--run` route a record to its own surface's file. A record that predates this axis omits `execution` and reads as `prompt`: that collector had only the prompt path, so the absent field identifies the surface rather than leaving it unknown, which is the opposite of the `retrieval` rule where an unlabelled record could have been either setting.

**The workflow composition is the patent tool rows mounted host-plane by an overlay.** A preset is agent-plane and only `dsh-agent-preset-registry` can mount one; the headless composition does not run that registry and its runner rejects preset sessions. `examples/patent-oas/patent-workflow.patch.yml` therefore inserts `@deepseek-ai/dsh-patent-tools`, the same approach the recorded `patent-oa-response` scenario takes. The persona and skill layers of the shipped `patent` preset stay outside this measurement.

**Budget follows the surface.** A workflow round executes 12 stages, so `--runs` defaults to 1 under `workflow` and stays 3 under `prompt`; `--dry-run` prints the stage count per round and the total stage executions before any call is made.

## Alternatives considered

**Have the evaluator drive one process per manifest stage.** Rejected: the evaluator would re-implement stage sequencing and upstream hand-off, which is the boundary this issue says the manifest owns, and a two-round capture would multiply agent processes by the stage count. Per-stage observability is obtained by reading the persisted run record instead.

**Run `patent_workflow_run` in-process over a model port, as the package specs do.** Rejected: that measures the package call, not the model-facing tool surface, and it leaves `matter_log_append` — a tool the executor calls, and the source of the audit chain being measured — out of the run.

**Mount the shipped `patent` agent preset.** Not available: the headless profile neither composes the preset registry nor permits a preset session. The tool rows carry the workflow and audit surfaces; the preset would add persona and skills, which this issue does not score.

**Record `execution` per case, mirroring `retrieval`.** Rejected: `retrieval` is a property of the case material and one value per case suffices, while one case is measured under both surfaces; a per-case field would either forbid the second surface or need a per-setting case mapping, duplicating the case.

**Reuse the single baseline and switch the default surface.** Rejected: it silently redefines the committed `headless` numbers, and cross-surface thresholds attribute nothing.

**Take the claim version from the executor's report.** Rejected: the same model that produced the deliverable would state whether it superseded the previous one, which is the claim under test.

## Consequences

A workflow capture of `oa-answer` is 14 agent calls for two rounds, plus the model calls each stage makes inside the engine; that is why the surface defaults to one run. Approval gates are granted by stage id before the run, so the human-confirmation interaction is not measured — the benchmark scores the produced deliverable and its audit chain, and confirmation remains a product-surface behavior covered elsewhere.

The prompt baseline stays valid and unlabelled; the gate compares it only with `prompt` records, and the first workflow baseline can be recorded only by a keyed capture that then declares its own `baselines` entry. Keyless specs cover the injectable round seam, artifact contracts, chain recomputation, cross-surface rejection, and legacy-record reading; real model behavior under the workflow surface is unverified until that capture lands, and the example README states as much. Related: [the two-round OA evaluation](2026-10-21-patent-oas-two-round-evaluation.md) and [the patent evaluation measurement protocol](2026-10-16-patent-eval-measurement-protocol.md).
