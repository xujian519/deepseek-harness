---
kind: upgrade-guide
description: "`@deepseek-ai/dsh-patent-core` 只导出根入口，并从根 barrel 移除 93 个内部运行时符号；全部类型仍会导出。"
---

# patent-core 收窄包入口与根 barrel

[English](guide.md) | 中文

## 变更

`@deepseek-ai/dsh-patent-core` 不再声明 `./src/*` 导出，`@deepseek-ai/dsh-patent-core/src/index.ts` 一类深层导入会以 `ERR_PACKAGE_PATH_NOT_EXPORTED` 失败。该模式本来也只在源码检出中可解析：`files` 从未包含 `src/`。包现在只导出根入口与 `./package.json`。

根 barrel 保留各模块声明的全部类型，运行时值则按消费方实际使用选择性导出。以下 93 个运行时符号不再导出：

- atoms 与内建处理器：`A24_EXCEPTION_LABELS`、`CoverageHandler`、`DEFAULT_AMENDMENT_AMENDED_TEXT_KEYS`、`DEFAULT_AMENDMENT_ORIGINAL_TEXT_KEYS`、`DEFAULT_CITATION_PRIOR_ART_KEY`、`DEFAULT_CITATION_REF_TEXT_KEYS`、`DEFAULT_CONFLICTING_APPLICATIONS_KEY`、`DEFAULT_EVIDENCE_DEADLINE_KEY`、`DEFAULT_EVIDENCE_FILING_DATE_KEY`、`DEFAULT_EVIDENCE_KEY`、`DEFAULT_EVIDENCE_PRIORITY_DATE_KEY`、`DEFAULT_EVIDENCE_REFERENCE_DATE_KEY`、`DEFAULT_NUMERIC_RANGE_CLAIM_TEXT_KEYS`、`DEFAULT_NUMERIC_RANGE_FALLBACK_TEXT_KEYS`、`DEFAULT_NUMERIC_RANGE_PRIOR_ART_KEY`、`DEFAULT_PRIOR_ART_A24_EXCEPTION_KEY`、`DEFAULT_PRIOR_ART_PUBLICATION_DATE_KEY`、`DEFAULT_PROBLEM_DIFF_TEXT_KEYS`、`DEFAULT_PROBLEM_FEATURE_KEYS`、`DEFAULT_TARGET_DATE_KEY`、`DEFAULT_TARGET_FILING_DATE_KEY`、`GROUNDEDNESS_THRESHOLD`、`GroundsHandler`、`MergeHandler`、`OaParseHandler`、`PfeConsistencyHandler`、`ResponsePlanHandler`、`coverageAtom`、`draftClaimsAtom`、`groundednessAtom`、`keywordsAtom`、`mergeAtom`、`noveltyAtom`、`oaParseAtom`、`pfeConsistencyAtom`、`reasoningAtom`、`responsePlanAtom`。
- claim-chart：`MAPPINGS`、`isElementCovered`、`isMapping`。
- claim-coverage：`MAX_CLAIM_NUMBER`、`claimSimilarity`、`normalizeClaimText`。
- TRIZ：`TRIZ_EXTRACTION_SCHEMA`、`TRIZ_GAP_KINDS`、`TRIZ_PARAMETER_MAX`、`TRIZ_PARAMETER_MIN`。
- evidence：`cleanEvidenceURI`、`evaluateFourElements`、`priorArtReceiptCitationIds`。
- graph：`PATENT_NUMBER_RE`、`llmNode`、`resolveInput`。
- 数值范围新颖性：`crossCheckNumericVerdict`。
- 通知书解析：`REJECTION_LABELS`、`REJECTION_PATTERNS`、`detectPatentSubject`、`detectRejectionType`、`detectRejectionTypes`、`extractAffectedClaims`、`extractExaminerArguments`、`identifyDesignGrounds`、`identifyInvalidationGrounds`、`identifyReexaminationGrounds`、`scanCitations`。
- 答复准备：`AMENDMENT_ACTION_LABELS`、`AMENDMENT_COMPARISON_TABLE`、`AMENDMENT_NON_EXTENSION_BASIS`、`AMENDMENT_NON_EXTENSION_ITEMS`、`CHALLENGE_QUESTIONS`、`GROUND_ARGUMENT_ACTIONS`、`REJECTION_AMENDMENT_ACTIONS`、`REJECTION_BASIS`、`REJECTION_SECTIONS`、`REJECTION_STRATEGY`、`STRATEGY_LABELS`、`TECH_COMPARISON_TABLE`、`buildReexaminationPreparation`、`buildResponsePlan`、`detectIndependentClaims`、`formatResponsePlan`、`isAmendmentStrategy`、`strategiesFor`、`summarizeStrategies`。
- 侵权：`DEFAULT_INFRINGEMENT_WEIGHTS`、`EQUIVALENCE_BASIS`、`FULL_COVERAGE_BASIS`、`INFRINGEMENT_DIMENSIONS`、`RISK_HIGH_RATIO`、`RISK_MEDIUM_RATIO`、`findEquivalenceContradictions`、`riskLevel`、`scoreInfringement`。

根 barrel 仍导出这些助手所实现的公共引擎：`registerBuiltinAtoms()`、`AtomRegistry`、`StageHandlerRegistry`、图构造函数与运行器、`parseOfficeAction`、`analyzeNumericRanges`、`deriveAllElementsCoverage` 与 `deriveInfringementConclusion`。仓库内消费方已经使用这些入口，行为不变。仓库外若导入被移除的符号，将无法编译或解析。

## 迁移

1. 将所有 `@deepseek-ai/dsh-patent-core/src/...` 导入改为包根入口。若根入口的运行时导出中没有该名称，按后续步骤改用对应模块的引擎，不要复制内部实现。
2. 内建 atom：用 `registerBuiltinAtoms()` 注册处理器，或通过 `StageHandlerRegistry` / `AtomRegistry` 解析。逐 atom 的工厂函数与默认配置键保留在包内；stage 参数见包 README。
3. 确定性内核：claim-chart 行级校验改用 `validateRowMapping` / `validateElements` / `detectGaps`，撰写自检改用 `checkClaimUnity` / `checkEmbodimentCoverage`，TRIZ 改用 `buildTrizAnalysis` / `extractTrizContradictions`，证据改用 `EvidenceEngine` / `evidenceCoverage` / `receiptFromToolExecution`。被移除的常量在模块声明了对应类型时仍以类型形式可用，例如 `TrizGapKind`。
4. 文书解析：通知书事实改用 `parseOfficeAction`，引用清单改用 `extractCitations`，摘要渲染改用 `formatOfficeActionSummary`。理由识别由 `grounds` 内建处理器承担。
5. 答复与侵权：答复计划与复审准备段经由 `response-plan` 内建处理器获得；计划与准备段类型仍会导出。全面覆盖、等同一致性与风险分级合并使用 `deriveInfringementConclusion`，只取覆盖部分时使用 `deriveAllElementsCoverage`。
6. 图助手：使用 `handlerNode`、`manifestToGraph` 与 `runGraphWithCheckpoints`；`isGraphInterruptError` 仍会导出。
7. 确认：`pnpm exec tsc --noEmit` 不再报缺失导出，`pnpm exec vitest run packages/patent/patent-core` 通过，从打包 tarball 导入根入口可解析。深层导入 `@deepseek-ai/dsh-patent-core/src/index.ts` 必须以 `ERR_PACKAGE_PATH_NOT_EXPORTED` 失败。
