---
kind: upgrade-guide
description: "`@deepseek-ai/dsh-patent-knowledge` drops `CircuitBreaker`, `guarded`, `KgPathEdge`, and the unwired `KnowledgeRuntimeStats` fields."
---

# Patent-knowledge drops its unused shared exports

English | [中文](guide.zh.md)

## Change

`@deepseek-ai/dsh-patent-knowledge` no longer exports these symbols:

- `CircuitBreaker`, `guarded`, and their types `CircuitBreakerOptions` / `CircuitBreakerState`, including the deep entry `./src/shared/circuit-breaker.ts`.
- `KgPathEdge`, from the package root and from `./shared/kg-store.ts`.
- `KgFtsMode` and `WikiSemanticIndexState`.

`KnowledgeRuntimeStatsSnapshot` now carries only the three values the engines write: `legalFtsDegraded`, `caseLawFtsDegraded`, and `likeFallbacks`. The setters for the removed fields are gone (`recordCacheHit`, `recordCacheMiss`, `recordSemanticCall`, `recordSemanticFailure`, `recordRerankCall`, `recordRerankFailure`, `registerBreaker`, `setKgFtsMode`, `setWikiSemanticIndexState`, `setCaseLawAvailable`, `recordCaseLawInject`, `setEmbeddingConsistency`). `setLegalFtsDegraded`, `setCaseLawFtsDegraded`, and `recordLikeFallback` remain.

Consumers inside this repository compile unchanged, and the query engines behave as before. External code that imported a removed symbol, called a removed setter, or read a removed snapshot field stops compiling.

## Migration

1. Replace `CircuitBreaker` / `guarded` imports with a local breaker or your host's retry helper.
2. Declare the `{ source, target, relation }` record where you need path edges; `KgNeighbor` is the neighbor projection (`targetId`, `relation`), not a replacement.
3. Read only `legalFtsDegraded`, `caseLawFtsDegraded`, and `likeFallbacks` from `snapshot()`, and delete calls to the removed setters.
4. Import removed modules through the package root, or delete the import.
5. Confirm: `pnpm exec tsc --noEmit` reports no missing export, and `pnpm exec vitest run packages/patent/patent-knowledge` passes.
