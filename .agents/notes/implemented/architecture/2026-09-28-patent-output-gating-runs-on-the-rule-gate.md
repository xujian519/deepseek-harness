# Agent Note: Patent output gating runs on the rule gate alone

Status: implemented

English | [中文](2026-09-28-patent-output-gating-runs-on-the-rule-gate.zh.md)

## Problem

The patent preset persona promises output-level enforcement — a disclaimer on risk conclusions, human approval before conclusion-bearing deliverables, a notice on absolute phrasings. Those three responsibilities existed only in [`@deepseek-ai/dsh-patent-workflow`](../../../../packages/patent/patent-workflow/README.md)'s `PatentOutputGate` (`src/output-gate.ts`) and its `processPatentOutput` step (`src/quality-gate.ts`), and neither had a production caller. At the same time [`selectGateRules`](../../../../packages/patent/patent-rule/README.md) excluded every `PAT-*` rule on the stated ground that "the keyword gate mirrors the lists" — the same never-wired module. Each chain assumed the other executed the rules.

The gate had no seam to attach to. The loop settles one `assistant/message` per step and the documented waterfalls (`agent/pre-step`, `agent/request`, `llm/stream`, `tools/*`) do not rewrite it: `llm/stream` transforms the provider stream, which cannot express "hold this message until a human approves it". Wiring the gate would have required a new loop extension point plus an approval channel at the message level. The rule gate, by contrast, was already wired on `tools/post-execute` and consumed by `patent-teams`, and its `process()` can rewrite the text wherever a caller can rewrite output.

## Decision

The rule gate is the single executor of the compliance rules. `selectGateRules` now keeps every `keyword_blocklist` rule, so `PAT-RISK-001` (warn), `PAT-APPROVAL-001` (review), and `PAT-ABS-001` (warn) run wherever the rule gate runs:

- `tools/post-execute` for the delivery tools named in `gateToolNames` (`render_patent_document`, `draft_claims`, `draft_specification`, `validate_specification`): block hits block the call, review hits request `ctx.approval` and fail closed without an answerer, warn/log hits are logged.
- The `patentRuleGate` service consumed by `patent-teams` task completion.

The unwired side is deleted rather than kept as an ownerless API: `output-gate.ts`, `processPatentOutput` and the citation-verification mirror in `quality-gate.ts` (the wired citation check is `law_verify` in [`@deepseek-ai/dsh-patent-law`](../../../../packages/patent/patent-law/README.md)), the approval-audit store (`approval.ts`, whose only consumer was the gate), and the output-gate message vocabulary in `src/types.ts`. `ABSOLUTE_PHRASES` — the one surviving export — moved to its only consumer, `patent_eval`.

## Alternatives considered

**Wire `PatentOutputGate` into the assistant output stream.** No such seam exists. Adding one is a loop change with a new documented extension point, and the gate's deferred-persistence approval would still need a message-level approval flow the loop does not have. The rule gate already enforces the same rules on the outputs the patent mode actually delivers.

**Keep the gate and its keyword lists as a public API.** It has no consumer and its lists mirror rules the rule gate now executes; keeping it would leave the false claim in place and two copies of the same terms.

**Append the disclaimer from the post-execute warn path.** `PostToolDecision` can replace result content, so a warn hit could append the compliance block. Warn is advisory by design — appending a rule citation to every gated tool result that mentions 侵权 or 绝对 would add noise to model-visible results, and the deliverable disclaimers are owned by the render path (the template/style disclaimer in [`@deepseek-ai/dsh-doc-style`](../../../../packages/document/doc-style/README.md)), not by a gate on tool results.

## Testing

| Evidence | Behaviour |
|---|---|
| [output-gate.spec.ts](../../../../packages/patent/patent-rule/tests/output-gate.spec.ts) | The gate carries every `keyword_blocklist` rule including the three `PAT-*` keys; `PAT-APPROVAL-001` hit → `needsApproval`, `PAT-ABS-001` hit → warn. |
| [patent-compliance.spec.ts](../../../../packages/patent/patent-rule/tests/patent-compliance.spec.ts) | Every `PAT-*` keyword rule in the loaded full rule set is selected by `selectGateRules`, so no compliance keyword rule is left without an executor. |
| Patent session snapshots (`pnpm run test:snapshot -t patent`) | The gated tools' recorded results carry no approval or block keywords, so replay output is unchanged. |

## Consequences

- A `PAT-APPROVAL-001` hit on a gated delivery tool now requests approval; without an approval channel the call is blocked as before for review hits. The preset persona's "conclusion judgments need human confirmation" is enforced on those tools.
- `PAT-RISK-001` and `PAT-ABS-001` hits are logged, not appended. The disclaimer a patent deliverable carries comes from the template/style render path, and the workflow's own HITL stages remain the approval point for workflow runs.
- `PAT-CITE-001` (`citation_analysis`) stays reachable only through an explicit `rule_check`; the ported relevance mirror (R2) had no executor and is gone.
- `@deepseek-ai/dsh-patent-workflow` no longer exports `PatentOutputGate`, `processPatentOutput`, `verifyCitations`, `formatCitationWarnings`, the `ApprovalRecord` store, or the output-gate message types; `patent_eval` owns `ABSOLUTE_PHRASES`.
