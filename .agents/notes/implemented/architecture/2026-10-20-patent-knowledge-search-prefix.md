# Agent Note: Add an optional search_prefix column without bumping the knowledge schema version

Status: implemented

English | [中文](2026-10-20-patent-knowledge-search-prefix.zh.md)

## Problem

Case-law short queries (`< 3` code points, e.g. two-character terms) bypass FTS5 and fall back to `sati_uncompress(chunks.content) LIKE` over all 81,561 documents. On the 3.4 GB knowledge database a two-character query with no matches takes 6.9 s: decompressing every chunk dominates the scan (`JOIN documents` alone is 134 ms, `documents.title` alone is 7 ms). The same `KNOWLEDGE_DB` spec (`version: 1`) opens both the external source `knowledge.db` and the locally trimmed `knowledge-lite.db`, so a schema-version bump for a read-acceleration column would classify every existing version-1 source database as out of date.

## Decision

`documents.search_prefix` is an **optional read-acceleration column**; `KNOWLEDGE_DB.version` stays `1`.

- **Writer**: `installKnowledgeDb` adds the column when `searchPrefix` is enabled and fills it with the first `searchPrefixChars` code points (default 512, range 64–2048) of each document's longest chunk. Chunk content is decompressed unconditionally, because a re-install can vacuum from an already compressed lite database. Values are written in one transaction; the column is skipped when the source lacks `documents.id` or `chunks(document_id, char_count)`. When the option is disabled, a column inherited from a prefixed lite source is dropped so the reader cannot keep using it.
- **Reader**: `CaseLawSearchEngine` probes `pragma_table_info('documents')` at construction. With the column, the LIKE path scans `documents.title` and `documents.search_prefix` (no chunk decompression), over-fetches `limit * FETCH_MULTIPLIER` candidates so documents without chunks can be skipped, then reads the longest chunk per hit for the snippet. Without the column, the previous `sati_uncompress` JOIN remains.
- **Configuration**: `searchPrefix` (default false) and `searchPrefixChars` on `InstallKnowledgeDbOptions`, exposed as `--search-prefix` and `--search-prefix-chars <n>`.
- **Recall contract**: while the column exists, a LIKE match beyond the longest chunk's prefix is not returned. The prefix path is opt-in because the measured two-character recall loss changes default search results; the default keeps full-body matching.

## Alternatives considered

**Bump `KNOWLEDGE_DB.version`.** This is the usual signal for a schema change, but the version also guards external source databases that this package does not write. A bump would reject every version-1 source database and force a migration for a column that readers can detect on their own.

**Introduce a separate lite-database spec and route by path.** Two specs would keep source and lite versions independent, but every consumer would need to know which file it opened, and the two specs would drift.

**Index the prefix with FTS5 instead of a plain column.** `docs_fts` already indexes full document bodies with a trigram tokenizer; a second FTS table would add index maintenance and still require a versioned schema. The bottleneck is decompression, which a plaintext column removes.

**Store prefixes in a side table.** A separate table avoids `ALTER TABLE` on an external schema, but adds a join and a synchronization obligation with the same versioning question.

**Enable the prefix by default.** The latency gain is large, but two-character recall against the previous longest-chunk LIKE path measured 1.8% (`赔偿`), 22.3% (`新颖`), 42.0% (`公开`), 55.5% (`权利`), 64.9% (`审查`), 72.3% (`侵权`), and 80.4% (`无效`). A default that silently drops most candidates for common legal terms is not an acceptable trade; deployments choose the latency by opting in.

## Consequences

Measured on the real 3.4 GB database: `search('齉龘')` drops from 6,887 ms to 68 ms (131 ms through the built artifact, including engine startup); `search('侵权')` stays at 0.07 ms; queries that hit FTS are unchanged. The same-database A/B comparison (column dropped from a clone) returns identical hits for the five acceptance queries.

Opting in costs:

- About 120 MB of additional file size for 81,561 documents, measured as 114.6 MiB on a clone of the bundled lite database (512 code points per document; 892 documents without chunks keep `NULL`).
- Install time grows by 7.7 s for the prefix build on the bundled corpus.
- Recall is bounded by the prefix for the short-query LIKE path; two-character terms measured 1.8%–80.4% of the previous candidate set. Disabling the option drops the column on the next install.
- A reader cannot distinguish a populated column from a stale one; the data pipeline must rebuild it when documents or their longest chunks change.

## Testing

- [install.spec.ts](../../../../packages/patent/patent-knowledge/tests/install.spec.ts) covers prefix construction, code-point truncation, longest-chunk selection, minimal schemas, the disabled default, out-of-range options, re-install from a compressed database, and dropping a column inherited from a prefixed source.
- [case-law-search.spec.ts](../../../../packages/patent/patent-knowledge/tests/case-law-search.spec.ts) covers the prefix path, a prefix-only match that the legacy path misses, filters, chunkless documents, wildcard escaping, and field equality with the legacy path.
- [bin.spec.ts](../../../../packages/patent/patent-knowledge/tests/bin.spec.ts) pins the new CLI flags in `--help`.
