# Agent Note: patent zero-call tools are attributed and routed

Status: implemented

English | [中文](2026-10-03-patent-zero-call-tool-attribution.zh.md)

## Problem

The 2026-10-03 patent-domain data-axis clearance (window 2026-09-06..2026-10-02, 91 sessions that offered the patent tool set, equal in length to the 2026-09-21 baseline) recorded eleven patent-domain tools at zero calls: `add_patent_figure_references`, `evaluate_evidence`, `generate_structure_figure`, `flexible_plan`, `patent_plan_task`, `patent_workflow_run`, `recognize_chemical_structure`, `search_patent_figure`, `patent_teams_remove_member`, `paper_download`, `paper_list_sources`.

A zero count decides nothing by itself: one log shape covers a tool whose scene never arose, a tool whose route never reached the model, and a tool whose job another mechanism already does. The deployment-side record had already given seven of the eleven a "keep" verdict and the counts did not move, so the verdicts were not what was missing — their evidence was.

Two recorded attributions were false in a way that would misdirect the next reader. `evaluate_evidence` was called "kept: the EVI-011 guard runs in the background, so the model need not call it"; the guard is a tool-call guard registered for that tool name alone ([evidenceComplianceGuards.ts](../../../../packages/patent/patent-rule/src/guard/evidenceComplianceGuards.ts)), so zero calls meant zero guard coverage rather than background coverage. And `add_patent_figure_references` was named a required step of specification drafting, while `generate_patent_figure` already embeds the numerals its `labels[]` argument names — the required-step reading pointed the model at a call it did not need and left the real case (an externally drawn SVG that needs numerals) unstated.

## Decision

Each of the eleven tools takes one verdict, with its evidence named.

**Routed, trigger text corrected** — in the persona (`packages/bundle/web-app/presets/patent.patch.yml`) and in the three delivery skills that repeated the same trigger (`patent-document-polish`, `patent-team-composition`, `patent-quality-gate`):

- `add_patent_figure_references` — routed for self-drawn or external SVG input only; the persona and the skills say so and say not to re-annotate a `generate_patent_figure` output. `patent-document-polish` had also described the tool as filling in specification numerals, which is not what it does — it annotates the drawing.
- `search_patent_figure` — routed for specification drafting, with the index location stated: `.sati/figures-index.json` under the case working directory, written by `analyze_patent_figure`, so another case directory starts with an empty index.
- `evaluate_evidence` — routed for evidence entering an office-action response, an invalidation, or a reexamination. The persona makes the call a required step before evidence enters an opinion and states what skipping it costs; the guard mechanism stays out of the prompt, where the model's job is the evidence check rather than how the check is wired.

**Kept, scene absent** — reachable, and the scene did not arise in this window:

- `generate_structure_figure` — `structureFigureEnabled: true` is set and the FreeCAD probe passes on this host (`/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd`, FreeCAD 1.1.3). No STEP/IGES/BREP case appeared.
- `flexible_plan` — routed for a design-invalidation A23 ground program, which has no built-in manifest entry. No such case appeared.

**Kept, an existing decision owns it** — `patent_workflow_run` is the subject of [the closure-required note](2026-09-21-patent-workflow-closure-required.md), and [the delivery-gate note](2026-10-03-patent-delivery-gate-enforces-gate-runs.md) now enforces the run for the analysis templates; `recognize_chemical_structure` is unavailable by construction, its ported pipeline is absent and its description says so.

**Not routed** — kept in the tool set, deliberately absent from the persona:

- `patent_plan_task` — the stateless plan state machine duplicates plan mode plus `todo_write`, and no scenario names it.
- `patent_teams_remove_member` — teams end through `patent_teams_delete` and archive; per-member removal is not a path the work takes.
- `paper_download`, `paper_list_sources` — literature work goes through `web_search`; `paper_search` had one call in the window and neither downstream tool had any.

## Alternatives considered

- **Delete the tools that are not routed.** Rejected: they belong to the ported patent tool set, and deleting one is a product-surface change this evidence does not force. The dilution cost stays recorded under Consequences.
- **Correct the counts and leave the attributions.** Rejected: a false reason outlives a missing one, and two of these were false.
- **Enforce `evaluate_evidence` instead of routing it.** Not done here: the delivery path is a document render rather than a state transition, so enforcement would need cross-call evidence state. [The closure-required note](2026-09-21-patent-workflow-closure-required.md) rejected the same shape for closure. [The delivery-gate note](2026-10-03-patent-delivery-gate-enforces-gate-runs.md) ships that mechanism and keeps `evaluate_evidence` routed: a gate can observe that a call happened, not that evidence is being cited.
- **Require `add_patent_figure_references` for every drafted figure.** Rejected: `generate_patent_figure` already embeds numerals, so a required call would add a re-annotation pass with no artifact.

## Consequences

- The next equal-length window tests each verdict: zero calls for `add_patent_figure_references` or `search_patent_figure` under the corrected trigger text means the trigger is still wrong; zero calls for `evaluate_evidence` means evidence-form defects keep reaching delivered documents unchecked.
- Four tools remain on the model's tool surface without a route, so that surface is longer than the routed set. A later clearance round should price that dilution against the cost of removal.
- The deployment ledger `~/.dsh/patent-ops/README.md`, the persona, and the skills carry the corrected verdicts; the ledger sits outside version control, so this note is the citable record.
