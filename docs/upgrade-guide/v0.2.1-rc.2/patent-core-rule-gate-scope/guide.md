---
kind: upgrade-guide
description: "`ruleGateNode` evaluates only declared source keys, blocks on missing/empty/degraded reports, and writes one structured `rule_gate` state entry instead of `rule_gate_*` keys."
---

# Patent-core scopes the rule gate to declared source keys

English | [中文](guide.zh.md)

## Change

`ruleGateNode` now takes a single options object: `ruleGateNode({ domains, sourceKeys, evaluator })`. It builds the evaluated text from `sourceKeys` only and no longer scans the whole graph state. An empty `sourceKeys` list is a configuration error and throws at graph build time.

The three patentability builders declare their final-report keys: `novelty_report` for novelty, `inventiveness_conclusion` for inventiveness, and `enablement_conclusion` for enablement. Raw input, intermediate LLM output, and stale state entries no longer reach the rule evaluator. Previously a banned phrase in the user's technical description could fail the gate even when the generated report was clean.

Any declared source that is missing, empty, non-textual, or carries a `<key>__degradation` mark now blocks the gate with `RULE-GATE-SOURCES-UNAVAILABLE` before the evaluator runs. A degraded LLM stage often writes an empty or diagnostic fallback that the old text collector skipped, so the gate could report `pass` with no report to evaluate.

The six flat audit keys (`rule_gate_verdict`, `rule_gate_domains`, `rule_gate_failures`, `rule_gate_evaluator`, `rule_gate_rules_evaluated`, `rule_gate_text_length`) are replaced by one `rule_gate` state entry:

| Field | Meaning |
| --- | --- |
| `status` | Gate decision: `pass`, `fail` (rules failed), or `blocked` (sources unusable or evaluation impossible). |
| `verdict` | Evaluator verdict: `pass`, `needs_revision`, or `blocked`. |
| `domains` | Declared rule domains. |
| `failures` | Failed rules with messages and fix suggestions. |
| `evaluator` | Evaluator identifier. |
| `evaluatedRules` | Rules that ran; `0` when the gate blocked before evaluation. |
| `evaluatedKeys` | Source keys included in the evaluated text. |
| `degradedSources` | Declared source keys that could not be evaluated because they were missing, empty, non-textual, or degraded. |

`patent_workflow_run` renders the decision as `规则门 status: <status>` instead of `规则门 verdict: <verdict>` and omits the raw `rule_gate` entry from its key list.

External code that calls `ruleGateNode` with positional arguments, reads the removed `rule_gate_*` keys, or parses the old `patent_workflow_run` line stops compiling, reads `undefined`, or needs the new label.

## Migration

1. Replace `ruleGateNode(domains, evaluator)` with `ruleGateNode({ domains, sourceKeys, evaluator })`, listing only the final outputs the rules should evaluate.
2. Read `graphState.rule_gate` instead of the `rule_gate_*` keys. Use `status` for the gate decision and `verdict` for the evaluator's own grading.
3. Treat `blocked` as "no decision": inspect `degradedSources`, restore the missing source, and rerun rather than mapping it to a pass.
4. If you parse `patent_workflow_run` output, match `规则门 status:` and expect `pass`, `fail`, or `blocked`.
5. Confirm: `pnpm exec vitest run packages/patent/patent-core packages/patent/patent-rule packages/patent/patent-tools` passes, and a gated graph run without an LLM provider ends with `rule_gate.status === 'blocked'`.
