---
description: "函数插件，将 Sati 专利文书渲染器移植进 DeepSeek Harness：九个随包分发的专利律师交付物中文 HTML 模板、品牌注入、经 ctx.subprocess 调用 Chrome headless 的 PDF 渲染，以及 render_patent_document 工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-patent-document

[English](README.md) | 中文

## 概述

函数插件，将 Sati 专利文书渲染器移植进 DeepSeek Harness：九个随包分发的专利律师交付物中文 HTML 模板、品牌注入、经 ctx.subprocess 调用 Chrome headless 的 PDF 渲染，以及 render_patent_document 工具。

## 目录

- [render_patent_document 工具](#render_patent_document-tool)
- [文档引擎（库 API）](#document-engine-library-api)
- [配置](#configuration)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)

<a id="render_patent_document-tool"></a>
## render_patent_document 工具

render_patent_document 将九个随包模板之一（patentability-opinion、search-report、oa-response、claims-spec、invalidation-opinion、rectification-response、re-examination-request、infringement-opinion 或 litigation-pleading）渲染为 HTML 文件，默认同时生成 PDF。选定一个模板 id 与 outputName，再以 id -> innerHTML 记录的形式传入 sections 填充模板槽位。结果以模型可读文本返回写出的 htmlPath、pdfPath、可能的 pdfError 与 warnings；当 PDF 失败时，HTML 仍然存在。

<a id="document-engine-library-api"></a>
## 文档引擎（库 API）

包重新导出移植的引擎供直接调用方使用：renderPatentDocument、renderPdf、findChrome、buildBrandStyle、mergeBrand、loadBrandFromPath、readTemplateManifest、resolveTemplate、readTemplateHtml、getTemplateRoot 与 DocumentRenderError。这些是无需密钥的纯函数；不会有任何东西自动挂载它们。

<a id="configuration"></a>
## 配置

Schemastery 配置，所有字段均可选。

| 键 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| chromePath | string | 无 | 用于 PDF 的 Chrome 可执行文件绝对路径；覆盖 DSH_CHROME_PATH/CHROME_PATH 探测。 |
| outputRoot | string | .dsh/documents | 既未给出 outputDir 也未给出 caseId 时的默认输出目录（相对进程工作目录）。 |

<a id="model-experience"></a>
## 模型体验

<a id="render_patent_document-tool"></a>
### render_patent_document 工具

#### 模型看到的内容

一个名为 `render_patent_document` 的已注册工具，含必需的 `template` 枚举（九个 id：`patentability-opinion`、`search-report`、`oa-response`、`claims-spec`、`invalidation-opinion`、`rectification-response`、`re-examination-request`、`infringement-opinion`、`litigation-pleading`）、必需的 `outputName`，以及可选的 `caseId`、`outputDir`、`format`、`sections`、`brand` 与 `brandPath`。结果以 Markdown 文本渲染，列出写出的 `htmlPath`、`pdfPath`、可能的 `pdfError` 与 `warnings`。

#### Token 影响

工具启用期间，每次请求承担固定定义成本；每次结果是几行简短的文件路径文本，仅在压缩前重发。

#### KV Cache 影响

只追加；新可见的结果文本接在可复用的请求前缀之后，不会使已有的 KV Cache 条目失效。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓事项

- **不随包分发默认品牌 theme.json** — 移除了 Sati 的 products/_example/brand/theme.json 默认品牌回退；调用方必须显式传入 brand 或 brandPath，否则使用模板 tokens.css 中的默认值。
- **PDF 需要可探测的 Chrome** — headless PDF 打印经 ctx.subprocess 派生 Chrome（取代 Sati 的 execFile）；当探测不到 Chrome（或未设置 chromePath/DSH_CHROME_PATH）时，渲染降级为仅 HTML，结果携带 pdfError。
- **默认输出目录为 .dsh/documents** — 相对进程工作目录（取代 Sati 的 .sati/documents）；给定 caseId 时仍采用 data/cases/<caseId>/outputs 约定。
- **brandPath 读取 Sati 形态的 theme.json** — 加载器读取该文件的 documents.patent 命名空间；不支持其他主题 schema。

### 开发备注

无。

本包不发布 invariant 伴生组件：render_patent_document 将交付文件写入工作树，除常规 tools/result 日志外不写入包属持久会话事件；模板资产在解析时 fail-loud 校验。
