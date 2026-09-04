---
description: "函数插件，把 Sati 学术文献层移植进 DeepSeek Harness：四个免费、无需 API key 的学术数据源——arXiv、OpenAlex、Semantic Scholar 与 Crossref——归一化到一个连接器注册表之后，以三个无状态工具 `paper_list_sources`、`paper_search` 与 `paper_download` 暴露给模型。移植保留了源实现的按主机礼貌限速（arXiv 每 3 秒 1 次请求、keyless Semantic Scholar 每秒 1 次）与带 LRU 淘汰的进程内 GET 缓存，因此跨源并发展开不会被过度串行化，畸形响应也不会污染缓存。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-literature

[English](README.md) | 中文

## 概述

函数插件，把 Sati 学术文献层移植进 DeepSeek Harness：四个免费、无需 API key 的学术数据源——arXiv、OpenAlex、Semantic Scholar 与 Crossref——归一化到一个连接器注册表之后，以三个无状态工具 `paper_list_sources`、`paper_search` 与 `paper_download` 暴露给模型。移植保留了源实现的按主机礼貌限速（arXiv 每 3 秒 1 次请求、keyless Semantic Scholar 每秒 1 次）与带 LRU 淘汰的进程内 GET 缓存，因此跨源并发展开不会被过度串行化，畸形响应也不会污染缓存。

## 目录

- [工具](#tools)
- [配置](#configuration)
- [模型体验](#model-experience)
- [已知局限与延期工作](#known-limitations-and-deferred-work)

<a id="tools"></a>
## 工具

模型先通过 `paper_list_sources` 发现可用的 `db` id，再通过 `paper_search` 查询具体数据源、用 `paper_download` 下载论文 PDF；无论接入多少个数据源，模型可见的工具数都恒定为三个。三个工具都是对公开数据源的无状态操作，不依赖 agent 或会话。

### paper_list_sources

在无网络 I/O 的情况下列出连接器目录：每个数据源的 `id`、`name` 与 `description`，以及去重后的域名集合（目前仅 `literature`）。接受一个可选的 `domain` 过滤参数。

### paper_search

按 `db` id 与 `query` 查询单个数据源，可选的 `limit`（1–50，默认 10）。结果是一致化的命中，携带 `id`、`title`、`summary`、`url`、可选的 `score` 与不透明的 `extra` 载荷。数据源故障（限流或不可用）会使调用失败并给出可行动的指引，而不是返回一个模型可能误读为「查无此文」的空结果；真正的零命中查询返回空的 `hits` 列表。

### paper_download

按 `db` + `id`（来自 `paper_search` 命中）下载一篇论文的 PDF，保存为 `<outputDir>/<id>.pdf`（默认 `<cwd>/论文原文/YYYY-MM-DD/<id>.pdf`）。直链优先——arXiv `extra.pdf`、OpenAlex `best_oa_location.pdf_url` / `open_access.oa_url`、Semantic Scholar `openAccessPdf.url`——经 PDF 魔数与最小字节数校验；直链失败（403/404/HTML 壳页）时，ego 提取器打开记录页提取 PDF 链接，再由同一 fetch 路径下载。显式 `pdfUrl` 覆盖可跳过连接器解析。与 patent_pdf_download 的通道设计一致（直链优先、浏览器兜底）。

<a id="configuration"></a>
## 配置

Schemastery 配置，所有字段均可选。

| 键 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `arxiv` | boolean | `true` | 注册 arXiv 连接器。 |
| `openalex` | boolean | `true` | 注册 OpenAlex 连接器。 |
| `semanticScholar` | boolean | `true` | 注册 Semantic Scholar 连接器。 |
| `crossref` | boolean | `true` | 注册 Crossref 连接器。 |
| `openalexMailto` | string | — | OpenAlex polite pool 邮箱；缺省回退到 `OPENALEX_MAILTO`，再回退到默认值。 |
| `semanticScholarApiKey` | string | — | Semantic Scholar 更高限额档位的 API key。 |

连接器工厂接受一个仅测试使用的 `fetchImpl` 覆盖；它不是 `Config` 字段。

<a id="model-experience"></a>
## 模型体验

### 工具

#### 模型看到的内容

三个已注册的工具定义：`paper_list_sources`（可选 `domain`）、`paper_search`（必填 `db` 与 `query`，可选 `limit`）与 `paper_download`（必填 `db` 与 `id`，可选 `pdfUrl`/`outputDir`/`timeoutMs`）。每个描述都指导模型先调用 `paper_list_sources` 发现 `db` id，并说明 arXiv 的字段化查询（如 `ti:transformer AND cat:cs.LG`）会原样透传。连接器的启用状态只改变哪些 `db` id 有效，不改变工具定义。

#### Token 影响

每次请求的固定定义开销，与启用多少个连接器无关；禁用某个连接器不会移除任何 schema token，只会收窄 `paper_list_sources` 返回的目录。

#### KV Cache 影响

只要两个定义及其可见性不变，前缀就保持稳定；插件的注册或销毁会从第一个变化的定义 token 起使复用失效。

### 搜索结果

#### 模型看到的内容

成功的 `paper_search` 为每个命中渲染一个 Markdown 块——`## <title>` 标题，后跟 `**id**`、可选的 `**url**`、可选的 `**pdf**`（arXiv）、可选的 ` · score` 以及摘要。零命中查询渲染 `No results for "<query>" in <db>.`；数据源故障渲染其可行动的指引文本。

#### Token 影响

数据相关的结果会持续重发直到压缩；每个命中的摘要与标题受连接器的片段截断约束（摘要 600 字符、标题 300 字符），其余部分受数据源响应约束。

#### KV Cache 影响

仅追加；新可见的结果文本跟随可复用的请求前缀，不会使既有的 KV 缓存条目失效。

### 数据源列表结果

#### 模型看到的内容

`paper_list_sources` 渲染 `Available literature sources (<count>):`，后跟每个数据源一行 `- **<id>** (<name>) — <description>`。没有匹配的数据源时渲染 `No literature sources are registered.`（或带 domain 过滤的变体）。

#### Token 影响

小而受限：目录在注册时即固定（至多四个条目），因此渲染出的列表稳定，并会持续重发直到压缩。

#### KV Cache 影响

仅追加；新可见的列表文本跟随可复用的请求前缀，不会使既有的 KV 缓存条目失效。

<a id="known-limitations-and-deferred-work"></a>
## 已知局限与延期工作

- **仅限免费的公开数据源** — 四个连接器覆盖免费、无需 API key 的数据源；没有认证或付费档位的建模，也没有连接器要求凭据才能工作（Semantic Scholar key 只是提高限额）。
- **按主机限速可能带来延迟** — arXiv 每 3 秒 1 次请求、keyless Semantic Scholar 每秒 1 次请求，因此包含大量 arXiv 命中的多源并发展开可能排在礼貌间隔之后；限速按主机隔离，无关的数据源会并行推进。
- **PDF 可用性取决于数据源的开放获取状态** — `paper_download` 解析数据源报告的链接（arXiv pdf、OpenAlex best-oa location、Semantic Scholar openAccessPdf）；付费墙内的记录自然没有可下载的链接。
- **浏览器兜底通道为统一 ego 栈** — `paper_download` 的兜底经 `EgoExtractor` 打开记录页；browser-use 提取不再是下载通道兜底。

### 开发备注

无。

本包不发布 invariant 伴生组件：文献工具除常规 tools/result 日志外不写入包属持久会话事件；执行关系归它们调用的工具注册表所有。
