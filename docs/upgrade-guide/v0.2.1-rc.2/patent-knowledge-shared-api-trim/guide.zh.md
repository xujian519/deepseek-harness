---
kind: upgrade-guide
description: "`@deepseek-ai/dsh-patent-knowledge` 移除 `CircuitBreaker`、`guarded`、`KgPathEdge` 以及未接线的 `KnowledgeRuntimeStats` 字段。"
---

# patent-knowledge 移除未使用的共享导出

[English](guide.md) | 中文

## 变更

`@deepseek-ai/dsh-patent-knowledge` 不再导出以下符号：

- `CircuitBreaker`、`guarded` 及其类型 `CircuitBreakerOptions` / `CircuitBreakerState`，包括深层入口 `./src/shared/circuit-breaker.ts`。
- `KgPathEdge`，包根与 `./shared/kg-store.ts` 均不再导出。
- `KgFtsMode` 与 `WikiSemanticIndexState`。

`KnowledgeRuntimeStatsSnapshot` 只保留两个全文引擎实际写入的三项：`legalFtsDegraded`、`caseLawFtsDegraded` 与 `likeFallbacks`。被移除字段对应的 setter 一并删除（`recordCacheHit`、`recordCacheMiss`、`recordSemanticCall`、`recordSemanticFailure`、`recordRerankCall`、`recordRerankFailure`、`registerBreaker`、`setKgFtsMode`、`setWikiSemanticIndexState`、`setCaseLawAvailable`、`recordCaseLawInject`、`setEmbeddingConsistency`）。`setLegalFtsDegraded`、`setCaseLawFtsDegraded` 与 `recordLikeFallback` 保留。

本仓库内的消费方无需改动即可编译，检索引擎行为不变。仓库外若导入被移除的符号、调用被移除的 setter 或读取被移除的快照字段，将无法通过编译。

## 迁移

1. 把 `CircuitBreaker` / `guarded` 的导入替换为本地熔断器或宿主提供的重试助手。
2. 需要路径边时自行声明 `{ source, target, relation }` 记录；`KgNeighbor` 是邻居投影（`targetId`、`relation`），不能替代路径边。
3. 只从 `snapshot()` 读取 `legalFtsDegraded`、`caseLawFtsDegraded` 与 `likeFallbacks`，并删除对被移除 setter 的调用。
4. 改从包根导入模块，或删除该导入。
5. 确认：`pnpm exec tsc --noEmit` 不再报缺失导出，且 `pnpm exec vitest run packages/patent/patent-knowledge` 通过。
