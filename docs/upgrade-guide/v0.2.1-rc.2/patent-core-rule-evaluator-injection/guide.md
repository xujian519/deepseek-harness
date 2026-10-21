---
kind: upgrade-guide
description: "`@deepseek-ai/dsh-patent-core` drops the checker corpus and default rule evaluator; rule-gate graphs now require an injected `RuleEvaluator` from `@deepseek-ai/dsh-patent-rule`."
---

# Patent-core requires an injected rule evaluator

English | [中文](guide.zh.md)

## Change

`@deepseek-ai/dsh-patent-core` no longer exports `createDefaultRuleEvaluator()`, `DEFAULT_RULE_EVALUATOR_ID`, or the checker corpus builders (`defaultPatentRules()` and the per-family builders such as `noveltyRules()`, `specRules()`, and `reasoningPatternRules()`). The 71-rule corpus now ships from `@deepseek-ai/dsh-patent-rule`, which exposes it through `createCheckerRuleEvaluator()`.

`buildNoveltyGraph`, `buildInventivenessGraph`, and `buildEnablementGraph` require an injected evaluator whenever the rule gate is enabled (`ruleGate !== false`); `ruleGateNode` takes the evaluator as a required option and cannot be constructed without one. Building a gated graph without it throws `未注入 ruleEvaluator`; previously the builders fell back to the removed core evaluator. `patent_workflow_run` accepts an optional `ruleEvaluator` dependency, and graph-mode runs fail at graph build when it is absent.

Everything inside this repository is updated in the same change and behaves as before. External code that imported a removed symbol, called a graph builder with the gate enabled, or mounted `patent_workflow_run` through its own wiring stops compiling or throws at run time.

## Migration

1. Add `@deepseek-ai/dsh-patent-rule` to your dependencies and import the corpus and `createCheckerRuleEvaluator()` from it instead of `@deepseek-ai/dsh-patent-core`.
2. Build a gated graph with `buildNoveltyGraph({ ruleEvaluator: createCheckerRuleEvaluator() })` (likewise for the inventiveness and enablement builders), or pass `ruleGate: false` to omit the gate.
3. Pass `ruleEvaluator: createCheckerRuleEvaluator()` wherever your composition root constructs `createPatentWorkflowRunTool`.
4. Confirm: `pnpm exec tsc --noEmit` reports no missing export, and `pnpm exec vitest run packages/patent/patent-core packages/patent/patent-rule packages/patent/patent-tools` passes. A gated build without an evaluator must throw `未注入 ruleEvaluator` rather than silently skip the gate.
