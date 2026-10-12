# Agent Note: A metric gate for retrieval quality, measured on an in-repo corpus

Status: implemented

English | [中文](2026-10-13-retrieval-quality-metric-gate.zh.md)

## Problem

`patent_eval`'s `retrieval` mode scored "the query names three or more terms" as full marks, and every surface called that score `检索覆盖度` (retrieval coverage). It never read a result list, so the number described the shape of a query while reading as a statement about the search behind it. Nothing in the repository recorded where the BM25 search actually ranked the document that answered the query, so a retrieval change — a different index, added recall, a reranker — had no acceptance criterion and no regression floor.

The 2026-09-30 benchmark (`2026-09-30-patent-domain-external-benchmark.md`, item P1-6) named the gap and the shape of the fix: rank of first relevant as the primary metric, BM25 as the baseline any improvement must beat, and an in-repo asset rather than a borrowed dataset, because the candidate datasets carry unverified download terms or a non-commercial licence.

## Decision

- `@deepseek-ai/dsh-patent-tools` gains `src/eval/ir-metrics.ts`: `rankOfFirstRelevant` as the primary metric, `meanReciprocalRank` as its cross-query aggregate, and `ndcgAtK` for graded relevance. They are pure arithmetic — no retrieval, no file access, no model call — and the package publishes them as a library. No model-visible tool is added.
- The corpus is repository-authored: 12 short Chinese documents and 10 queries with graded relevance judgments, under `tests/fixtures/retrieval-corpus/`. The term distribution is deliberate — several documents repeat a term or share one template sentence — so the baseline shows real lexical false positives instead of ranking the judged document first for every query.
- The baseline ranking is measured rather than asserted. `bm25-baseline.json` records the ranking an FTS5 index actually produced: `tokenize=trigram`, MATCH expressions built by OR'ing quoted phrases, `ORDER BY bm25`. That is the stack `dsh-patent-knowledge` searches with, and the fixture reuses that package's `joinFtsOrTerms` and `sqliteHasFts5` helpers so the recorded baseline cannot drift from the engine it stands for. Terms are all three characters or longer because the trigram index cannot match shorter ones; the engine's short-query LIKE fallback is out of this fixture's scope, and the fixture says so.
- The spec asserts three separate things: the recorded ranking still reproduces from FTS5, the metrics recompute from that ranking to the recorded values, and the metric **discriminates** — pushing every relevant document to the end of its ranking must leave no hit-carrying query better and must measurably lower the aggregate MRR. Without the last one, the module would be a calculator nobody had checked.
- `patent_eval`'s retrieval dimension is renamed to what it measures (`关键词条数`), and the mode label and detail line now say the score describes the query's form. Its scoring is unchanged, so the mode stays the form check it always was; what changes is that it no longer claims to be `检索覆盖度`.

## Alternatives considered

- **Borrowing a third-party dataset.** PatentMatch is exactly the ground truth a claim-to-prior-art ranking wants, and Patent-CE offers five-dimension comparisons against practising patent attorneys' labels. Both lost on terms: PatentMatch's download and use conditions were unverified, and Patent-CE's licence is CC BY-NC 4.0, which cannot ship beside a commercial product. An in-repo corpus cannot calibrate against human judgments at scale, and that cost is stated in the README rather than hidden behind a number.
- **Deriving the relevance judgments from BM25** — labelling whatever the engine ranks first as relevant. It would have produced a baseline of MRR 1.0 and measured nothing.
- **Implementing BM25 in TypeScript so the fixture needs no SQLite.** A reimplementation would be a second definition of the thing being measured, and the recorded ranking has to come from the engine that actually serves searches.
- **Adding a model-visible `retrieval_eval` tool.** The metric exists for the repository's own acceptance of retrieval changes. A model-facing tool would add a schema, a rendered result, and a session event for a check no model call needs to make.
- **Renaming only the dimension key and leaving the mode label.** The label is the first line of the result (`检索覆盖度评分`), and it was the least accurate name in the surface.

## Consequences

- The corpus is small and self-authored, so its baseline is a regression floor rather than evidence that retrieval is good. Two of the ten queries are missed outright by BM25 and two more rank an unrelated document first; both figures come from the fixture's engineered term overlap, which is what makes it discriminating at all.
- Baseline reproduction skips where the runtime's SQLite has no FTS5 — the bundled-Node case `dsh-patent-knowledge` already degrades for. The metric arithmetic, the corpus closure checks, and the discrimination checks run in every environment.
- `patent_eval`'s `retrieval` output changes (dimension key and mode label). Scores are identical; one snapshot sidecar and the generated tool catalog were re-recorded.
- Future retrieval work has one place to be measured, and the metric functions are published from `patent-tools`, so a wider benchmark can be built on them without new plumbing.

## Testing

- `tests/ir-metrics.spec.ts` (8 cases): hand-computable anchors per metric (a relevant document at position 3 giving nDCG@3 = 0.5, a graded pair whose swap lowers nDCG, truncation to k); missed queries returning `null` and 0, and an MRR average that counts a miss in its denominator; corpus closure (12 documents, every term at the trigram minimum, judgments naming existing documents, a baseline entry per query); reproduction of every recorded ranking through FTS5; recomputation of every recorded metric value; and the discrimination checks, including the degenerate q09 whose first relevant document drops to position 4 and an aggregate MRR at least 15 % lower.
- `pnpm exec vitest run packages/patent/patent-tools`: 1332 passed, 2 skipped, including the two assertions renamed with the dimension.
