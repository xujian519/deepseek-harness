---
description: "knowledge.db 查询接缝的服务定义（`ctx.patentKnowledge`）：判例全文检索、法规全文检索、wiki 卡片关键词查询、IPC 分类、知识图谱查询（基于 `node:sqlite`），以及从 Sati 移植的 `patent-knowledge:install` 数据引导。模型可见面全部由消费方负责；本包只解析并提供只读知识查询。"
kind: "package-reference"
---

# @deepseek-ai/dsh-patent-knowledge

[English](README.md) | 中文

## 概述

knowledge.db 查询接缝的服务定义（`ctx.patentKnowledge`）：判例全文检索、法规全文检索、wiki 卡片关键词查询、IPC 分类、知识图谱查询（基于 `node:sqlite`），以及从 Sati 移植的 `patent-knowledge:install` 数据引导。模型可见面全部由消费方负责；本包只解析并提供只读知识查询。

## 目录

- [服务](#service)
- [配置](#configuration)
- [patent-knowledge:install](#patent-knowledgeinstall)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="service"></a>
## 服务

`PatentKnowledge` 服务以只读方式打开解析得到的 `knowledge.db`（数据库缺失或版本不匹配时经 `KnowledgeDbVersionError` fail-loud），并委托给移植的引擎。引擎惰性打开，并在所属 fiber 卸载时关闭。

### caseLawSearch(query, options?)

对 `documents`/`chunks`/`docs_fts` 表做全文检索（FTS5 BM25 优先，短查询或缺失 FTS 索引时降级 LIKE）。返回 `CaseLawHit[]`；options 支持按 `docType`、`court`、`excludeSource` 过滤。

### legalSearch(query, options?)

经 `KnowledgeLawSearch` 对 `knowledge.db` 的 `law_article` 文档做全文检索。返回 `LawSearchResult[]`；options 支持按 `level` 过滤。

### wikiCards(query, limit?)

对 wiki 卡片目录做关键词查询（标题/概念/领域）。P1 仅关键词路径：语义/向量 wiki 索引已延后，wiki 目录缺失时降级为空结果。

### ipcClassify(text)

经移植的关键词分类器对专利领域文本做 IPC 分类。按置信度排序返回 `IpcClassification[]`。

### kgSearch / kgGetNode / kgListByType

在 `kg_nodes`/`kg_edges` 表上做知识图谱关键词检索（含关系扩展）、按 id 取节点、按类型列节点（unified schema，兼容 legacy `nodes`/`edges`）。

### ipcStandards / ipcStandardsByArticle / ipcStandardsSearch

基于随包 `ipc-standards.yaml` 的审查标准卡片查询（按 IPC 部、按法条、按关键词）。

<a id="configuration"></a>
## 配置

| 键 | 默认值 | 含义 |
| --- | --- | --- |
| `knowledgeDir` | `~/.dsh/knowledge` | 查询数据库与 wiki 卡片的数据目录。 |
| `sourceDbPath` | `~/.sati/knowledge/knowledge.db` | `patent-knowledge:install` 的源数据库，及只读直用的回退路径。 |

查询数据库按 `knowledgeDir/knowledge.db`、`knowledgeDir/knowledge-lite.db`、`sourceDbPath` 的顺序解析。

<a id="patent-knowledgeinstall"></a>
## patent-knowledge:install

安装逻辑为导出的 `installKnowledgeDb(options)` 函数加 `patent-knowledge-install` 可执行入口；插件加载时不会自动运行。它把本机源 `knowledge.db` 裁剪为 `knowledgeDir/knowledge-lite.db`：VACUUM 生成紧凑副本、gzip 压缩 `chunks.content` 长正文（读取端透明解压）、删除 embeddings 表。运行一次以准备数据：

```sh
pnpm --filter @deepseek-ai/dsh-patent-knowledge exec patent-knowledge-install
# or with an explicit source database:
patent-knowledge-install --from /path/to/knowledge.db --output ~/.dsh/knowledge/knowledge-lite.db
```

参数：`--from <path>`（源库）、`--output <path>`、`--no-compress-chunks`、`--keep-embeddings`、`--no-fts`、`--skip-verify`、`-h/--help`。

<a id="model-experience"></a>
## Model Experience

None, as the knowledge seam resolves and serves read-only knowledge queries to the tool layer; dsh-patent-tools owns every model-facing schema and result.

#### KV Cache effect

Independent; the knowledge seam registers no prompt, tool schema, or result of its own.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **P1 无向量/语义检索** — embedding/向量路径（`knowledge-embeddings`、`wiki-card-vector-index`、三个 memory provider）未移植；wiki 卡片查询仅关键词路径，判例/法规/知识图谱检索仅 FTS5/LIKE。
- **源数据库不随包分发** — 数据须经 `patent-knowledge:install` 本地准备，或经 `sourceDbPath`/`knowledgeDir` 直接指向；不提供任何公共下载点。
- **`node:sqlite` 处于实验阶段** — 引擎运行在 Node 内置 SQLite 上，该模块在支持的 Node 版本线中仍为实验特性，可能随版本变更。

### 开发备注

无。

本包不发布 invariant 伴生组件：知识缝对外部 knowledge.db 提供只读查询，不持有包属持久会话事件流；模型可见与会话日志关系归消费这些查询的工具层所有。
