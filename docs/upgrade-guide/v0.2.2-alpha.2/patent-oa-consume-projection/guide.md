---
kind: upgrade-guide
description: "`consumes` entries may now name a projection (`'claim-chart#rows'`): the stage prompt receives a compact summary of that artifact instead of its pretty-printed JSON, and an unknown projection fails loud instead of falling back to the full text."
---

# Upstream artifacts reach the prompt as projections

English | [中文](guide.zh.md)

## Change

A `consumes` entry may carry a `#` fragment naming a projection:

```ts
consumes: ['dispute-framing-refine', 'parse#oa-summary', 'claim-chart#rows', 'response-plan', 'adversary-model', 'generate_keywords']
```

Without a fragment the entry means the full output, exactly as before. Two projections ship: `claim-chart#rows` and `parse#oa-summary`.

The reason is size, not taste. Atom stages publish `JSON.stringify(value, null, 2)`, so an eight-element claim chart arrives as 4,516 characters, most of it `"quote": ""` and `"verified": false` — fields the drafting stage never reads. On the recorded Office-action case the `draft` prompt falls from 8,500 to 4,303 characters, a 49% cut, without removing anything the writer uses.

`claim-chart#rows` renders the conclusion rows as a table — element, claim, element text, target, mapping, pin-cite — plus one line grouping the gaps by kind. Per-row quotes stay in the run record; the answer refers back by element number rather than restating the comparison. `parse#oa-summary` returns the `office_action_summary` that the parse stage already wrote, falling back to the raw output with a note when that key is absent (the recap path, which runs no atoms).

A projector is `(text, state) => string`. It shapes text and never validates: unparsable input comes back as the original text with a reason, because a projection that throws turns "the upstream emitted one extra field" into a failed run. Only an **unknown** projection throws, in `validateWorkflowManifest` when you pass `options.projections` (a roster, like `atomNames`) and in the renderer unconditionally — a typo must not silently restore full-text injection.

## Migration

1. Existing manifests are unaffected: no fragment means full text. Opt in per entry when an upstream is structured JSON that the consumer only partly reads.
2. `#` is now rejected in stage ids, where it would split the entry and resolve to a stage that never existed.
3. Duplicate detection now compares upstream stage ids, so `['s1', 's1#rows']` is rejected as a duplicate — consuming one artifact twice is a mistake in either form.
4. The two projections are keyed `<stage id>#<name>`, so a manifest with its own `parse` or `claim-chart` stage id inherits them. If your stage is named differently, pass the entry without a fragment until a projection exists for it; there is no registration API to add one from configuration.
5. This changes prompts only, so replays are unaffected — but recorded answers will differ on the next `record`. Re-record with the neighbouring stages, not one stage at a time.
