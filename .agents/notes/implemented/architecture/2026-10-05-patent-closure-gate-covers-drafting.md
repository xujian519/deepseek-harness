# Agent Note: the patent closure gate covers the drafting render

Status: implemented

English | [中文](2026-10-05-patent-closure-gate-covers-drafting.zh.md)

## Problem

[The delivery-gate note](2026-10-03-patent-delivery-gate-enforces-gate-runs.md) turned the patent preset's delivery discipline into an execution point: `render_patent_document` is denied until the session has recorded the gate calls that discipline names. Its closure entry required `patent_workflow_run` for the seven analysis templates and left both drafting templates out, recording the reason as "`rectification-response` and `claims-spec` run no manifest and stay outside the closure entry".

That reason holds for 补正 and not for 撰写. `patent_workflow_run` ships eight built-in manifests, and `patent_disclosure_v1` — its default — ends in a claims draft: PFE extraction, prior-art search, per-feature novelty, a review gate, then the claims draft. That is the drafting route, not an analysis route. The shipped `patent-team-composition` skill states the requirement in exactly those terms, naming 撰写=patent_disclosure_v1 in its 收口必经 row beside the analysis manifests, and `patent-matter` repeats the mapping per case type. The drafting half of the closure discipline therefore lived only in the persona and the skills — the arrangement the gate replaced — and it did so inside the gate's own template list, where the exemption read as a deliberate narrowing rather than as a route that was never wired.

The 2026-10-03 window recorded one `patent_workflow_run` call beside 41 `render_patent_document` calls.

## Decision

The preset's closure entry names `claims-spec` beside the seven analysis templates; `rectification-response` stays out. The split follows the line the skills already draw: the entry covers every delivery template whose discipline ends in a manifest run, and 补正 is the one shipped template with no manifest entry, for which the skills substitute a per-replacement-page rectification record.

A `claims-spec` render therefore requires a successful `patent_workflow_run` in the same session, in practice `patent_disclosure_v1`. The persona paragraph on closure states the widened coverage and keeps 补正 outside it, so the prompt and the enforcement agree.

## Alternatives considered

- **Gate `rectification-response` too, without a manifest.** Rejected: it forces a run unrelated to the case before the render unlocks, which is the objection [the closure-required note](2026-09-21-patent-workflow-closure-required.md) recorded against a rendering guard, and the one that template narrowing answered.
- **Add a `patent_rectification_v1` manifest and gate 补正 through it.** Rejected: it needs stage design, fixtures, and matching skill rewrites before it would mean anything, while the skills' replacement-page record already carries the case. Widening coverage does not justify a manifest whose stages nobody has reviewed against practice.
- **Leave the entry as declared and strengthen the persona wording a third time.** Rejected: the requirement was already in the persona and in five skills' closure rows, and the 2026-10-03 window still recorded one closure call. Prose is the instrument the gate replaced.

## Consequences

- A `claims-spec` render can no longer ship from a session with no closure run recorded. The next equal-length window measures the widened entry against drafting, which carries no other closure requirement.
- The ledger is keyed to the live agent and does not survive a resume, so a case whose disclosure analysis ran in an earlier session re-runs the manifest before drafting. The failure direction matches the existing one: a repeated gate run, not a missing one.
- `scripts/preset-divergence-baseline.json` re-records the `persona` row's `patent.patch.yml` hash. The `patent-rule` row is not divergent, so the declaration change by itself does not enter the baseline.
- [The patent-rule README](../../../../packages/patent/patent-rule/README.md) states which templates the closure entry covers, and now names `claims-spec` inside it and `rectification-response` outside.
- No recorded-session snapshot changes. No snapshot pins the persona prefix or the `deliveryGate` block; the only snapshot holding the template ids pins the renderer's tool schema, whose enum already lists all nine templates.
