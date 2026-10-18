---
kind: upgrade-guide
description: "Patent atoms now degrade on month-only dates, compound evidence, malformed JSON, invalid chart modes, non-string LLM arrays, and invalid tunables instead of guessing or throwing."
---

# Patent atom inputs now fail closed

English | [中文](guide.zh.md)

## Change

`@deepseek-ai/dsh-patent-core` atoms now degrade on ambiguous or malformed input instead of guessing. The affected surfaces:

- `time-baseline`, `prior-art-filter`, `evidence-check`, and `conflicting-application` reject month-only filing, priority, and reference dates; month-only publication dates still infer the month end.
- `evidence-check` runs every matching evidence form. A compound entry (prior art + foreign language + overseas) is checked for translation, notarization, and legalization together, so an entry that passed under one label may now report a violation.
- `claim-chart`, `response-plan`, and `coverage` degrade with indexed reasons for malformed `office_action`, `claim_chart_doc`, or `chart_targets` entries (null, missing `id`, invalid `kind` or `mapping`). An invalid `chart_mode` no longer falls back to `invalidity`.
- `extract`, `keywords`, `draft-claims`, `compare`, and `novelty` degrade when LLM arrays contain non-string or non-object entries. `extract` with `output_key` now requires and returns only that key.
- Stage params are validated: `temperature` is 0-2, `max_retries` an integer 0-10, `prompt_char_limit` a positive integer, and `groundedness_threshold` 0-1. Invalid values degrade.

## Migration

1. Normalize filing, priority, and reference dates to `yyyy-MM-dd`. Publication dates may stay exact or month-level.
2. For compound evidence, state `translated`, `notarized`, `legalized`, `notarizedExempt`, `legalizedExempt`, and `witnessDisclosed` explicitly. A missing boolean becomes a pending check; `false` becomes a violation.
3. Validate generated `office_action`, `claim_chart_doc`, and `chart_targets` before the stage. Every target needs a non-empty `id` and `kind`: `prior-art`, or `product` / `accused-product` for an accused product. Every `claim_chart_doc` row needs one of `literal`, `literal-construction-dependent`, `doe`, `anticipation`, `obviousness-combination`, `partial`, `not-found`, `needs-evidence`, or `construction-dependent`.
4. Set `chart_mode` to `infringement`, `invalidity`, `oa-response`, `reexamination`, or `patentability`. Remove out-of-range tunables from stage params.
5. Ask the model for arrays of strings, or for records with the required `feature` / `disclosed` fields.
6. Confirm: `pnpm exec vitest run packages/patent/patent-core` passes, and a workflow run on valid inputs contains no `[WORKFLOW_DEGRADED]` output.
