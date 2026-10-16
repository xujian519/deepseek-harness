# Agent Note: The office-action response argues facts, rules, then argument

Status: implemented

English | [中文](2026-10-16-oa-response-fact-rule-argument.zh.md)

## Problem

The office-action response (`oa-response` in `@deepseek-ai/dsh-patent-document`) organized the rebuttal as one block per examination-opinion item — examiner's point, reply, supporting facts and evidence, conclusion — and the `patent_oa_response_v1` draft-stage guidance prescribed the same shape. A pilot rework of a real first office action exposed what that shape itself produces:

- **Facts and evaluation shared sentences.** A conclusion such as "本发明与对比文件有本质区别" stood inside what read as a factual account: the facts carried evaluation, and the conclusions carried no citation.
- **The document moved with the notification, not with the legal issues.** Formality items (wording deletions, drawing-mark edits, abstract rewrites) received sections the size of the novelty and inventiveness arguments, spreading attention evenly across unequal things.
- **Citations rested on memory.** The same pilot draft cited novelty under Article 22(3) and an obsolete Rule 51(3), because a per-item block names the statute as a conclusion after the reasoning; nothing forced a rule to be stated and verified before it was applied.

The filing carrier was also unrecorded: nothing said the rendered document is the in-firm review copy, or that submission transcribes it into CNIPA form 100012 (意见陈述书) and form 100014 (附页). That boundary lived in practice, not in the template.

## Decision

The opinion statement runs three layers in a fixed order of eight parts — overall position, this amendment, the facts of the case, the applicable rules, the argument, other defects, evidence and citations, conclusion and requests. The `oa-response` template's `references/conventions.md`, its slot registry (`OA_RESPONSE` in `src/document/draftSchema/generic.ts`), and the draft-stage guidance in `patent_oa_response_v1` state one discipline:

- **Facts** state only what the application discloses or the prior art publishes, numbered F1…/P1…, at most two sentences each, pinned to claim numbers, specification sections, and prior-art paragraphs or drawing marks. Evaluation is banned from this layer; structural locations ("实施例 1") are working-draft only, and formal drafts reach page-line precision (conventions §5).
- **Rules** list the statutes and Guideline sections the argument will rest on, numbered R1…, each number verified before it is written, with superseded numbers converted (the old Rule 51(3)). The shipped index records Guideline section numbers without their text, so the document cites section numbers and subjects unless a verified text source is supplied (conventions §4).
- **Argument** references the fact and rule numbers it rests on (F/P, R), organized by legal issue — 5.1 novelty, 5.2 inventiveness, 5.3 other issues — never by examination-opinion item number, which appears only as a locating parenthetical. The three-step inventiveness analysis keeps its discipline inside 5.2.
- **Amendments** present the comparison table and the full text of every amended independent claim, added text underlined and bold, deletions only in the comparison table (conventions §6).
- **Formality items** collapse into one list, each entry stating its treatment and basis, so they no longer compete with the substantive sections.
- The rendered HTML/PDF is the in-firm review copy; filing with CNIPA transcribes the body into form 100014 (附页) under form 100012 (意见陈述书) (conventions §8).

## Alternatives considered

- **Keep the per-item block and add requirements on top** (pin-cites, verified statute numbers). It loses because the observed defects are produced by the block's shape: within one block the fact statement, the evaluation, and the law sit in adjacent sentences, so "facts carry no evaluation" degrades into per-item review; and the statute is written after the reasoning, when it is a conclusion rather than a premise.
- **Hoist facts and rules into their own sections but keep the argument organized per item.** A shared premise would be restated under every item, and the section count would still track the notification's composition; formality items keep argument-sized sections — the dilution the pilot rework recorded.
- **Move only the template and leave the draft-stage guidance per item.** The guidance is the text the model reads while drafting; a template-only change would leave the operative instruction prescribing the old shape, and the draft stage would keep producing prose the slot set no longer mirrors. The guidance moved in the same change.

## Consequences

- The slot registry changed: the `arg-*` fields are gone, and the addressable sections are `facts-application`, `facts-prior-art`, `rules-body`, `argument-novelty`, `argument-inventiveness`, `argument-other` (optional), and `formalities-body` (optional). A draft written against the removed ids fails validation — unknown keys plus missing required sections — instead of rendering.
- A case raising a single substantive ground still carries both 5.1 and 5.2; the subsection without a raised ground states that the ground was not raised and does not expand.
- Model-visible text changed in the workflow's draft stage; `manifest-guidance.spec.ts` pins the three-layer discipline and the absence of the per-item phrasing.
- The controlled draft remains the only content channel for patent deliverables ([2026-10-10](2026-10-10-patent-documents-single-channel.md)).

## Testing

- `packages/patent/patent-workflow/tests/manifest-guidance.spec.ts` — the draft guidance carries 「事实 → 规则 → 论证」 and issue-based organization, and no longer the per-item phrasing.
- `packages/patent/patent-document/tests/tool.spec.ts` — a form draft renders through the new slot set.
- `packages/patent/patent-document/tests/draft-schema-conformance.spec.ts` — registry and template lock bidirectionally, so a slot added on one side alone fails.
- `pnpm exec vitest run packages/patent/patent-workflow packages/patent/patent-document`: 38 files, 499 tests passed.
