---
description: "专利数据接缝（`ctx.patentData`）的 Service Definition：基于 vendored [`@deepseek-ai/nuo-patent`](../../../vendor/nuo-patent/README.md) 引擎的 LRU 缓存检索 provider 工厂、结构化元数据映射、专利结果缓存、基于注入 subprocess 服务的 ego-browser 反爬会话 runner，以及经该会话取中国专利全文、法律状态与关键词检索的 CNIPR（search.cnipr.com）通道，外加从 Sati 移植的持久化与案例路径助手。模型可见面全部由消费方负责；本包只解析并提供专利数据。"
kind: "package-reference"
---

# @deepseek-ai/dsh-patent-data

[English](README.md) | 中文

## 概述

专利数据接缝（`ctx.patentData`）的 Service Definition：基于 vendored [`@deepseek-ai/nuo-patent`](../../../vendor/nuo-patent/README.md) 引擎的 LRU 缓存检索 provider 工厂、结构化元数据映射、专利结果缓存、基于注入 subprocess 服务的 ego-browser 反爬会话 runner，以及经该会话取中国专利全文与法律状态的 CNIPR（search.cnipr.com）通道，外加从 Sati 移植的持久化与案例路径助手。模型可见面全部由消费方负责；本包只解析并提供专利数据。

## 目录

- [服务](#service)
- [配置](#configuration)
- [Model Experience](#model-experience)
- [已知局限与延期工作](#known-limitations-and-deferred-work)

<a id="service"></a>
## 服务

`PatentData` 服务注入 `subprocess` 并暴露三个能力方法。

### createSearchProvider(options?)

构造基于 nuo 的 `StageProvider`，其 `search(query, { maxResults })` 将源命中映射为 `{ title, snippet, url }` 阶段词汇。未传 `options.search` 时，它把 nuo 的 `searchPatents` 套上 LRU 缓存，因此 TTL 内重复的检索式直接命中缓存，而不会重复触发网络路径；只有非空成功结果会入缓存，解析降级导致的零命中不会把一次瞬时失败固定整个 TTL。

### createEgoSession(options?)

基于注入的 `ctx.subprocess` 构造 `EgoBrowserSession`。该 runner 检查 ego-browser 可用性、探测连接、命名会话级 task space，并通过 stdin 原样执行脚本（subprocess 接缝的批量 stdin 取代了单引号 heredoc，因此脚本内容不会被 shell 展开）。`options.runner` 可覆盖默认的 subprocess 后端；命令名、探测与运行超时、输出上限由部署的 `Config` 给出，逐调用选项可逐项覆盖。

### createCniprChannel(options?)

基于一个 ego-browser 会话构造 CNIPR 通道；部署将 `Config.cniprEnabled` 保持关闭时返回空——消费方于是自己对每个号使用原有通道，而不是拿一个只会失败的对象。通道自己判号码形态（`classifyCniprNumber`）：公开(公告)号（`CN122072823A`）取全文 PDF 直链，申请号（`202311356097.5` / `2023113560975`，校验位前补小数点）取法律状态记录，关键词查询取结果页的记录行，其余形态按条目报「本通道不处理」。三种能力都经注入的会话执行一个生成的脚本（`cnipr-script.ts`）、在本包内解析收据（`cnipr-receipt.ts`），并按名复用同一个任务空间，使 ego lite 的登录态与标签页跨调用延续。号码级失败（查不到该号、解析不出申请号）是条目结果；通道级失败（无 ego-browser、超期限、无收据、登录态失效）抛带分类码的 `CniprChannelError`，由调用方按码路由。

<a id="configuration"></a>
## 配置

cordis.yml 的 `Config` 声明随部署变化的 ego-browser 取值；逐调用选项覆盖同名字段。

| 键 | 默认值 | 含义 |
| --- | --- | --- |
| `commandName` | `ego-browser` | CLI 命令名。 |
| `probeTimeoutMs` | `8000` | 连接探测超时（毫秒）。 |
| `defaultTimeoutMs` | `90000` | 默认运行超时（毫秒）。 |
| `maxTimeoutMs` | `300000` | 单次运行超时硬上限。 |
| `maxOutputBytes` | `500000` | 合并输出的软上限（字节）；截断保留完整的 UTF-8 字符。 |
| `nuoRequestChannel` | `auto` | nuo 请求走的通道：`auto` 用 nuo 自己的可用性探测且不改环境，`native` 强制原生 fetch，`browser` 强制 ego 浏览器。取后两者会写入进程级 `NUO_PATENT_EGO_BROWSER`——该环境变量是 nuo 唯一的开关；服务销毁时恢复它替换掉的原值。该变量是进程级的，因此多个挂载的显式选择按最后写入者生效。 |
| `cniprEnabled` | `false` | 本部署是否经 CNIPR 取中国专利全文与法律状态。该通道复用 ego lite 在 `search.cnipr.com` 的登录态，没有该登录态的部署打开它得不到东西；此时 `createCniprChannel()` 返回空，消费方继续走 nuo 引擎并点名自己用的通道。 |

其余选项只走逐调用：它们是测试接缝，或本服务无从知晓的取值。

| 方法 | 键 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `createSearchProvider` | `search` | LRU 缓存的 nuo `searchPatents` | 底层检索函数注入。 |
| `createEgoSession` | `homeDir` | `os.homedir()` | 定位 `~/.local/bin` 的主目录。 |
| `createEgoSession` | `pathEntries` | `[<home>/.local/bin]` | 注入 spawn 环境的额外 PATH 目录，可用性检查同样使用。 |
| `createEgoSession` | `platform` | `process.platform` | 平台覆盖。 |
| `createEgoSession` | `env` | `process.env` | 环境变量覆盖。 |
| `createEgoSession` | `runner` | subprocess 后端 runner | 测试用 spawn runner 注入。 |
| `createCniprChannel` | `timeoutMs` | 会话 `defaultTimeoutMs` | 单次 CNIPR 脚本运行的期限。 |
| `createCniprChannel` | `cwd` | `process.cwd()` | 脚本子进程的工作目录；脚本不落盘。 |

<a id="model-experience"></a>
## Model Experience

None, as the data seam resolves and serves patent data to the tool layer; dsh-patent-tools owns every model-facing schema and result.

#### KV Cache effect

Independent; the data seam registers no prompt, tool schema, or result of its own.

<a id="known-limitations-and-deferred-work"></a>
## 已知局限与延期工作

- **外部 `ego-browser` CLI 依赖** — 反爬抓取路径需要外部 `ego-browser`（ego-lite）CLI 已安装且在 PATH 上（仅 macOS）；本包不随附任何 ego-browser 脚本资产（Sati 的 `skills/ego-browser/` 仅含 learnings），因此站点反爬升级在本包之外维护。
- **装了 JSON 查看器扩展时，nuo 的浏览器路径会让检索失效** — macOS 上只要装了该 CLI，`fetchHtml` 就优先走 ego 浏览器，因此「不设 `NUO_PATENT_EGO_BROWSER`」不等于留在原生 fetch。该路径下浏览器里的 JSON 查看器扩展会把搜索 XHR 的 `application/json` 响应渲染成 HTML：`parseSearchResultsJson` 拿不到 JSON，HTML 回退也解析不出命中，`patent_search` 只带一条非致命告警返回零命中。2026-10-03 在同一代理下实测：三个查询经浏览器路径均零命中，改走原生 fetch 后各 10 条命中。检索必须可用的部署设 `nuoRequestChannel: native`（专利 preset 已设）；该选择是进程级的，因为 nuo 只以环境变量暴露它。
- **CNIPR 通道的范围与维护** — 该通道经 ego lite 操作 `search.cnipr.com`，因此需要那份登录态，也继承平台限制：站点声明不支持爬取，故通道按普通页面交互逐号取，从不批量、不并发。同一个 `PatentData` 服务创建的通道共用一个串行队列，因为每个脚本复用同一个命名任务空间与标签页；该服务内的并行工具调用会排队等待，而不是同时驱动同一页面。队列以服务为界：不同 dsh 进程、以及同一 ego lite profile 上挂载的多个服务仍可能互相干扰，因此一个 ego profile 应只运行一个启用 CNIPR 的 patent-data 挂载。它的页面契约（搜索框、详情检索 POST、法律状态表单、结果行字段、`pic.cnipr.com/pdfcn/...` 直链模式）属于站点：站点一变，第一次调用就以 `page_state` 暴露，而不是静默返回空答案——收据要么解析得出，要么解析不出。法律状态记录来自结果页文本；页面上没有记录时计数为 null，不编造 0。检索直接读结果行（行上已带标题、申请人、公开日与摘要，因此不必逐条取详情页）；页面每页十条，其 20/30 条选项对本部署账号等级会被拒，故更大的 `limit` 靠翻站点自身的分页来取，单次上限三页。
- **消费方接线** — 检索 provider 工厂与 ego-session runner 由 `dsh-patent-tools` 消费（patent_search/metadata/legal_status 与 patent_pdf_download）；CNIPR 通道由 `patent_pdf_download`（中国全文）、`patent_legal_status`（中国法律状态记录）与 `patent_search`（引擎失败或零命中时的中国关键词检索）消费。缓存、映射、持久化与路径模块保持库导出供这些消费方使用。

### 开发备注

无。

本包不发布 invariant 伴生组件：数据缝按需服务调用方，不持有包属持久事件流；检索与 ego-browser 运行由工具层消费，模型可见与会话日志关系归工具层所有。
