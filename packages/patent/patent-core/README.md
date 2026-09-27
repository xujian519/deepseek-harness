---
description: "Pure TypeScript library (no `ctx` dependency) holding the patent-domain engines ported from Sati: the `StageProvider`/`StageHandler` atoms with fourteen builtin handlers, the `PatentModelPort` adapter, the dual-track checker, the technical-problem checks, the TRIZ contradiction analysis, the evidence ledger and judgment engine, the reasoning primitives, the claim-chart engine, the claim-drafting self-checks, the numeric-range novelty check, the procedure-document parsers, the response plan and reexamination sections, the infringement kernel (all-elements coverage, equivalence consistency, risk grading), the Pregel-style graph engine with four patentability subgraphs, the rule protocol and text utilities, the IPC classifier and standards lookup, and persistence/path helpers."
kind: "package-reference"
---

# @deepseek-ai/dsh-patent-core

English | [中文](README.zh.md)

## Summary

Pure TypeScript library (no `ctx` dependency) holding the patent-domain engines ported from Sati: the `StageProvider`/`StageHandler` atoms with fourteen builtin handlers, the `PatentModelPort` adapter, the dual-track checker, the technical-problem checks, the TRIZ contradiction analysis, the evidence ledger and judgment engine, the reasoning primitives, the claim-chart engine, the claim-drafting self-checks, the numeric-range novelty check, the procedure-document parsers, the response plan and reexamination sections, the infringement kernel (all-elements coverage, equivalence consistency, risk grading), the Pregel-style graph engine with four patentability subgraphs, the rule protocol and text utilities, the IPC classifier and standards lookup, and persistence/path helpers.

## Table of Contents

- [Atoms engines](#atoms-engines)
- [ModelPort](#modelport)
- [Checker (dual-track deterministic rule engine)](#checker-dual-track-deterministic-rule-engine)
- [Problem (atomic technical-problem checks)](#problem-atomic-technical-problem-checks)
- [TRIZ contradiction analysis (inventor side)](#triz-contradiction-analysis-inventor-side)
- [Evidence (closed-loop ledger + judgment engine)](#evidence-closed-loop-ledger--judgment-engine)
- [Reasoning (fact blackboard + syllogism)](#reasoning-fact-blackboard--syllogism)
- [Claim-chart runtime](#claim-chart-runtime)
- [Claim-coverage checks](#claim-coverage-checks)
- [Numeric-range novelty check](#numeric-range-novelty-check)
- [Notice parsing](#notice-parsing)
- [Response preparation](#response-preparation)
- [Infringement kernel](#infringement-kernel)
- [Graph engine](#graph-engine)
- [Rule protocol + IPC](#rule-protocol--ipc)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Atoms engines

The atoms layer defines the workflow stage vocabulary: `Atom`/`AtomRegistry` (declarative contract) and `StageHandler`/`StageHandlerRegistry` (runtime), with builtin handlers for search, keywords, extract, merge, compare, novelty, reasoning, groundedness, draft-claims, approval-gate, and claim-chart, plus the deterministic (model-free) `oa-parse` (office-action parsing), `grounds` (procedure grounds), and `coverage` (all-elements and equivalence check) added for the office-action, invalidation, and infringement workflows. `registerBuiltinAtoms()` registers all fourteen; a host injects a `StageProvider` (a `callLLM` string seam or a streaming `llm` port, plus `search`) that the handlers consume and degrade over instead of throwing.

## ModelPort

`PatentModelPort.stream(request, signal?)` is the canonical streaming LLM vocabulary. `createLlmModelPort(stream, { provider, model })` adapts the harness `LlmRuntime.stream(options: GenerateOptions)` into it, and `collectPortText` bridges the port back to the string the LLM-dependent atoms use. Provider selection stays with the harness `ctx.llm` adapters and the `agent/request` waterfall (the Sati router is not ported). The port also carries `route` (which provider/model answered) and `bindSession(sessionId)`, which rebinds it so every request identifies its session — a tool that calls the model from inside its own body binds the session first, so the call is attributable and recordable instead of anonymous.

## Checker (dual-track deterministic rule engine)

`RuleEngine` evaluates domain-scoped `CheckRule`s over analysis text — novelty single-comparison, inventiveness three-step, infringement full-coverage, disclosure sufficiency, spec-checklist, and the 24 reasoning-pattern rules — with synonym expansion plus negation detection; `aggregate` maps failures to `pass`/`needs_revision`/`blocked`, and `defaultPatentRules()` registers all 71 rules.

## Problem (atomic technical-problem checks)

`checkAtomic` runs the four deterministic checks on the actual technical problem (no solution binding, single causality, measurable effect, means reversibility), and `technicalProblemCheck` wires them into checker `customCheck` rules.

## TRIZ contradiction analysis (inventor side)

`extractTrizContradictions(port, text, { focus })` runs one model call that recognizes technical contradictions (improving one engineering parameter while sacrificing another) and the engineering parameters a disclosure names without quantifying (a missing current value, target value, unit, or test method). `buildTrizAnalysis(extraction, sourceText)` assembles the result deterministically: it accepts only integer parameter numbers 1-39, resolves each pair against the 39x39 contradiction matrix shipped in `@deepseek-ai/dsh-methodology` (a diagonal cell is a physical contradiction, an empty cell a transcription gap), takes every parameter and principle name from the shipped assets instead of the model output, and **drops any contradiction whose evidence cannot be located verbatim in the disclosure text**, counting the drops.

The product is inventor-side: candidate solution directions and a disclosure gap checklist. A contradiction pair is not a three-step-step-2 problem statement — that problem is determined from the distinguishing features and must not contain the solution means (`checkAtomic`); feeding a contradiction into that field breaks the rule.

## Evidence (closed-loop ledger + judgment engine)

The evidence layer records tool receipts (`Ledger`/`receiptFromToolExecution`), lifts them into locatable `EvidenceSpan`s, binds conclusions, detects conflicts, and runs the three-attribute plus type-specific judgment (`EvidenceEngine`) with burden-of-proof and proof-standard assessment.

## Reasoning (fact blackboard + syllogism)

`FactBlackboard` shares facts, rule constraints, and article judgments across reasoning steps (soft-discard backtracking, lock protection), and `SyllogismBuilder`/`ruleAssertion` enforce that every conclusion cites a blackboard fact and statute.

## Claim-chart runtime

`validateElements`/`validateRowMapping`/`detectGaps`/`validatePinCite` validate the element grid, and `saveClaimChart`/`loadClaimChart`/`renderChartMarkdown` persist and render it (backed by the shared `JsonFileStore` helpers).

## Claim-coverage checks

`checkClaimUnity` scores the unity of a claim set (A31.1): it strips structural boilerplate from the independent claims, compares every pair by character overlap, Jaccard, and bigram cosine, and takes the weakest pair. `score` is that weakest pair's similarity as a percentage, `grade` follows the same lines (`good` at 0.8 and above, `fair` at 0.6, `poor` below), and `hasUnity` is false when any pair falls under the 0.6 similarity threshold. The threshold and weights are a heuristic carried from the upstream `unity.yaml` specification, not a statutory figure; the verdict supports drafting self-review and leaves the legal judgment to the attorney.

`checkEmbodimentCoverage` builds the claim-to-embodiment coverage matrix: each entry supplies a claim id, its features, and the embodiment references that support it, and the module computes full/partial/none coverage by whole-feature containment. A caller-supplied coverage verdict is not an input — the conclusion comes only from the two fact columns, and an entry with no feature at all is rejected (`features 为空`) rather than reported as full or none, since both readings are vacuous. Numbering gaps are reported only when every entry id is valid, because an invalid entry's intended number is unknown. Feature counts are deduplicated, so a repeated feature no longer inflates the covered count (the upstream implementation counted the raw list).

## Numeric-range novelty check

`analyzeNumericRanges` extracts numbers from claim and prior-art text, judges interval overlap deterministically (overlapping ranges or a shared endpoint destroy novelty; a value point strictly inside a prior-art range without a shared endpoint does not), and reports `overlapped`/`inside_without_endpoint`/`no_overlap`/`inconclusive`. Ranges accept the unit before the separator (`20℃至90℃`, `5mg-10mg`) as one interval; the separator and unit vocabulary is shared with `validate_specification` (`src/novelty/numeric-vocabulary.ts`) so the two paths cannot read one text differently, while that checker additionally requires a trailing unit because it compares same-unit single values against the endpoints. Only findings followed by a recognized unit count as strong findings and enter the judgment; the Chinese unit vocabulary is closed, because a greedy two-character match would otherwise read words like 任一 or 公开 as units and turn claim numbering into a parameter. `crossCheckNumericVerdict` compares the verdict with the one the LLM track returns and marks agreement; any concrete disagreement is marked `disagree` and the summary asks for review (the upstream implementation marked only one direction of disagreement). The novelty subgraph's `numeric_range` node runs this track beside the LLM track and writes `numeric_range_verdict`, `numeric_range_agreement`, and `numeric_range_deterministic` into the state, so the deterministic conclusion survives an LLM outage.

## Notice parsing

`parseOfficeAction` turns an office-action text into structured facts with keyword tables and regular expressions only: the rejection grounds it cites (deduplicated, ordered by first appearance), the cited prior-art documents with the relevance class annotated right after the document number and the claim numbers mentioned in the same sentence, the claim numbers the text refers to (ranges written as `权利要求1至3` or `第1-5项` expanded, so page and paragraph ranges such as `第2-3页` stay out), and up to five examiner-argument sentences. A patent number the text attributes to the case itself (`本申请公开号CN…`, `CN…（本申请）`) is not a citation and stays out of the document list. `identifyInvalidationGrounds`, `identifyReexaminationGrounds`, and `identifyDesignGrounds` read the ground tables of the three procedures — five invalidation grounds, the six reexamination grounds including the utility-model subject-matter one, and the three design grounds of Article 23 — each carrying its statutory article and a Chinese label; `detectPatentSubject` reports the patent subject the document states and leaves it `undetermined` rather than defaulting to an invention. Divergences from upstream: relevance is reported only when annotated (upstream fell back to `A`, asserting "background art only" as a fact), a document's claims come from same-sentence occurrence instead of staying empty, arguments are cut by code point instead of by byte, 公开不充分 is recognized (upstream's list held only 公开充分/充分公开/能够实现, so the commonest wording was missed), an unmatched ground table returns an empty list instead of fabricating a novelty ground, and a utility model keeps the inventiveness ground (upstream removed it without a stated basis). Nothing in this module produces a legal conclusion.

## Response preparation

`buildResponsePlan(notice, { independentClaims })` turns a parsed office action into the skeleton of the reply: one section per rejection ground with its strategy (argument, amendment, or both), the argument paragraphs it must answer, and one amendment row per (amendment ground × claim mentioned), each carrying the amendment action — chosen for an independent or a dependent claim — and the statutory basis. `REJECTION_STRATEGY`, `REJECTION_AMENDMENT_ACTIONS`, `REJECTION_SECTIONS`, and `REJECTION_BASIS` are closed tables over the rejection types, and `summarizeStrategies` renders the `创造性→争辩、不清楚→修改` summary line. Gaps that the notice cannot settle are reported instead of assumed: no ground recognized, an amendment ground without any claim number, or amendment grounds touching no independent claim. `buildReexaminationPreparation(findings, { oralHearing })` returns the reexamination sections — the feature-comparison table columns, the Article 33 non-extension items and bases, and, only when an oral hearing is scheduled, the panel's likely questions per ground and the four-phase hearing timeline. Divergences from upstream: the amendment table has one row per claim (upstream judged the action from the first affected claim number only, so dependent-claim actions never applied), an unknowable amendment target is reported rather than defaulted to claim 1, the Article 33 section is identical whether or not that ground was raised (the reply may still amend), comparison tables carry columns and no placeholder rows, and the hearing sections sit behind an explicit switch that defaults to off — upstream's `oralHearing` was never set, so both sections were unreachable.

## Infringement kernel

`deriveAllElementsCoverage(rows, targetId, elements)` applies the all-elements rule to claim-chart mappings for the accused product: elements mapped literally, elements whose literal match depends on claim construction, elements that only an equivalence mapping covers, and elements with neither (a missing element defeats coverage). `findEquivalenceContradictions(rows, triplets)` cross-checks the chart against the equivalence findings supplied separately — a `doe` row without a finding, two findings for one element and target, a finding that denies equivalence, equivalence claimed while means, function, and effect are all found different, equivalence claimed while inventive effort is still required, and equivalence found but left unmapped. `scoreInfringement(input, weights?)` grades the case: five weighted dimensions summed in a fixed order, a risk level from the 0.7 and 0.4 ratios taken over the weight range, and the thresholds in the result. Divergences from upstream: literal and equivalent coverage form one dimension (upstream weighted them apart, so full literal coverage scored 0.25 and graded low), the `strategy_viability` dimension is gone (it counted the priority of the assistant's own recommendations), the damage ceiling is a caller-supplied ratio instead of a hardcoded ten million, the summation order is fixed rather than following Go map iteration, and invalid weights or an out-of-range ratio throw instead of scoring.

## Graph engine

`GraphBuilder`/`CompiledGraph` run a Pregel-style superstep (BSP) engine: nodes read a deep-copied state snapshot and return a delta, merged deterministically by `Reducer` (last-write-wins/append/union/merge-map/fail-on-conflict). `NodePolicy` adds retry, timeout, and side-effect handling; `GraphInterruptError` pauses for approval gates; `runGraphWithCheckpoints`/`grantApproval` persist per-superstep checkpoints and resume. `buildNoveltyGraph`/`buildInventivenessGraph`/`buildEnablementGraph` assemble the three patentability subgraphs (novelty, inventiveness, enablement) with deterministic nodes, LLM nodes, and a checker `rule_gate` closeout; the novelty subgraph's `numeric_range` node carries the deterministic numeric-range track next to the LLM one; `buildCitationCheckGraph` is a deterministic pure-function graph that verifies every citation in the conclusion text (patent numbers or D<id>/对比文件N labels) appears in the `prior_art` state; `manifestToGraph` bridges a `WorkflowManifest` into a graph.

## Rule protocol + IPC

The constitutional rule engine protocol types (`RuleSeverity`/`RuleAction`/`RuleCheck`/`ConstitutionalRule`/...) and the `hasNegationContext`/`parseCnNumber` text utilities ship here for the P3.1/P4.1 rule gates. The IPC classifier (`classifyIpc`/`classifyIpcTop`) and the `ipc-standards.yaml` examination-standard loader ship as pure lookups.

## Model Experience

None, as The library is pure computation for the workflow and tool layer; every model-facing schema and result is owned by its consumers.

#### KV Cache effect

Independent; the library contributes no model-visible content, so it never populates or invalidates a reusable KV-cache prefix.

## Known Limitations and Deferred Work

- **Pure library, no `ctx`** — the package registers nothing; a host or consumer composes the engines into the workflow (P3.1) and tool (P3.2) layers.
- **ModelPort adapter needs the injected stream** — `createLlmModelPort` adapts a caller-supplied `LlmRuntime.stream`; patent-core does not own provider selection or a live `ctx.llm`.
- **Evidence rule assets are stubbed** — `loadEvidenceRulesEngine(ruleDirs?)` takes explicit directories and returns the default-weight engine when none are given; the real rule pack resolves through `dsh-patent-rule` (P4.1).
- **IPC data bundles as an asset** — `ipc-standards.yaml` ships at `assets/` and resolves through `import.meta.url` from both source and built lib.
- **Checkpoint stays file-based** — `JsonFileCheckpointStore` persists per-superstep checkpoints through the shared `JsonFileStore`; the `ctx.storage` seam lands with workflow integration (P3.1).
- **Graph is pure computation** — the superstep engine and the domain subgraphs run in-process with no `ctx`; LLM and search capabilities arrive through the injected `StageProvider`.
- **Claim unity is a similarity indicator** — the score and grade come from a weighted lexical similarity over boilerplate-stripped claim text; the module reports no legal conclusion, and a `fair` or `poor` score means the claim set needs attorney review rather than that unity is absent.
- **Numeric-range extraction recognizes a closed unit vocabulary** — Latin/symbol units plus a listed set of Chinese units; a number written with any other unit (or none) stays a weak finding and cannot move the verdict, so the check errs toward `inconclusive`.
- **Notice parsing is lexical** — the ground tables carry upstream's broad keywords (清楚, 支持), so a hit means the document mentions that article rather than that the ground is substantiated; relevance and per-document claims come from the text around the document number, not from the examiner's authoritative mapping.
- **Response preparation plans, it does not argue** — the plan states which grounds must be answered, which claims must be amended, and which gaps the notice leaves; claiming priority, actual amendments, and the merits stay with the attorney.
- **Infringement equivalence is caller-supplied** — means/function/effect findings are inputs the module cross-checks for consistency; it neither decides equivalence nor substitutes an unpublished damage ceiling for the caller's ratio.
- **LLM cross-check needs the `verdict` field** — the numeric-range node reads `verdict` from the LLM JSON; a response without it leaves the agreement at `n_a` instead of guessing.

### Dev Note

None.

No companion is published because the library is pure computation over caller-owned inputs and owns no durable package-local state with observations that could independently diverge.
