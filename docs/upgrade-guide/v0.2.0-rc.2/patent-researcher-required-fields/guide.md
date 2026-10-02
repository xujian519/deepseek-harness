---
kind: upgrade-guide
description: "The patent-search-commander search report now requires 命名族清单 and 正交维度 alongside 检索式、对比文件、公开日; a report missing them is returned to in_progress instead of completing."
---

# Researcher search reports must declare naming families and orthogonal dimensions

English | [中文](guide.zh.md)

## Change

`patent-search-commander`'s `search-report.md` output contract (`data/cases/<caseId>/outputs/`) gains two required fields:

```
requiredFields: ['检索式', '对比文件', '公开日', '命名族清单', '正交维度']
```

`runQualityGate()` runs `validateWorkerOutput()` at the `completed` transition and matches each field as a substring of the report. Where `qualityGate` is enabled — the shipped `patent` preset enables it — a search task whose report lacks either new string no longer completes: it returns to `in_progress` with `missingHardFields` naming `命名族清单` and/or `正交维度`. Under the default `qualityGate: false` the check does not run. Reports that already declare both fields are unaffected.

The `researcher` role's persona line follows the same list — `workerDeliverables('researcher')` now reads `检索式、对比文件、公开日、命名族清单、正交维度`, and the role table in `patent-team-composition` lists the same deliverables.

The fields force a declaration, not a judgement: whether a declared family set is exhaustive stays a red-team or human call. What the gate removes is silent omission — a report that derived every retrieval expression from the invention's own claim wording, or that ran no IPC/CPC, applicant, or citation dimension, previously satisfied the contract.

## Migration

1. A report written with only the three old fields is rejected at its next `completed` transition, which includes resumed and re-run tasks. Add a `命名族清单` section listing, for each searched function, at least three distinct word families that Chinese prior-art documents use for it; add an `正交维度` section naming the dimensions actually run: IPC/CPC, applicant lookup, citation or family expansion, non-patent literature.
2. The `search-commander` skill carries the six anchor rules and the three claim-form questions; loading it before drafting the report produces both sections.
3. Confirm: run a search task to completion and check that its report contains both headings and that the task reaches `completed` instead of returning to `in_progress`.
