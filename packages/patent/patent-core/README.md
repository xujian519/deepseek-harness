---
description: "Pure TypeScript library (no `ctx` dependency) holding the patent-domain engines ported from Sati: the atoms `StageProvider`/`StageHandler` vocabulary with its eleven builtin handlers, the `PatentModelPort` LLM adapter, the dual-track checker rule engine, the atomic technical-problem checks, the evidence closed-loop ledger and judgment engine, the structured reasoning primitives, the claim-chart engine, the Pregel-style graph engine with its four patentability domain subgraphs (novelty, inventiveness, enablement, citation-check), the constitutional rule protocol types plus text utilities, the IPC classifier and examination-standards lookup, and the persistence/path helpers."
kind: "package-reference"
---

# @deepseek-ai/dsh-patent-core

English | [中文](README.zh.md)

## Summary

Pure TypeScript library (no `ctx` dependency) holding the patent-domain engines ported from Sati: the atoms `StageProvider`/`StageHandler` vocabulary with its eleven builtin handlers, the `PatentModelPort` LLM adapter, the dual-track checker rule engine, the atomic technical-problem checks, the evidence closed-loop ledger and judgment engine, the structured reasoning primitives, the claim-chart engine, the Pregel-style graph engine with its four patentability domain subgraphs (novelty, inventiveness, enablement, citation-check), the constitutional rule protocol types plus text utilities, the IPC classifier and examination-standards lookup, and the persistence/path helpers.

## Table of Contents

- [Atoms engines](#atoms-engines)
- [ModelPort](#modelport)
- [Checker (dual-track deterministic rule engine)](#checker-dual-track-deterministic-rule-engine)
- [Problem (atomic technical-problem checks)](#problem-atomic-technical-problem-checks)
- [Evidence (closed-loop ledger + judgment engine)](#evidence-closed-loop-ledger--judgment-engine)
- [Reasoning (fact blackboard + syllogism)](#reasoning-fact-blackboard--syllogism)
- [Claim-chart runtime](#claim-chart-runtime)
- [Graph engine](#graph-engine)
- [Rule protocol + IPC](#rule-protocol--ipc)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Atoms engines

The atoms layer defines the workflow stage vocabulary: `Atom`/`AtomRegistry` (declarative contract) and `StageHandler`/`StageHandlerRegistry` (runtime), with builtin handlers for search, keywords, extract, merge, compare, novelty, reasoning, groundedness, draft-claims, approval-gate, and claim-chart. `registerBuiltinAtoms()` registers all eleven; a host injects a `StageProvider` (a `callLLM` string seam or a streaming `llm` port, plus `search`) that the handlers consume and degrade over instead of throwing.

## ModelPort

`PatentModelPort.stream(request, signal?)` is the canonical streaming LLM vocabulary. `createLlmModelPort(stream, { provider, model })` adapts the harness `LlmRuntime.stream(options: GenerateOptions)` into it, and `collectPortText` bridges the port back to the string the LLM-dependent atoms use. Provider selection stays with the harness `ctx.llm` adapters and the `agent/request` waterfall (the Sati router is not ported).

## Checker (dual-track deterministic rule engine)

`RuleEngine` evaluates domain-scoped `CheckRule`s over analysis text — novelty single-comparison, inventiveness three-step, infringement full-coverage, disclosure sufficiency, spec-checklist, and the 24 reasoning-pattern rules — with synonym expansion plus negation detection; `aggregate` maps failures to `pass`/`needs_revision`/`blocked`, and `defaultPatentRules()` registers all 71 rules.

## Problem (atomic technical-problem checks)

`checkAtomic` runs the four deterministic checks on the actual technical problem (no solution binding, single causality, measurable effect, means reversibility), and `technicalProblemCheck` wires them into checker `customCheck` rules.

## Evidence (closed-loop ledger + judgment engine)

The evidence layer records tool receipts (`Ledger`/`receiptFromToolExecution`), lifts them into locatable `EvidenceSpan`s, binds conclusions, detects conflicts, and runs the three-attribute plus type-specific judgment (`EvidenceEngine`) with burden-of-proof and proof-standard assessment.

## Reasoning (fact blackboard + syllogism)

`FactBlackboard` shares facts, rule constraints, and article judgments across reasoning steps (soft-discard backtracking, lock protection), and `SyllogismBuilder`/`ruleAssertion` enforce that every conclusion cites a blackboard fact and statute.

## Claim-chart runtime

`validateElements`/`validateRowMapping`/`detectGaps`/`validatePinCite` validate the element grid, and `saveClaimChart`/`loadClaimChart`/`renderChartMarkdown` persist and render it (backed by the shared `JsonFileStore` helpers).

## Graph engine

`GraphBuilder`/`CompiledGraph` run a Pregel-style superstep (BSP) engine: nodes read a deep-copied state snapshot and return a delta, merged deterministically by `Reducer` (last-write-wins/append/union/merge-map/fail-on-conflict). `NodePolicy` adds retry, timeout, and side-effect handling; `GraphInterruptError` pauses for approval gates; `runGraphWithCheckpoints`/`grantApproval` persist per-superstep checkpoints and resume. `buildNoveltyGraph`/`buildInventivenessGraph`/`buildEnablementGraph` assemble the three patentability subgraphs (novelty, inventiveness, enablement) with deterministic nodes, LLM nodes, and a checker `rule_gate` closeout; `buildCitationCheckGraph` is a deterministic pure-function graph that verifies every citation in the conclusion text (patent numbers or D<id>/对比文件N labels) appears in the `prior_art` state; `manifestToGraph` bridges a `WorkflowManifest` into a graph.

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

### Dev Note

None.

No companion is published because the library is pure computation over caller-owned inputs and owns no durable package-local state with observations that could independently diverge.
