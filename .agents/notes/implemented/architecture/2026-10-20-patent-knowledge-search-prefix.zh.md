# Agent Note: Add an optional search_prefix column without bumping the knowledge schema version

Status: implemented

[English](2026-10-20-patent-knowledge-search-prefix.md) | 中文

## 问题

判例短查询（少于 3 个码点，例如两字词）绕过 FTS5，回退到对全部 81,561 篇文档执行 `sati_uncompress(chunks.content) LIKE`。在 3.4 GB 知识库上，一个无命中的两字查询耗时 6.9 秒：解压每个 chunk 占据了扫描的主要成本（仅 `JOIN documents` 为 134 ms，仅 `documents.title` 为 7 ms）。同一个 `KNOWLEDGE_DB` spec（`version: 1`）既打开外部源 `knowledge.db`，也打开本地裁剪的 `knowledge-lite.db`；若为一个读取加速列升 schema 版本，所有现存的 version 1 源库都会被视为过期。

## 决策

`documents.search_prefix` 是**可选的读取加速列**；`KNOWLEDGE_DB.version` 保持 `1`。

- **写入方**：`installKnowledgeDb` 在列不存在时添加该列，并写入每个文档最长 chunk 的前 `searchPrefixChars` 个码点（默认 512，范围 64–2048）。chunk 正文无条件解压，因为重复 install 可能从已压缩的 lite 库 VACUUM 出副本。所有值在单个事务内写入；源库缺少 `documents.id` 或 `chunks(document_id, char_count)` 时跳过。
- **读取方**：`CaseLawSearchEngine` 在构造时探测 `pragma_table_info('documents')`。有该列时，LIKE 路径扫描 `documents.title` 与 `documents.search_prefix`（不解压 chunk），按 `limit * FETCH_MULTIPLIER` 放大候选，以便跳过无 chunk 的文档，再为每个命中读取最长 chunk 作为片段。无该列时保留原有的 `sati_uncompress` JOIN。
- **配置**：`InstallKnowledgeDbOptions` 新增 `searchPrefix`（默认 true）与 `searchPrefixChars`，对应 CLI 参数 `--no-search-prefix` 与 `--search-prefix-chars <n>`。
- **召回契约**：该列存在期间，超出最长 chunk 前缀的 LIKE 匹配不会返回。前缀路径覆盖常见的短查询场景；需要全文召回时以 `searchPrefix: false` 重新 install。

## 备选方案

**提升 `KNOWLEDGE_DB.version`。** 这是 schema 变化的常规信号，但该版本同时守护本包不写入的外部源库。升版会拒绝所有 version 1 源库，并为一个读取端可自行探测的列引入迁移。

**引入独立的 lite 库 spec，按路径路由。** 两个 spec 可以让源库与 lite 库的版本彼此独立，但每个消费方都要知道自己打开的是哪个文件，两个 spec 也会逐渐漂移。

**用 FTS5 索引前缀，而不是普通列。** `docs_fts` 已用 trigram 分词索引文档全文；再建一张 FTS 表会增加索引维护，并且仍需要版本化 schema。瓶颈在解压，普通明文列即可消除。

**把前缀放进独立的边表。** 边表避免对外部 schema 执行 `ALTER TABLE`，但增加一次 join 和同步义务，并面对同样的版本问题。

## 后果

在真实的 3.4 GB 数据库上实测：`search('齉龘')` 从 6,887 ms 降到 68 ms（经构建产物为 131 ms，含引擎启动）；`search('侵权')` 保持 0.07 ms；命中 FTS 的查询不变。同库 A/B（在克隆库上删除该列）对五组验收查询返回完全相同的命中。

代价：

- 81,561 篇文档额外占用约 120 MB（每文档 512 个码点；892 篇无 chunk 的文档保持 `NULL`）。
- 在随包语料上，install 的前缀构建增加 7.7 秒。
- 在重新 install 前，短查询 LIKE 路径的召回受前缀边界限制。
- 读取端无法区分已填充与陈旧的前缀列；文档或其最长 chunk 变化时，数据管道必须重建该列。

## 测试

- [install.spec.ts](../../../../packages/patent/patent-knowledge/tests/install.spec.ts) 覆盖前缀构建、按码点截断、最长 chunk 选择、最小 schema、关闭与越界选项，以及从压缩库重复 install。
- [case-law-search.spec.ts](../../../../packages/patent/patent-knowledge/tests/case-law-search.spec.ts) 覆盖前缀路径、旧路径会漏掉的前缀独有命中、过滤条件、无 chunk 文档、通配符转义，以及与旧路径的字段一致性。
- [bin.spec.ts](../../../../packages/patent/patent-knowledge/tests/bin.spec.ts) 固定 `--help` 中的新增 CLI 参数。
