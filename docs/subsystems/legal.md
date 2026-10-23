# Legal

English | [中文](legal.zh.md)

The legal subsystem is the legal-domain port over the same harness seams the patent domain uses: `@deepseek-ai/dsh-legal-knowledge` provides the `ctx.legalKnowledge` query service over case law, regulations, judicial interpretations, and guiding cases (SQLite FTS5 with an in-memory fallback), while `@deepseek-ai/dsh-legal-law` and `@deepseek-ai/dsh-legal-evidence` register the model-facing `legal_law_verify` and `evaluate_legal_evidence` tools. The packages live in [packages/legal](../../packages/legal/README.md); the [legal preset](../../packages/bundle/web-app/presets/legal.patch.yml) mounts them with the legal document delivery tools.

The legal-law index and the evidence rules ship as package assets, so a deployment that has not transcribed an article reports `未核验` rather than accepting the citation, and a missing evidence field reads as unanswered rather than inferred. Neither tool calls a model: the citation decision and the evidence score are deterministic and reconstructable from the record they received.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxlegalknowledge--legalknowledge"></a>

### `ctx.legalKnowledge` — `LegalKnowledge`

LegalKnowledge service: the legal knowledge-base query seam (ctx.legalKnowledge).

Lazily initializes search engines for case-law, legal regulations, and judicial interpretations. When useFts5 is true (default) and a database is available at the resolved query path, engines use SQLite FTS5 full-text search with BM25 ranking and LIKE fallback; otherwise they use in-memory keyword matching populated via addRecords().

```ts cordis-catalog
/**
 * Case-law full-text search (SQLite FTS5 with LIKE fallback, or in-memory).
 * @param query - the search text.
 * @param options - result cap, docType/court/caseType filters.
 * @returns matching hits sorted by relevance.
 */
caseLawSearch(query: string, options?: CaseLawSearchOptions): CaseLawHit[]

/**
 * Legal regulation full-text search (SQLite FTS5 with LIKE fallback, or in-memory).
 * @param query - the search text.
 * @param options - result cap, level filter, and validity options.
 * @returns matching hits sorted by relevance.
 */
legalSearch(query: string, options?: LegalSearchOptions): LegalRegulationHit[]

/**
 * Judicial interpretation full-text search (SQLite FTS5 with LIKE fallback, or in-memory).
 * @param query - the search text.
 * @param options - result cap, type filter, and validity options.
 * @returns matching hits sorted by relevance.
 */
judicialInterpretationSearch( query: string, options?: JudicialInterpretationSearchOptions, ): JudicialInterpretationHit[]

/**
 * Guiding case search (SQLite LIKE or in-memory keyword matching).
 * @param query - the search text.
 * @param limit - result cap.
 * @returns matching guiding case hits sorted by relevance.
 */
guidingCaseSearch(query: string, limit?: number): GuidingCaseHit[]

/**
 * Add case-law records to the in-memory store.
 * Only effective when the engine is not using a SQLite database.
 * @param records - records to add.
 */
addCaseLawRecords(records: CaseLawRecord[]): void

/**
 * Add legal regulation records to the in-memory store.
 * Only effective when the engine is not using a SQLite database.
 * @param records - records to add.
 */
addLegalRegulationRecords(records: LegalRegulationRecord[]): void

/**
 * Add judicial interpretation records to the in-memory store.
 * Only effective when the engine is not using a SQLite database.
 * @param records - records to add.
 */
addJudicialInterpretationRecords(records: JudicialInterpretationRecord[]): void

/**
 * Add guiding case records to the in-memory store.
 * Only effective when the engine is not using a SQLite database.
 * @param records - records to add.
 */
addGuidingCaseRecords(records: GuidingCaseRecord[]): void
```

Source: [`packages/legal/legal-knowledge/src/index.ts`](../../packages/legal/legal-knowledge/src/index.ts)
<!-- END GENERATED cordis-surface -->
