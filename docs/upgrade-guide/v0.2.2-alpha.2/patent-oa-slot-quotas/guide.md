---
kind: upgrade-guide
description: "Rendering an Office-action response now fails when a drafted section exceeds its slot quota, instead of producing an over-long document."
---

# Over-long Office-action drafts now fail to render

English | [中文](guide.zh.md)

## Change

`validateTemplateDraft` gained an opt-in quota check, and the `oa-response` registry turned it on for seven section slots. Before this change an over-long draft was accepted and rendered; now it is rejected before anything is written to disk:

| Slot | Quota |
| --- | --- |
| `facts-application`, `facts-prior-art` | ≤ 1000 visible characters, ≤ 7 list items |
| `argument-novelty`, `argument-inventiveness` | ≤ 1500 visible characters |
| `amendment-table` | ≤ 20 data rows |
| `evidence-table` | ≤ 15 data rows |
| `citation-table` | ≤ 30 data rows |

"Visible characters" means the paragraph text and list items with all whitespace removed, counted by code point. Each quota is the guidance budget of the same section (see `patent-oa-response-budget`) times 1.25, so ordinary writing has headroom and only runaway drafts are stopped.

The rejection is a normal draft-validation failure: the message names the slot, the measured value, the limit and how much to cut, for example `sections.argument-novelty 正文 1620 字超出配额（上限 1500 字）：请删减 120 字以上`. The model sees it as a retryable error; a re-run after trimming succeeds.

The schema change itself is additive and optional: `TemplateBlocksSlot` accepts `maxChars` / `maxItems` and `TemplateRowsSlot` accepts `maxRows`. The other nine generic templates and both form templates declare no quota and behave exactly as before.

## Migration

1. If a case now fails with a quota violation, cut the named section; do not raise the quota per case. The section id in the message is the section to edit.
2. To change the quotas for your firm's practice, edit `OA_RESPONSE_SLOT_QUOTAS` (`packages/patent/patent-document/src/document/draftSchema/generic.ts`). Keep each value at roughly 1.25× the matching field of `OA_RESPONSE_DRAFT_BUDGET` (`packages/patent/patent-workflow/src/workflow/manifests.ts`) — the two packages do not depend on each other, so neither constant follows the other automatically.
3. To give another template a quota, add `maxChars` / `maxItems` / `maxRows` to its slot declaration; no code change is needed. `draft-schema-conformance` asserts that only `oa-response` declares quotas today, so update that assertion together with the declaration.
4. Re-run `pnpm exec vitest run packages/patent/patent-core packages/patent/patent-document` after editing either table.
