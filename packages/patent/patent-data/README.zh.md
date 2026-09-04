---
description: "专利数据接缝（`ctx.patentData`）的 Service Definition：基于 vendored [`@deepseek-ai/nuo-patent`](../../../vendor/nuo-patent/README.md) 引擎的 LRU 缓存检索 provider 工厂、结构化元数据映射、专利结果缓存，以及基于注入 subprocess 服务的 ego-browser 反爬会话 runner，外加从 Sati 移植的持久化与案例路径助手。模型可见面全部由消费方负责；本包只解析并提供专利数据。"
kind: "package-reference"
---

# @deepseek-ai/dsh-patent-data

[English](README.md) | 中文

## 概述

专利数据接缝（`ctx.patentData`）的 Service Definition：基于 vendored [`@deepseek-ai/nuo-patent`](../../../vendor/nuo-patent/README.md) 引擎的 LRU 缓存检索 provider 工厂、结构化元数据映射、专利结果缓存，以及基于注入 subprocess 服务的 ego-browser 反爬会话 runner，外加从 Sati 移植的持久化与案例路径助手。模型可见面全部由消费方负责；本包只解析并提供专利数据。

## 目录

- [服务](#service)
- [配置](#configuration)
- [Model Experience](#model-experience)
- [已知局限与延期工作](#known-limitations-and-deferred-work)

<a id="service"></a>
## 服务

`PatentData` 服务注入 `subprocess` 并暴露两个能力方法。

### createSearchProvider(options?)

构造基于 nuo 的 `StageProvider`，其 `search(query, { maxResults })` 将源命中映射为 `{ title, snippet, url }` 阶段词汇。未传 `options.search` 时，它把 nuo 的 `searchPatents` 套上 LRU 缓存，因此 TTL 内重复的检索式直接命中缓存，而不会重复触发网络路径。

### createEgoSession(options?)

基于注入的 `ctx.subprocess` 构造 `EgoBrowserSession`。该 runner 检查 ego-browser 可用性、探测连接、命名会话级 task space，并通过 stdin 原样执行脚本（subprocess 接缝的批量 stdin 取代了单引号 heredoc，因此脚本内容不会被 shell 展开）。`options.runner` 可覆盖默认的 subprocess 后端。

<a id="configuration"></a>
## 配置

服务没有 cordis.yml `Config` schema；两个方法都接受逐调用选项。

| 方法 | 键 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `createSearchProvider` | `search` | LRU 缓存的 nuo `searchPatents` | 底层检索函数注入。 |
| `createEgoSession` | `commandName` | `ego-browser` | CLI 命令名。 |
| `createEgoSession` | `defaultTimeoutMs` | `90000` | 默认运行超时（毫秒）。 |
| `createEgoSession` | `maxTimeoutMs` | `300000` | 单次运行超时硬上限。 |
| `createEgoSession` | `homeDir` | `os.homedir()` | 定位 `~/.local/bin` 的主目录。 |
| `createEgoSession` | `pathEntries` | `[<home>/.local/bin]` | 注入 spawn 环境的额外 PATH 目录。 |
| `createEgoSession` | `maxOutputBytes` | `500000` | 合并输出的软上限（字节）。 |
| `createEgoSession` | `runner` | subprocess 后端 runner | 测试用 spawn runner 注入。 |

<a id="model-experience"></a>
## Model Experience

None, as the data seam resolves and serves patent data to the tool layer; dsh-patent-tools owns every model-facing schema and result.

#### KV Cache effect

Independent; the data seam registers no prompt, tool schema, or result of its own.

<a id="known-limitations-and-deferred-work"></a>
## 已知局限与延期工作

- **外部 `ego-browser` CLI 依赖** — 反爬抓取路径需要外部 `ego-browser`（ego-lite）CLI 已安装且在 PATH 上（仅 macOS）；本包不随附任何 ego-browser 脚本资产（Sati 的 `skills/ego-browser/` 仅含 learnings），因此站点反爬升级在本包之外维护。
- **消费方接线** — 检索 provider 工厂与 ego-session runner 由 `dsh-patent-tools` 消费（patent_search/metadata/legal_status 与 patent_pdf_download）。缓存、映射、持久化与路径模块保持库导出供这些消费方使用。

### 开发备注

无。

本包不发布 invariant 伴生组件：数据缝按需服务调用方，不持有包属持久事件流；检索与 ego-browser 运行由工具层消费，模型可见与会话日志关系归工具层所有。
