---
description: "Service Definition for the knowledge.db query seam (`ctx.patentKnowledge`): case-law full-text search, legal full-text search, wiki-card keyword lookup, IPC classification, and knowledge-graph queries over `node:sqlite`, plus the `patent-knowledge:install` data bootstrap ported from Sati. Consumers own every model-facing surface; this package resolves and serves read-only knowledge queries."
kind: "package-reference"
---

# @deepseek-ai/dsh-patent-knowledge

English | [中文](README.zh.md)

## Summary

Service Definition for the knowledge.db query seam (`ctx.patentKnowledge`): case-law full-text search, legal full-text search, wiki-card keyword lookup, IPC classification, and knowledge-graph queries over `node:sqlite`, plus the `patent-knowledge:install` data bootstrap ported from Sati. Consumers own every model-facing surface; this package resolves and serves read-only knowledge queries.

## Table of Contents

- [Service](#service)
- [Configuration](#configuration)
- [patent-knowledge:install](#patent-knowledgeinstall)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Service

The `PatentKnowledge` service opens the resolved `knowledge.db` read-only (fail-loud via `KnowledgeDbVersionError` on a missing or version-mismatched database) and delegates to the ported engines. Engines are opened lazily and closed when the owning fiber unloads.

### caseLawSearch(query, options?)

Full-text search over the `documents`/`chunks`/`docs_fts` tables (FTS5 BM25 first, LIKE fallback for short queries or a missing FTS index). Returns `CaseLawHit[]`; options filter by `docType`, `court`, and `excludeSource`.

### legalSearch(query, options?)

Full-text search over the `law_article` documents of `knowledge.db` via `KnowledgeLawSearch`. Returns `LawSearchResult[]`; options filter by `level`.

### wikiCards(query, limit?)

Keyword lookup over the wiki-card directory (title/concept/domain). Keyword-only in P1: the semantic/vector wiki index is deferred, so an absent wiki directory degrades to an empty result.

### ipcClassify(text)

IPC classification of a patent-domain text via the ported keyword classifier. Returns `IpcClassification[]` in confidence order.

### kgSearch / kgGetNode / kgListByType

Knowledge-graph keyword search with relation expansion, node lookup by id, and node listing by type over the `kg_nodes`/`kg_edges` tables (unified schema, with legacy `nodes`/`edges` fallback).

### ipcStandards / ipcStandardsByArticle / ipcStandardsSearch

Examination-standard card queries over the shipped `ipc-standards.yaml` (by IPC section, by law article, and by keyword).

## Configuration

| Key | Default | Meaning |
| --- | --- | --- |
| `knowledgeDir` | `~/.dsh/knowledge` | Data directory for the query database and wiki cards. |
| `sourceDbPath` | `~/.sati/knowledge/knowledge.db` | Source database for `patent-knowledge:install`, and the read-only direct-use fallback. |

The query database resolves as `knowledgeDir/knowledge.db`, then `knowledgeDir/knowledge-lite.db`, then `sourceDbPath`.

## patent-knowledge:install

The install logic is an exported `installKnowledgeDb(options)` function plus the `patent-knowledge-install` bin; it never runs on plugin load. It trims the local source `knowledge.db` into `knowledgeDir/knowledge-lite.db` by vacuuming into a fresh copy, gzip-compressing `chunks.content` long bodies (readers decompress transparently), and dropping the embeddings tables. Run it once to prepare the data:

```sh
pnpm --filter @deepseek-ai/dsh-patent-knowledge exec patent-knowledge-install
# or with an explicit source database:
patent-knowledge-install --from /path/to/knowledge.db --output ~/.dsh/knowledge/knowledge-lite.db
```

Flags: `--from <path>` (source db), `--output <path>`, `--no-compress-chunks`, `--keep-embeddings`, `--no-fts`, `--skip-verify`, `-h/--help`.

## Model Experience

None, as the knowledge seam resolves and serves read-only knowledge queries to the tool layer; dsh-patent-tools owns every model-facing schema and result.

#### KV Cache effect

Independent; the knowledge seam registers no prompt, tool schema, or result of its own.

## Known Limitations and Deferred Work

- **No vector or semantic retrieval in P1** — the embedding/vector paths (`knowledge-embeddings`, `wiki-card-vector-index`, the three memory providers) are not ported; wiki-card lookup is keyword-only, and case-law/legal/knowledge-graph search is FTS5/LIKE only.
- **Source database is not bundled** — the data must be prepared locally via `patent-knowledge:install` or pointed at directly through `sourceDbPath`/`knowledgeDir`; no public download is provided.
- **`node:sqlite` is experimental** — the engines run on Node's built-in SQLite, which is experimental in the supported Node line and may change between releases.

### Dev Note

None.

No companion is published because the knowledge seam serves read-only queries over an external knowledge.db and owns no durable package-local session event stream; model-visible and session-log relations belong to the tool layer that consumes these queries.
