---
description: "函数插件，用随包分发的法条索引核验法条引用：条/款/项与指南节路径的解析、带转录来源的逐法索引、永不把未转录条文报成已核验的判定，以及 law_verify 工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-patent-law

[English](README.md) | 中文

## 概述

函数插件，用随包分发的法条索引核验法条引用：条/款/项与指南节路径的解析、带转录来源的逐法索引、永不把未转录条文报成已核验的判定，以及 law_verify 工具。

## 目录

- [law_verify 工具](#law-verify-tool)
- [引用判定与处置策略](#citation-decisions-and-policy)
- [法条索引资产](#law-index-assets)
- [库 API](#library-api)
- [配置](#configuration)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)

<a id="law-verify-tool"></a>
## law_verify 工具

law_verify 读取一段文本中的法条引用（或直接传入的引用），逐条对照本次部署随包的索引作出判定：《专利法》《专利法实施细则》按条，《专利审查指南》按归一化节路径。每条判定都带判定结果、本次部署对该判定的处置，以及理由。

这个工具存在的原因：法条核验此前散在四处互不相通的地方——工作流质量门禁里的静态主题表、规则资产里的条数上限、145 个规则文件里的 `legalBasis` 文本、以及一个并不随包交付的用户级基线文件——因此错误的条号可能一路通过。统一索引、统一解析、统一判定只固定"引用形式是否可核验"，不判断法条内容是否正确，工具也如实说明这一点。

<a id="citation-decisions-and-policy"></a>
## 引用判定与处置策略

| 判定 | 含义 |
| --- | --- |
| 已核验（`valid`） | 已索引、已按记录来源转录，且（给出命题时）该条主题支撑所引命题。 |
| 与所引命题不符（`mismatch`） | 已索引且已转录，但所引款不存在，或所引命题不被支撑。 |
| 条号超出有效范围（`out-of-range`） | 超出条数上限，**且该上限本身已核验**。 |
| 索引中不存在（`not-indexed`） | 索引中没有该条，或本次部署没有该法的索引。 |
| 条文未转录（未核验）（`unverified`） | 已索引，但条文文本或核验来源仍缺；超出「未核验上限」的条号也按此报告。 |

四种处置各对应一个 Config 字段（`onMismatch`、`onOutOfRange`、`onNotIndexed`、`onUnverified`），取值 `block`、`warn`、`allow`。随包默认对「与命题相矛盾」和「已核验上限之外的条号」拦截，对索引缺口只告警——这样部分转录的索引仍可用，而每一处缺口都可见。

<a id="law-index-assets"></a>
## 法条索引资产

`assets/law/` 每部文书一个文件（`cn-patent-law.yaml`、`cn-implementing-regulations.yaml`、`cn-examination-guidelines.yaml`）。每个条目记录条号或节路径、用于核对命题的主题词，以及转录来源：`text`、`sourceDoc`、`verifiedOn`。条数上限自带 `maxVerifiedOn`，因为一个没人核验过的上限不得产出「超出有效范围」的判定。

两部法律（法规）已转录：每个条目带着它所索引条文的文本、该文本抄录的文书与版本、以及抄录日期。指南章节只索引、未转录，因此指南引用一律报「未核验」。

```yaml
- law: 专利法
  article: 22
  paragraphs: [1, 2, 3]
  topics: [新颖性, 创造性]
  text: <现行条文>
  sourceDoc: <官方文本标识>
  verifiedOn: 2026-01-01
```

随包索引覆盖《专利法》82 条中的 36 条、《专利法实施细则》149 条中的 26 条。引用一条确实存在但未被索引的条文会报「索引中不存在」——这是索引的缺口，不是对该条号不存在的断言。文本是按官方修订文本逐字抄录、逐条记录来源的副本，未经人工回读复核，文件头对此有明确说明。

<a id="library-api"></a>
## 库 API

- `parseLawReference(text)` / `extractLawReferences(text)` / `formatLawReference(reference)` —— 引用形式：`专利法第22条第3款`、`《专利法》第二十二条第三款`、`A22.3`、`细则第112条`、`审查指南第二部分第四章3.2.1.1`。
- `parseCnNumber(text)` / `formatCnNumber(value)` —— 中文数字与阿拉伯数字互换（`一百一十二` ↔ `112`）。
- `loadLawBaselines(dir?)` / `parseLawBaseline(source, origin)` / `findArticle` / `findSection` —— 索引加载与校验，缺失即 fail-loud。
- `verifyCitation(reference, baselines, options)` / `verifyCitations(text, baselines, options)` —— 判定。
- `resolveCitationPolicy(finding, policies)` / `renderCitationFindings` / `renderCitationRows` —— 处置与渲染。

本包不发布服务：索引是只读资产，工具是进程内消费者。第二个消费者直接 import 本库（如同 `dsh-patent-core` 作为纯库被消费），而不是为一个运行期不变的值解析服务。

<a id="configuration"></a>
## 配置

Schemastery 配置；`baselineDir` 可选，其余处置字段均有默认值。

| 键 | 类型 | 默认 | 含义 |
| --- | --- | --- | --- |
| baselineDir | string | 随包资产 | 存放法条索引 YAML 的目录。缺失、为空或格式错误会导致插件加载失败。 |
| onMismatch | `block` \| `warn` \| `allow` | `block` | 对所引命题不被已核验条目支撑的处置。 |
| onOutOfRange | `block` \| `warn` \| `allow` | `block` | 对超出已核验条数上限的引用的处置。 |
| onNotIndexed | `block` \| `warn` \| `allow` | `warn` | 对索引中不存在的引用的处置。 |
| onUnverified | `block` \| `warn` \| `allow` | `warn` | 对已索引但待转录条目的处置。 |

<a id="model-experience"></a>
## 模型体验

### law_verify 工具

#### 模型看到什么

一个名为 `law_verify` 的注册工具，可选 `text`（从中抽取引用）、可选 `references`（逐条给出的引用）、可选 `proposition`（这些引用支撑什么）；`text` 与 `references` 至少给出其一。返回的是规范化判定列表——原引用、法律、条号、款号、节路径、判定、处置、理由——外加 `blocked` 标志与各判定的计数，渲染为 Markdown 表格，后附缺口或拦截所意味着的说明。工具描述写明五种判定、未转录条文永不报成已核验，以及无法解析为单条引用的输入按输入错误处理。

#### Token 影响

工具启用期间每次请求固定付出定义开销；每次结果是一张短表加说明，仅在压缩前重发。

#### KV Cache 影响

仅追加；新可见的结果文本跟随可复用的请求前缀，不会使既有 KV 缓存条目失效。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓事项

- **转录文本是机械抄录，不是复核。** 每个法律条目的 `text` 是官方修订文本的逐字副本，因此「已核验」的含义是该条存在、且所引命题与该条主题词相符——不含"由具备资质者回读过副本"的意思。部署在依赖这些条目之前应自行回读复核。
- **法律覆盖面是部分的。** 《专利法》索引 82 条中的 36 条、《专利法实施细则》149 条中的 26 条，因此一条存在但未被索引的条文会报 `not-indexed`，尽管条号有效。两部法律的条数上限均已核验，超出 82 或 149 的条号判「超出有效范围」。
- **《专利法》的主题词已改用 2020 年修正编号。** 现有技术抗辩、不视为侵权、合法来源三组主题词原本按 2008 年修正的 62/69/70 条收录，现改到 2020 年文本承载它们的 67/75/77 条；62 条改按其 2020 年文本的主题（强制许可使用费）。仓库他处的表仍在使用 2008 年编号。
- **《专利法实施细则》的主题词已对照转录条文核对。** 转录条文时发现 26 个已索引条目中有 9 条挂着别的条文的主题词（第 42 条挂着分案申请，而分案申请在第 48 条；第 114 条挂着印花税，而现行细则第一百一十条列举的费种与官方缴费指南都不收该费），已按各自承载的条文重写。
- **指南索引没有文本。** 《专利审查指南》按节路径索引、只有主题词，因此每条指南引用都报「未核验」，直到部署转录自己依赖的章节。
- **命题匹配是词法匹配。** 主题词须出现在命题中或反之；用同义表述而条目未收录该词的命题会报 `mismatch`。主题词须随转录一并维护。
- **紧凑形式 `A22.3` 只在词边界被接受**，且一律读作《专利法》：若某部署需要对其他法律使用该形式，需要自己的引用读取器。
- **指南索引以节路径为键。** 归一化无法复现的写法（例如比捕获的节尾更深的层级）会落进 `not-indexed`，不会被猜成另一节。
- **自动门禁仍保留自己的表。** 专利 preset 已挂载本插件，模型会先跑 law_verify；让工作流质量门禁的静态主题表与规则资产的条号上限改读本索引属后续工作，而那些表仍在用 2008 年修正的条号。
- **不发布包不变量。** 基线的正确性是内容属性，任何运行期观测都不能独立证伪；可机械检查的部分（引用解析、条与节存在性、条数上限）是门禁执行的检查，不满足不变量的门槛。

### 开发备注

无。

不发布 companion：本包不拥有持久状态或会话事件，索引在加载时读取，每个导出都是显式查询上的纯函数。
