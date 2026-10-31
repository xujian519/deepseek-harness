---
kind: upgrade-guide
description: "The Office-action response draft stage now carries a length budget and trimming rules, so the same case produces a noticeably shorter response body."
---

# Office-action responses are now written to a length budget

English | [中文](guide.zh.md)

## Change

The guidance for the `draft` stage of `patent_oa_response_v1` used to say only what to write. It now also says how long to write and what to cut:

- **Length budget**: response body ≤ 4000 characters (excluding tables and the full text of claims); overall position ≤ 200; case facts 3.1／3.2 ≤ 5 items each, ≤ 2 sentences per item; applicable rules ≤ 6 R items; 5.1／5.2 ≤ 1200 each; 5.3 ≤ 3 items; conclusion and relief ≤ 150.
- **Three trimming rules**: do not restate upstream artifacts (the element-by-element claim chart, the per-ground strategies from the response plan, the adversary model's weakness list); do not restate the same conclusion in different words across the overall position, the closing sentence of an argument, and the conclusion; quote a passage in full only once, then refer back by fact number or "see the passage quoted above".
- **No section for grounds never raised**: when the Office action did not object to novelty, one sentence suffices; the slot is left empty and the renderer folds it away (see `patent-oa-optional-sections`).

The stage sequence, stage count and artifact structure are unchanged; only the density of the drafted text changes.

Re-running an existing case now produces a noticeably shorter response. Affected: anyone diffing new output against historical responses, and anyone reading the recorded fixtures as current behaviour. `snapshots/session/patent-oa-response` and `patent-oa-chain` still hold response text from the old behaviour — replay does not re-invoke the model, so the tests keep passing, but those fixtures no longer represent current output.

## Migration

1. When comparing against historical responses, treat the shorter length as expected; judge quality from the `response_check` and `legal_gaps` verdicts, not from character counts.
2. The budget values are starting points, not calibrated against a real corpus of responses. To adjust them to your firm's practice, edit `OA_RESPONSE_DRAFT_BUDGET` (`packages/patent/patent-workflow/src/workflow/manifests.ts`): the prompt text is interpolated from that constant, so one edit propagates. If `packages/patent/patent-document` keeps its own slot quotas, they must match that table.
3. For the occasional case that genuinely needs a longer argument (parallel grounds, multiple independent claims), state why in the case material and raise the budget for that run instead of relying on the model to judge for itself.
4. Re-record the fixtures that contain draft output, and run `pnpm exec vitest run packages/patent/patent-workflow/tests` to confirm the budget and trimming assertions in `manifest-guidance` still hold.
