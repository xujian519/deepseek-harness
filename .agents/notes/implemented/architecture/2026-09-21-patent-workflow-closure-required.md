# Agent Note: patent workflow closure stays required, owned by the captain's closure task

Status: implemented

English | [中文](2026-09-21-patent-workflow-closure-required.zh.md)

## Problem

The 2026-09-21 utilization audit of this deployment's patent sessions (143 sessions, 19,807 tool calls, window 2026-08-26..2026-09-21) found `patent_workflow` and `patent_workflow_run` with zero calls, across every case directory. The preset's persona and five skills (`patent-novelty-inventiveness`, `patent-oa-response`, `patent-reexamination`, `patent-invalidity`, `patent-infringement`) described manifest closure as the way a conclusion is finalized, and those five skills were themselves never loaded. The organizing work that did happen ran through the team tools: 2,432 of 3,105 patent-domain calls were `patent_teams_*`.

That left two readings with opposite consequences. Either the closure requirement is dead text that should be retired along with the tools it names, or the requirement is right and the path that was supposed to carry it never reached the model. The audit could not distinguish them from usage alone: a zero-call tool with a mandatory instruction and a stale instruction look identical in a call log.

## Decision

Closure stays required, and the team path carries it:

- The persona states that an analysis must be closed with `patent_workflow` / `patent_workflow_run` before it may enter document delivery, and that the captain's closure task treats the stage record as the delivery basis.
- Each scenario in `patent-team-composition` names its manifest in the closure row: `patent_patentability_v1` (立案), `patent_disclosure_v1` plus `patent_novelty_v1` / `patent_inventiveness_v1` (撰写), `patent_oa_response_v1` (答复), `patent_reexamination_v1` (复审), `patent_invalidation_v1` (无效), `patent_infringement_v1` (诉讼). Rectification (补正) has no built-in manifest entry, so a replacement-page checklist stands in for the stage record, and the skill says so.
- The five analysis skills keep closure as a required step; `patent-infringement`'s conditional wording ("when a single run is wanted") becomes a required step, matching what the other four already said.

## Alternatives considered

- **Retire the workflow tools as superseded by the team DAG** — the audit's own first recommendation. Rejected by the product owner: the stage record is the artifact that makes an analysis reviewable months later (which stage ran, on what input, with which verdict), and the team DAG records assignment and gates, not stage outputs.
- **Leave the text unchanged and let the skills carry the requirement.** Rejected: the five skills named the requirement and were never loaded, so the requirement never reached a model; text that only a loaded skill carries is not a requirement.
- **Make the workflow the only closure and drop the captain's closure task.** Rejected: the closure row is also where the case signs off (期限核验, product-owner confirmation, handoff to document delivery), so removing it would drop the gate along with the closure.
- **Force closure through a tool-level guard (rejecting delivery without a run).** Rejected: the patent domain's delivery path is a document render, not a state machine transition, and a guard that blocks rendering would break cases whose manifest has no entry (rectification) or whose run legitimately stopped at a human-approval gate.

## Consequences

- Every case type now spends at least one workflow run on closure, and a case that stops at the human-approval gate must re-call with `approveStageIds`, which the persona and skills state.
- The audit's next equal-length window makes the decision testable: `patent_workflow_run` at five or more calls means the requirement reached the model; zero calls with the requirement now written into the persona *and* the closure rows means the requirement is again mis-placed, and the retirement branch reopens with better evidence than this round had.
- The team DAG gains a required step per scenario, so a captain that skips closure produces a task list whose final row is visibly unmet rather than an analysis that silently looks finished.
- Rectification cases carry a checklist instead of a stage record, so their audit trail is weaker than every other case type's; the skill records the reason rather than inventing a manifest entry.
