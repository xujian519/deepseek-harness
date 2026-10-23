---
description: "DeepSeek Harness 的随包中国法条索引：法条引用解析、逐法记录来源与核验日期的索引、绝不把未转录条文静默放行的引用核验，以及 legal_law_verify 工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-legal-law

[English](README.md) | 中文

## 概述

DeepSeek Harness 的随包中国法条索引：法条引用解析、逐法记录来源与核验日期的索引、绝不把未转录条文静默放行的引用核验，以及 legal_law_verify 工具。

## 目录

- [为什么有这个包](#why-it-exists)
- [随包索引](#shipped-index)
- [引用判定](#citation-decision)
- [工具](#tool)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)

<a id="why-it-exists"></a>
## 为什么有这个包

一条引用《民法典》第 143 条的法律结论，其质量取决于这个条号背后的条文。索引随部署分发，使引用可以离线核验：先解析引用，再查条文，判定会区分"条文存在"与"条文不存在"，也区分"已转录"与"无人核验过"。引用解析器、条目读取器与命题比对机制通过 `@deepseek-ai/dsh-patent-core` 与 `@deepseek-ai/dsh-patent-index-asset` 与 `@deepseek-ai/dsh-patent-law` 共用；本包负责法律域的语法、资产与文案。

<a id="shipped-index"></a>
## 随包索引

每部法律是 `assets/legal-law` 下的一个 YAML 文件。文件声明 `law`、`document`、`revision`、`maxArticle`、`maxVerifiedOn`、`maxSource` 与 `articles` 列表；每个条目携带 `article`、可选的 `paragraphs`、`topics`、`text`、`sourceDoc` 与 `verifiedOn`。转录记录是全有或全无：有 `text` 就必须同时有 `sourceDoc` 与 `verifiedOn`，只有来源没有正文同样是加载错误，因此手改索引无法制造核验器要避免的"静默放行"状态。插件加载时检查目录可读且非空，否则让部署失败；插件在第一次核验时通过 `loadLegalLawBaselinesAsync` 解析全部文件，逐文件让出事件循环，使 Web 进程能继续服务其他会话，格式错误的文件让该次调用失败。`loadLegalLawBaselines` 是同步版本；`parseLegalLawBaseline` 解析单个文件；`findLegalArticle` 查一个条号。资产声明的任何法律名都会成为引用形式，资产的文件标题同时作为正式全名别名；`legalLawNames` 返回当前集合。

<a id="citation-decision"></a>
## 引用判定

`parseLegalLawReference` 解析单独成文的引用，`extractLegalLawReferences` 提取一段文本中的全部引用（含 `第 143 条、第 144 条` 与 `第 2 款、第 3 款` 这类续指），`formatLegalLawReference` 渲染正式写法，`scanUnrecognizedLegalCitations` 列出解析器无法识别的疑似引用片段。`verifyLegalCitation` 把一条引用判定为 `valid`、`mismatch`、`unmatched`、`out-of-range`、`not-indexed` 或 `unverified`；命题先按主题词、再按加权字符对重合度与已转录条文比对，若命题由另一条文承载，则报告为 mismatch 并点出该条文。`resolveLegalCitationPolicy` 按部署的策略集映射判定，`renderLegalCitationRows` 渲染工具返回的判定表。

<a id="tool"></a>
## 工具

`legal_law_verify` 接受可选的 `text`（从中提取引用）、可选的 `references`（按原文逐条给出）与可选的 `proposition`（引用所支持的命题）；`text` 与 `references` 至少要给一个，空的 `text` 且无 references 是输入错误。结果携带 findings、`blocked` 标志、按判定分组的计数，以及未经核验的 `unrecognized` 片段。

<a id="model-experience"></a>
## 模型体验

### legal_law_verify 工具

#### 模型看到什么

注册一个名为 `legal_law_verify` 的工具，参数为上述 `text`、`references` 与 `proposition`；两者都没给时是错误，而不是一次没有 finding 的成功核验。每条 finding 携带原始引用、法律、条号、款或项、判定、处置与理由；结果还携带 `blocked`、判定计数与 `unrecognized`。工具描述写明六种判定、未转录的条文绝不报告为已核验，以及"不是恰好一条引用"属于输入错误。

#### Token 影响

工具启用期间每次请求都有固定的定义开销；每次结果是一张短表加说明，在压缩之前随会话重发。

#### KV Cache 影响

仅追加；新出现的结论文本位于可复用的请求前缀之后，不会使已有 KV-cache 条目失效。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓事项

- **随包索引没有转录任何条文正文，也没有记录已核验的条号上限。** 每个自动生成的法律文件都写着 `text: null` 与 `maxVerifiedOn: null`，因此当前已索引的条文返回 `unverified`，超出声明上限的条号同样返回 `unverified`：索引判定的是存在性，不是条文内容。转录属于暂缓事项，在条目记录来源与日期之前，工具无法把一条引用报告为已核验。
- **覆盖范围是生成语料，不是经审阅的纲要。** `assets/legal-law` 持有数千个按法拆分的文件，主题词由脚本推导；生成器漏掉的法律或条文会报告 `not-indexed`，即使该规定确实存在。因此 `unverified` 或 `not-indexed` 只说明本索引收了什么，不说明中国法律有什么。
- **命题比对是字面的。** 主题词与加权字符对只比较字符；换用同义表述的命题会报告 `unmatched`，必须由人工阅读；多部条文共有的套话会降低但不能消除错误匹配。
- **项号只回显，不核验。** 条目记录款，不记录项；引用 `第 X 项` 时按条与款判定，项号只随结果回显。
- **未识别的片段是警告，不是拦截。** `unrecognized` 列出未参与判定的片段，本身不会置 `blocked`。
- **基线正确性由内容负责。** 任何运行时观察都无法证明某个条目的正文就是现行官方文本；只有记录的来源与日期可以，门禁检查引用与索引成员关系，不检查法律正确性。

### 开发备注

无。
