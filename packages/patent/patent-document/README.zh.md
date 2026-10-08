---
description: "函数插件，将 Sati 专利文书渲染器移植进 DeepSeek Harness：十一个随包分发的专利律师交付物中文 HTML 模板、品牌注入、经 ctx.subprocess 调用 Chrome headless 的 PDF 渲染、render_patent_document 工具，以及 verify_deliverable 交付件一致性核对。"
kind: "package-reference"
---

# @deepseek-ai/dsh-patent-document

[English](README.md) | 中文

## 概述

函数插件，将 Sati 专利文书渲染器移植进 DeepSeek Harness：十一个随包分发的专利律师交付物中文 HTML 模板、品牌注入、经 ctx.subprocess 调用 Chrome headless 的 PDF 渲染、render_patent_document 工具，以及 verify_deliverable 交付件一致性核对。

## 目录

- [render_patent_document 工具](#render_patent_document-tool)
- [verify_deliverable 工具](#verify_deliverable-tool)
- [文档引擎（库 API）](#document-engine-library-api)
- [配置](#configuration)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)

<a id="render_patent_document-tool"></a>
## render_patent_document 工具

render_patent_document 将十一个随包模板之一（patentability-opinion、search-report、oa-response、claims-spec、invalidation-opinion、rectification-response、re-examination-request、infringement-opinion、litigation-pleading、right-evaluation-report 或 search-report-form）渲染为 HTML 文件，默认同时生成 PDF。选定一个模板 id 与 outputName，再以 id -> innerHTML 记录的形式传入 sections 填充模板槽位。结果以模型可读文本返回写出的 htmlPath、pdfPath、可能的 pdfError 与 warnings；当 PDF 失败时，HTML 仍然存在。

渲染器还会检查装配后的文书，把每处发现写进 `warnings`：`一、` 式编号出现在章节级标题之外的层级（章节层级取文档中第一个带编号的标题所在层级，随包模板中带该编号的都用 `h2`，因此带编号的 `h3` 或 `h4` 会与骨架冲突）、章节编号重复、章节编号未按递增顺序、以及标题使用内部工作记录用语。传入的节会替换骨架的**整个**内层内容（含章节标题本身），因此需要保留章节标题的调用方仍须在内容里自行给出。渲染器所检查的规则与用语表在 `document/documentCompliance.ts`；`scripts/verify-patent-document-output.ts` 对产出的文件或随包模板样例离线施加同样的检查。检查只报告不拒绝，因此带发现的文书仍会交到调用方。

模板可用 `data-paragraph-numbering` 在某个容器上声明段落编号，属性值即编号形态（`[0001]` 表示方括号、四位、左补零）。《专利法》《专利法实施细则》与《专利审查指南》均未要求段落编号，因此 claims-spec 的说明书节默认不带该声明；提交体例使用编号时自行加到相应节上，该节内每个 `<p>` 与 `<li>` 就会被写入字面的 `[0001]`、`[0002]`……编号，从 1 起连续；标题、表格内容与只有图片的段落不编号。编号写成字面文本而非 CSS 计数器，是为了让 PDF 与下游的 HTML→docx 转制读到同一串字符。既有编号会先被剥掉再重写，因此重复渲染幂等，手写的编号也不会叠加——请勿手写编号。

<a id="verify_deliverable-tool"></a>
## verify_deliverable 工具

verify_deliverable 判定一次交付是不是案卷主路径所呈现的那一版。传入 artifacts（每组给一个角色、案卷主路径 `canonical_path` 与交付版 `delivered_path`），可另传 figures 与 rendered。每组逐字节比对，rendered 与本次读到的全部输入件按修改时间排序。返回 passed、manifest（角色 + 路径 + SHA-256 + mtime）与违规项：`artifact_mismatch` 表示读者打开案卷主路径看到的是被取代的旧版，`render_order` 表示渲染件早于它呈现的某个输入件。可选 requirements（每条给指令原话与证据文件路径）把本工具变成交付验收的**要求核对表**：要求没有证据、或证据文件不存在即判未通过，返回结果按条给出 requirement/evidence/satisfied，交付报告直接引用它，不用「已按要求复核」这类概括句。

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
| pdfTimeoutMs | number | 120000 | 单次 headless Chrome 打印的超时；部署较慢时可上调，而 SIGTERM->SIGKILL 宽限（3 秒）与单流输出上限（100000 字节）保持固定，分别是收尾对称与内存边界。 |

<a id="model-experience"></a>
## 模型体验

<a id="render_patent_document-tool"></a>
### render_patent_document 工具

#### 模型看到的内容

一个名为 `render_patent_document` 的已注册工具，含必需的 `template` 枚举（十一个 id：`patentability-opinion`、`search-report`、`oa-response`、`claims-spec`、`invalidation-opinion`、`rectification-response`、`re-examination-request`、`infringement-opinion`、`litigation-pleading`、`right-evaluation-report`、`search-report-form`）、必需的 `outputName`，以及可选的 `caseId`、`outputDir`、`format`、`sections`、`brand` 与 `brandPath`。结果以 Markdown 文本渲染，列出写出的 `htmlPath`、`pdfPath`、可能的 `pdfError` 与 `warnings`。

#### Token 影响

工具启用期间，每次请求承担固定定义成本；每次结果是几行简短的文件路径文本，仅在压缩前重发。

#### KV Cache 影响

只追加；新可见的结果文本接在可复用的请求前缀之后，不会使已有的 KV Cache 条目失效。

<a id="verify_deliverable-tool-model-experience"></a>
### verify_deliverable 工具

#### 模型看到的内容

一个名为 `verify_deliverable` 的已注册工具，含必需的 `artifacts` 数组（`role`、`canonical_path`、`delivered_path`）、可选的 `figures`、可选的 `rendered` 路径与可选的 `requirements`（`requirement` 用指令原话，另给 `evidence` 文件路径）。结果以 Markdown 文本渲染：一行通过/未通过标题、逐一列出文件名与 SHA-256、mtime 的交付清单、给出 requirements 时的逐条核对表，随后是各项违规与其建议。

#### Token 影响

工具启用期间，每次请求承担固定定义成本；每次结果为每个读到的文件一行清单。

#### KV Cache 影响

只追加；新可见的结果文本接在可复用的请求前缀之后，不会使已有的 KV Cache 条目失效。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓事项

- **不随包分发默认品牌 theme.json** — 移除了 Sati 的 products/_example/brand/theme.json 默认品牌回退；调用方必须显式传入 brand 或 brandPath，否则使用模板 tokens.css 中的默认值。
- **PDF 需要可探测的 Chrome** — headless PDF 打印经 ctx.subprocess 派生 Chrome（取代 Sati 的 execFile）；当探测不到 Chrome（或未设置 chromePath/DSH_CHROME_PATH）时，渲染降级为仅 HTML，结果携带 pdfError。
- **默认输出目录为 .dsh/documents** — 相对进程工作目录（取代 Sati 的 .sati/documents）；给定 caseId 时仍采用 data/cases/<caseId>/outputs 约定。
- **brandPath 读取 Sati 形态的 theme.json** — 加载器读取该文件的 documents.patent 命名空间；不支持其他主题 schema。
- **无附图页与图片嵌入** — 模板只承载附图说明文字段，渲染出的文档不含附图图像，附图因此以调用方自行命名并随渲染文件一同交付的独立附件到达客户。
- **段落编号是可选体例且依赖渲染器** — `data-paragraph-numbering` 是声明而非标记，只有 render_patent_document 会解释它。《专利法》《专利法实施细则》与《专利审查指南》均未要求段落编号，因此 claims-spec 模板默认不声明；声明了编号的模板依赖渲染路径，且撰写方不得手写编号。

### 开发备注

无。

本包不发布 invariant 伴生组件：render_patent_document 将交付文件写入工作树，除常规 tools/result 日志外不写入包属持久会话事件；模板资产在解析时 fail-loud 校验。
