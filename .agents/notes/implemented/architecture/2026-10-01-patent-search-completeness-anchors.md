# Agent Note: A patent search report declares its naming families and orthogonal dimensions

Status: implemented

English | [中文](2026-10-01-patent-search-completeness-anchors.zh.md)

## Problem

A completed search task could satisfy `patent-search-commander`'s output contract without declaring how its retrieval anchors were chosen. The contract required `检索式`, `对比文件`, and `公开日`, which bind a report's sources and dates but say nothing about the completeness of the search's own vocabulary.

The cost is measurable. In case 2026-UM-002 a six-round prior-art search derived every retrieval expression from the invention's own claim wording. A red team searching a different name for the same function then recovered two 2017 documents the six rounds had missed, and each of the case's five selected directions turned out to be disclosed by a single reference. Zero of the six rounds ran an IPC dimension, although the worker description already instructed `先经 patent_analysis_report 做 IPC 分类并取得建议检索策略` — the instruction lived in prose, and prose has no executor.

Two properties of the gating machinery make the contract the place to fix this. `workerDeliverables()` derives a role's `Required deliverables` persona line from the same `requiredFields` list, and `runQualityGate()` runs `validateWorkerOutput()` against that list at the `completed` transition, returning an incomplete submission to `in_progress`. One declaration therefore both tells the member what to produce and enforces it.

## Decision

`patent-search-commander.outputs[0].requiredFields` requires `命名族清单` and `正交维度` in addition to `检索式`, `对比文件`, and `公开日`. A search task reaches `completed` only when its report declares, for each searched function, at least three distinct word families that Chinese prior-art documents use for it, and names which orthogonal dimensions it ran: IPC/CPC, applicant lookup, citation or family expansion, non-patent literature. The `researcher` role description states the same order — families and dimensions before the IPC-classified Boolean expressions.

The fields force a declaration, not a judgement. `validateWorkerOutput()` matches substrings, so whether a declared family set is exhaustive stays a red-team or human call. What the gate removes is silent omission.

## Alternatives considered

**Put the discipline in the `search-commander` skill only.** It is there and stays there, carrying the six anchor rules and the three claim-form questions. A skill is advisory: the harness loads it when the model invokes the `skill` tool, and in case 2026-UM-002 the model listed the skill among the available skills and did not load it. The worker description's IPC instruction is the same failure one layer down.

**Validate the input contract instead.** `WorkerInputContract.contentSchema` is declared and documented, and no code validates it; `WorkerRegistry.verify()` likewise has no production caller. An input-side precondition needs a new validation path and a call site per task, which is a larger change than the fields the existing gate already checks.

**Require a structured anchor record.** `requiredFields` matches substrings and has no parser. A structured requirement — family lists with their dimension outcomes — needs a schema and its own validation path.

## Testing

| Evidence | Behaviour |
|---|---|
| [worker-contract.spec.ts](../../../../packages/patent/patent-workflow/tests/worker-contract.spec.ts) | Against the shipped contract, a report carrying sources and dates alone yields `missingHardFields` `['命名族清单', '正交维度']`; a report declaring families and dimensions validates clean. |
| [role-contracts.spec.ts](../../../../packages/patent/patent-workflow/tests/role-contracts.spec.ts) | `workerDeliverables('researcher')` joins the five fields, so the persona line carries the new deliverables. |
| [service.spec.ts](../../../../packages/patent/patent-teams/tests/service.spec.ts) | Under `qualityGate: true`, a contract-complete submission is admitted and a contract-incomplete one bounces with `契约缺字段`. |

## Consequences

- A search report that declared only sources and dates now bounces until it declares both anchors. The gate runs where `qualityGate` is enabled; the default is `false`.
- The fields are Chinese literals matched as substrings, so a report uses those section names verbatim. Renaming a heading is a contract change.
- `validateWorkerOutput()`, `runQualityGate()`, and `workerDeliverables()` are unchanged; the fix is the field list plus the role description.
- The gate cannot verify that a declared family set is exhaustive. The declaration records what was searched; it does not certify completeness.
