---
kind: upgrade-guide
description: "`@deepseek-ai/dsh-patent-core` exports only its root entry and removes 93 internal runtime symbols from the root barrel; every type remains exported."
---

# Patent-core narrows its package entry and root barrel

English | [中文](guide.zh.md)

## Change

`@deepseek-ai/dsh-patent-core` no longer declares the `./src/*` export, so deep imports such as `@deepseek-ai/dsh-patent-core/src/index.ts` fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`. The pattern only resolved against a source checkout: `files` has never included `src/`. The package now exports the root entry and `./package.json`.

The root barrel keeps every type declared by the modules and exports runtime values selectively. These 93 runtime symbols are no longer exported:

- Atoms and builtin handlers: `A24_EXCEPTION_LABELS`, `CoverageHandler`, `DEFAULT_AMENDMENT_AMENDED_TEXT_KEYS`, `DEFAULT_AMENDMENT_ORIGINAL_TEXT_KEYS`, `DEFAULT_CITATION_PRIOR_ART_KEY`, `DEFAULT_CITATION_REF_TEXT_KEYS`, `DEFAULT_CONFLICTING_APPLICATIONS_KEY`, `DEFAULT_EVIDENCE_DEADLINE_KEY`, `DEFAULT_EVIDENCE_FILING_DATE_KEY`, `DEFAULT_EVIDENCE_KEY`, `DEFAULT_EVIDENCE_PRIORITY_DATE_KEY`, `DEFAULT_EVIDENCE_REFERENCE_DATE_KEY`, `DEFAULT_NUMERIC_RANGE_CLAIM_TEXT_KEYS`, `DEFAULT_NUMERIC_RANGE_FALLBACK_TEXT_KEYS`, `DEFAULT_NUMERIC_RANGE_PRIOR_ART_KEY`, `DEFAULT_PRIOR_ART_A24_EXCEPTION_KEY`, `DEFAULT_PRIOR_ART_PUBLICATION_DATE_KEY`, `DEFAULT_PROBLEM_DIFF_TEXT_KEYS`, `DEFAULT_PROBLEM_FEATURE_KEYS`, `DEFAULT_TARGET_DATE_KEY`, `DEFAULT_TARGET_FILING_DATE_KEY`, `GROUNDEDNESS_THRESHOLD`, `GroundsHandler`, `MergeHandler`, `OaParseHandler`, `PfeConsistencyHandler`, `ResponsePlanHandler`, `coverageAtom`, `draftClaimsAtom`, `groundednessAtom`, `keywordsAtom`, `mergeAtom`, `noveltyAtom`, `oaParseAtom`, `pfeConsistencyAtom`, `reasoningAtom`, `responsePlanAtom`.
- Claim-chart: `MAPPINGS`, `isElementCovered`, `isMapping`.
- Claim-coverage: `MAX_CLAIM_NUMBER`, `claimSimilarity`, `normalizeClaimText`.
- TRIZ: `TRIZ_EXTRACTION_SCHEMA`, `TRIZ_GAP_KINDS`, `TRIZ_PARAMETER_MAX`, `TRIZ_PARAMETER_MIN`.
- Evidence: `cleanEvidenceURI`, `evaluateFourElements`, `priorArtReceiptCitationIds`.
- Graph: `PATENT_NUMBER_RE`, `llmNode`, `resolveInput`.
- Numeric-range novelty: `crossCheckNumericVerdict`.
- Notice parsing: `REJECTION_LABELS`, `REJECTION_PATTERNS`, `detectPatentSubject`, `detectRejectionType`, `detectRejectionTypes`, `extractAffectedClaims`, `extractExaminerArguments`, `identifyDesignGrounds`, `identifyInvalidationGrounds`, `identifyReexaminationGrounds`, `scanCitations`.
- Response preparation: `AMENDMENT_ACTION_LABELS`, `AMENDMENT_COMPARISON_TABLE`, `AMENDMENT_NON_EXTENSION_BASIS`, `AMENDMENT_NON_EXTENSION_ITEMS`, `CHALLENGE_QUESTIONS`, `GROUND_ARGUMENT_ACTIONS`, `REJECTION_AMENDMENT_ACTIONS`, `REJECTION_BASIS`, `REJECTION_SECTIONS`, `REJECTION_STRATEGY`, `STRATEGY_LABELS`, `TECH_COMPARISON_TABLE`, `buildReexaminationPreparation`, `buildResponsePlan`, `detectIndependentClaims`, `formatResponsePlan`, `isAmendmentStrategy`, `strategiesFor`, `summarizeStrategies`.
- Infringement: `DEFAULT_INFRINGEMENT_WEIGHTS`, `EQUIVALENCE_BASIS`, `FULL_COVERAGE_BASIS`, `INFRINGEMENT_DIMENSIONS`, `RISK_HIGH_RATIO`, `RISK_MEDIUM_RATIO`, `findEquivalenceContradictions`, `riskLevel`, `scoreInfringement`.

The root barrel still exports the public engines these helpers implement: `registerBuiltinAtoms()`, `AtomRegistry`, `StageHandlerRegistry`, the graph builders and runners, `parseOfficeAction`, `analyzeNumericRanges`, `deriveAllElementsCoverage`, and `deriveInfringementConclusion`. Repository consumers already use those entry points and behave as before. External code that imported a removed symbol stops compiling or resolving.

## Migration

1. Replace every `@deepseek-ai/dsh-patent-core/src/...` import with the package root. If the name is absent from the root runtime exports, switch to the module engine in the next steps instead of copying the implementation.
2. Builtin atoms: register the handlers with `registerBuiltinAtoms()`, or resolve them through `StageHandlerRegistry` / `AtomRegistry`. Per-atom factories and their default config keys stay internal; stage parameters are documented in the package README.
3. Deterministic kernels: use `validateRowMapping` / `validateElements` / `detectGaps` for claim-chart rows, `checkClaimUnity` / `checkEmbodimentCoverage` for drafting self-checks, `buildTrizAnalysis` / `extractTrizContradictions` for TRIZ, and `EvidenceEngine` / `evidenceCoverage` / `receiptFromToolExecution` for evidence. The removed constants remain available as types where the module declares one, such as `TrizGapKind`.
4. Document parsers: use `parseOfficeAction` for office-action facts, `extractCitations` for citation lists, and `formatOfficeActionSummary` for the rendered summary. Ground identification stays behind the `grounds` builtin handler.
5. Response and infringement: reach the response plan and reexamination sections through the `response-plan` builtin handler; the plan and preparation types remain exported. Use `deriveInfringementConclusion` for coverage, equivalence consistency, and risk grading together, or `deriveAllElementsCoverage` for the coverage subset.
6. Graph helpers: use `handlerNode`, `manifestToGraph`, and `runGraphWithCheckpoints`. `isGraphInterruptError` remains exported.
7. Confirm: `pnpm exec tsc --noEmit` reports no missing export, `pnpm exec vitest run packages/patent/patent-core` passes, and importing the root entry from a packed tarball resolves. A deep import of `@deepseek-ai/dsh-patent-core/src/index.ts` must fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`.
