---
kind: upgrade-guide
description: "`citation_analysis` rule assets may no longer declare `topics`: the field is gone from `CitationAnalysisCheck` and a rule that declares it is rejected at load instead of loading with a warning."
---

# `citation_analysis` rules reject the removed `topics` field

English | [中文](guide.zh.md)

## Change

`CitationAnalysisCheck.statutes` took `{ max, topics? }`. `topics` was parsed into the rule but no check read it: `citation_analysis` only reports an article number above `max`, and the loader added a warning saying the field did not affect judgment.

`topics` is gone. `statutes` is now `Record<string, { max: number }>`, and a rule asset that still declares `topics` under a statute does not load: the loader reports `法条 "<name>" 的 topics 不受支持（没有主题相关性判定），删除该字段后该规则才会加载` for that rule and skips it, as it does for any other invalid field. There is no topic-relevance check to enable.

The shipped rule assets never declared `topics`, so the packaged rule sets load identically. Affected are deployments that point `rulesDir` at their own assets: the rule carrying `topics` disappears from the rule set — including its `max` range check — and an external TypeScript consumer that read `statutes[name].topics` stops compiling.

## Migration

1. Delete every `topics:` block under `citation_analysis` → `statutes:` in your rule assets. A statute entry keeps only `max`:
   ```yaml
   statutes:
     专利法:
       max: 82
   ```
2. Confirm: load your rule set (`rule_check`, or `loadRuleSetFromFile` in a script) and check that the warning `的 topics 不受支持` is absent and the rule id appears in the loaded set. If a topic word list drove your own post-processing, keep it outside the rule asset; no check consumes it.
