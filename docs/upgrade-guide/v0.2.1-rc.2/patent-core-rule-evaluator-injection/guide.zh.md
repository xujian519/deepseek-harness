---
kind: upgrade-guide
description: "`@deepseek-ai/dsh-patent-core` 移除 checker 语料与默认规则评估器；启用规则门的图必须注入来自 `@deepseek-ai/dsh-patent-rule` 的 `RuleEvaluator`。"
---

# patent-core 要求注入规则评估器

[English](guide.md) | 中文

## 变更

`@deepseek-ai/dsh-patent-core` 不再导出 `createDefaultRuleEvaluator()`、`DEFAULT_RULE_EVALUATOR_ID`，也不再导出 checker 语料构造函数（`defaultPatentRules()` 以及 `noveltyRules()`、`specRules()`、`reasoningPatternRules()` 等按域构造函数）。71 条规则语料改由 `@deepseek-ai/dsh-patent-rule` 随包发布，并通过 `createCheckerRuleEvaluator()` 暴露。

启用规则门时（`ruleGate !== false`），`buildNoveltyGraph`、`buildInventivenessGraph`、`buildEnablementGraph` 与 `ruleGateNode` 都要求传入 `ruleEvaluator`。缺少评估器时构图抛错 `未注入 ruleEvaluator`；此前这些构造函数会回退到已移除的 core 默认评估器。`patent_workflow_run` 新增可选的 `ruleEvaluator` 依赖，图模式运行缺失时在构图期失败。

本仓库内的消费方已在同一次变更中更新，行为不变。仓库外若导入被移除的符号、以启用规则门的方式调用图构造函数，或通过自有接线挂载 `patent_workflow_run`，将无法编译或在运行时抛错。

## 迁移

1. 在依赖中加入 `@deepseek-ai/dsh-patent-rule`，改从该包导入规则语料与 `createCheckerRuleEvaluator()`，不再从 `@deepseek-ai/dsh-patent-core` 导入。
2. 以 `buildNoveltyGraph({ ruleEvaluator: createCheckerRuleEvaluator() })` 构建启用规则门的图（创造性、充分公开两个构造函数同理）；不需要规则门时传 `ruleGate: false`。
3. 在构造 `createPatentWorkflowRunTool` 的组合点传入 `ruleEvaluator: createCheckerRuleEvaluator()`。
4. 确认：`pnpm exec tsc --noEmit` 不再报缺失导出，且 `pnpm exec vitest run packages/patent/patent-core packages/patent/patent-rule packages/patent/patent-tools` 通过。启用规则门但未注入评估器的构图必须抛出 `未注入 ruleEvaluator`，而不是静默跳过规则门。
