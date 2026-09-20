# Agent Note: Isolate untrusted prompt text in a data block

Status: implemented

English | [中文](2026-09-20-untrusted-prompt-text-in-data-blocks.zh.md)

## Problem

Every patent prompt that splices external text — the disclosure document, retrieved prior art, claims, a rewind's revision hint — put that text between two bare ` ``` ` fences, or, at two call sites, spliced it with no delimiter at all. The text is untrusted: it arrives from a user upload, a retrieval hit, or a previous model turn. A disclosure containing ` ``` ` closes the fence and everything after it reads as instructions; the same is true of a fabricated `</data>` or a closing JSON example.

Two call sites had no delimiter to close. `patent-analysis-report.ts` appended the joined title, abstract, and claims directly after the sentence "只输出 JSON，不要多余文字", so the last thing in the instruction area was attacker-controlled text. `workflow-helpers.ts` joined the stage material onto the description with a bare newline. `chart.ts`'s target list and `draft.ts`'s revision hint were spliced without a bound, so a long input also displaced everything else in the prompt.

The `|| '（无…）'` guards on the prior-art and comparison slots had a second failure: once the value is wrapped, an empty value produces `<data>\n\n</data>`, which is non-empty, so the guard never fires and the fallback prose never reaches the model.

## Decision

`packages/patent/patent-core/src/prompt-hygiene.ts` exports `dataBlock(value: unknown): string`, which serializes the value with `JSON.stringify` and returns it inside `<data>…</data>`, replacing every `</` with `<\/`. Newlines, quotes, and backslashes become JSON escapes; a literal `</data>` cannot appear inside the block. `<\/` is the JSON escape for `/`, so `JSON.parse` on the block's contents restores the original text exactly.

A single `<` outside a closing sequence is left as written. The prompts are quoted verbatim in some places — `厚度<5mm 且强度≥3MPa` must reach the model with its `<` intact — so escaping every `<` would trade a real injection surface for a false one and change what those prompts say.

`JSON.stringify` is declared to return `string` but returns `undefined` for `undefined`, functions, and symbols. The implementation narrows the result rather than casting, and falls back to the empty string, so `dataBlock(undefined)` yields an empty block and `dataBlock(null)` yields the literal `null`.

The four guards whose value is now wrapped — `inventiveness.ts`'s prior art, and `novelty.ts`'s prior art, comparison result, and numeric facts — test `value.length > 0` instead of relying on `||`, because the wrapped form is never falsy.

All 33 production call sites in 12 files go through `dataBlock`: the 9 builtin handlers and graph domains in `patent-core`, and `analyze-patent-figure.ts`, `patent-analysis-report.ts`, and `workflow-helpers.ts` in `patent-tools`. The module declares the rule for future call sites in its header: text from outside the instruction area goes through `dataBlock`, never spliced in as plain text.

No truncation was added at the four call sites that had none. Isolation and bounding are separate concerns, and the four sites differ in why they lack a bound: the chart target list is already bounded by its producer, the analysis-report text is bounded by the report's own input validation, and the workflow stage material and the revision hint are as long as the stage produced. Adding a bound would change what the model sees in a change whose subject is escaping, and would do so without a measured need.

## Alternatives considered

**Escape every `<` in the payload.** Rejected: prompts quote user text verbatim for technical comparison, and `厚度<5mm` is a legitimate payload. Only the `</` sequence can leave the block, so only it is escaped.

**Add a length bound while wrapping.** Rejected: it changes the model's visible input beyond the escaping fix, at sites whose unbounded-ness is deliberate or already handled upstream. A later change that needs a bound can add one on its own evidence.

**Keep the ` ``` ` fences and escape the fence characters inside the payload.** Rejected: a fence has no escape mechanism, so what the payload must avoid is whatever the parser treats as a delimiter, and the payload cannot be checked for that at every call site. A delimiter with an escape (JSON string inside an XML-ish tag) makes the payload's safety a property of the wrapper instead.

**Wrap only `patent-analysis-report.ts`, the one site with no delimiter and an adjacent instruction.** Rejected: the other sites' bare fences are injectable by the same payload, and a fix that leaves the majority of call sites on the injectable form is not one a later reader can rely on.

**Use a delimiter the model is assumed not to produce.** Rejected: an assumption about model behaviour is not a property of the encoding, and the payload's author is not the model.

## Consequences

A payload that contains `</data>`, a fence, or an instruction block reaches the model as a single escaped JSON string. Nothing inside the block can end it early, because the only sequence that ends it cannot appear inside.

Prompt text changed wherever a call site was converted, so this is a model-visible change. The four previously unbounded call sites now carry a block boundary but no length bound; their input length is unchanged.

`dataBlock` is exported from `@deepseek-ai/dsh-patent-core`, so `patent-tools` reaches it across the package boundary rather than reimplementing it.

The methodology components' template-literal interpolation of `context.goal` is untouched. That gap is present upstream as well; it is a shared gap, not a port omission, and closing it belongs with the components rather than here.

## Testing

`packages/patent/patent-core/tests/prompt-hygiene.spec.ts` — text round-trips through the block and back via `JSON.parse`; newlines, quotes, and backslashes do not break the block; a fabricated `</data>` is escaped and cannot terminate the data section; a single `<` is preserved verbatim; arrays and objects serialize the same way; `undefined` yields the empty block and `null` the literal, neither throwing.

`packages/patent/patent-tools/tests/workflow-chain-stage-executor.spec.ts` — the two assertions that pinned the old fence form now pin the data block, covering the stage-material call site end to end.

## Related

- [Sati patent domain as dsh plugins](../feature/2026-08-17-sati-patent-domain-dsh-plugins.md) — the port this package belongs to.
