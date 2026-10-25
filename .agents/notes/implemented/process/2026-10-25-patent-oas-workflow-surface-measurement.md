# Agent Note: Measuring the OA workflow surface through the product executor

Status: implemented

English | [中文](2026-10-25-patent-oas-workflow-surface-measurement.zh.md)

## Problem

`patent-oas` captured every round as one `headless` prompt call, so its score described the model plus the work specification. The parts of office-action practice the product implements — the `patent_oa_response_v1` stages (claim chart, response plan, adversary model, draft, adversary review, checks) and the `_matter-log.md` supersede chain — were outside the measurement, and a bad stage hand-off or a revision that never superseded the previous claim set scored the same as a clean run.

Feeding those surfaces into the benchmark had two constraints. First, the evaluator must not become a second workflow implementation: a harness that sequences stages itself measures its own sequencing, and the manifest is already the definition of this case type. Second, the recorded `headless` baseline stays readable, and its numbers must not be judged against a workflow capture, because the two measure different things.

## Decision

**One executor process per round runs the manifest through `patent_workflow_run`.** The runner pins `manifestId`, `caseId`, and the approval stage ids read from the manifest, then hands the round to the product tool. Stage order, upstream output hand-off, and the `requireAllSteps` verdict stay in the workflow engine. Before scoring, the runner reads the persisted run record back from `data/cases/<caseId>/workflow-runs/` and fails the capture when `completed` is false, so a degraded or paused workflow cannot be scored as a deliverable.

**The executor passes the claims under review separately from the material.** `patent_workflow_run` reads `claims` for element-level atoms; without it `claim-chart` splits the whole `input` on leading numbering, and a written office action enumerates both its arguments and its required steps that way. The first keyed capture degraded every element check of round 1 on that reading, so the prompt pins `claims` to the claim text of the round — the amended claims when the previous deliverable amended them — and forbids argument lists in it.

**The manifest and the audit tool own the vocabulary the runner uses.** `planRun` takes the stage list, the approval stages, and the deliverable stage from `builtinPatentManifests`; the deliverable stage is the manifest's single atom-less stage — atom stages execute deterministically, so that one is the model write-up — and a manifest that does not have exactly one fails the plan rather than being guessed at. The runner reads the log with `parseMatterEntries` and `MATTER_LOG_FILE` from patent-tools, so the entry grammar has one home. See [scripts/patent-oas-run-core.ts](../../../../scripts/patent-oas-run-core.ts).

**The claim version of a round is recomputed from the supersede chain.** `claimVersionOf` returns the depth of the round's deliverable artifact on the chain recorded in `_matter-log.md`, and `rounds[].claimVersions` stores one depth per run. Round artifacts are saved under new paths (`outputs/oa-response-r<N>.md`) and the case id is pinned per run (`patent-oas-<case>-run<N>`), which is what `matter_log_append` requires of a `修订` entry. `validateRunRecord` rejects a chain that does not strictly advance, so two rounds sharing one claim set read as a failed revision instead of a scored one.

**The measured surface is a capture-level axis, and baselines are declared per surface.** `RunRecord.execution` is `prompt` or `workflow`, with `workflowId` naming the manifest; one capture starts one kind of process, so the field sits beside `provider` and `modelId` rather than per case. `problem-space.yaml` declares which manifest a case may be captured under, and a capture under `workflow` of a case without that declaration fails before any call. `gate.yaml` lists one baseline per surface under `baselines`, and `--accept` and `--run` route a record to its own surface's file. A record that predates this axis omits `execution` and reads as `prompt`: that collector had only the prompt path, so the absent field identifies the surface rather than leaving it unknown, which is the opposite of the `retrieval` rule where an unlabelled record could have been either setting.

**The workflow composition is the patent tool rows mounted host-plane by an overlay.** A preset is agent-plane and only `dsh-agent-preset-registry` can mount one; the headless composition does not run that registry and its runner rejects preset sessions. `examples/patent-oas/patent-workflow.patch.yml` therefore inserts `@deepseek-ai/dsh-patent-tools`, the same approach the recorded `patent-oa-response` scenario takes. The persona and skill layers of the shipped `patent` preset stay outside this measurement.

**Budget follows the surface.** A workflow round executes every stage of the manifest, so `--runs` defaults to 1 under `workflow` and stays 3 under `prompt`; `--dry-run` prints the stage count per round and the total stage executions before any call is made.

**A record must cover exactly the cases its own surface can run.** `requiredCasesOf` returns the gold cases declaring the record's manifest under `workflow` and the whole gold set under `prompt`. The previous rule — every gold case observed — made the workflow surface impossible to capture or accept, because only `oa-answer` declares a manifest and the other cases cannot run it.

**Thresholds belong to a surface, and a node that surface cannot produce evidence for is exempted rather than scored.** `gate.yaml.surfaces` names the nodes one surface does not assess; the scoring view in `evaluateRun` drops them from the node, case and aggregate weightings together, and the verdict prints a `[not-assessed]` line naming the exemption and the surface it came from. `validateGateConfig` requires the exemption to bind at least one node of that surface's cases, to leave at least one node assessable, and to name real nodes, so a stale exemption fails the gate instead of quietly widening it. The mechanism was built for the first keyed workflow capture, which measured 45.0 on `prior-art-search` and `deliverable-format` — both fed only by dimension 5 of `oa-answer` — while `patent_oa_response_v1` had no stage that produced search evidence; giving that manifest the stage removed the exemption, see [the OA answer's search-strategy stage](../feature/2026-10-26-patent-oa-search-strategy-stage.md).

## Alternatives considered

**Have the evaluator drive one process per manifest stage.** Rejected: the evaluator would re-implement stage sequencing and upstream hand-off, which is the boundary this issue says the manifest owns, and a two-round capture would multiply agent processes by the stage count. Per-stage observability is obtained by reading the persisted run record instead.

**Run `patent_workflow_run` in-process over a model port, as the package specs do.** Rejected: that measures the package call, not the model-facing tool surface, and it leaves `matter_log_append` — a tool the executor calls, and the source of the audit chain being measured — out of the run.

**Mount the shipped `patent` agent preset.** Not available: the headless profile neither composes the preset registry nor permits a preset session. The tool rows carry the workflow and audit surfaces; the preset would add persona and skills, which this issue does not score.

**Record `execution` per case, mirroring `retrieval`.** Rejected: `retrieval` is a property of the case material and one value per case suffices, while one case is measured under both surfaces; a per-case field would either forbid the second surface or need a per-setting case mapping, duplicating the case.

**Reuse the single baseline and switch the default surface.** Rejected: it silently redefines the committed `headless` numbers, and cross-surface thresholds attribute nothing.

**Take the claim version from the executor's report.** Rejected: the same model that produced the deliverable would state whether it superseded the previous one, which is the claim under test.

**Lower the shared node floor until the workflow record passes.** Rejected: the floor is what the prompt surface's committed numbers were measured against, and a missing manifest stage is not a threshold that was set too high.

**Exempt at the node layer alone.** Rejected: the case mean would keep dimension 5's full points, so the aggregate would still carry the evidence the exemption declares absent, and the same number would mean two things on two surfaces.

**Add a search stage to `patent_oa_response_v1` to close the gap.** Deferred here: the manifest is a product asset and this issue keeps its stage definitions outside the evaluator, so the exemption carried the removal condition instead. The stage was added in [the OA answer's search-strategy stage](../feature/2026-10-26-patent-oa-search-strategy-stage.md).

## Consequences

A workflow capture of `oa-answer` is 14 agent calls for two rounds, plus the model calls each stage makes inside the engine; that is why the surface defaults to one run. Approval gates are granted by stage id before the run, so the human-confirmation interaction is not measured — the benchmark scores the produced deliverable and its audit chain, and confirmation remains a product-surface behavior covered elsewhere.

The prompt baseline stays valid and unlabelled; the gate compares it only with `prompt` records. The workflow surface's first baseline came from a keyed capture on 2026-10-25 and declares its own `baselines` entry, so both surfaces now have a regression reference judged by their own thresholds. Keyless specs cover the injectable round seam, artifact contracts, chain recomputation, cross-surface rejection, legacy-record reading, and the exemption's effect on all three scoring layers. A keyless `--accept` test cannot route a declared surface through the CLI without writing into the repository path that `gate.yaml` names, so the refusal and routing paths are exercised against constructed configs and only refusals run the script. Related: [the two-round OA evaluation](2026-10-21-patent-oas-two-round-evaluation.md) and [the patent evaluation measurement protocol](2026-10-16-patent-eval-measurement-protocol.md).
