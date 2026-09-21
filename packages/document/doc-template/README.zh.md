---
description: "渲染随包分发中文文档模板的函数插件：带 YAML front-matter 与类型化变量模式的模板、能枚举残余占位符与警告的校验式解析、Markdown/HTML/DOCX 三种渲染器，以及 list_doc_templates 与 render_doc_template 两个工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-doc-template

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-doc-template` 加载随 harness 分发的文档模板，并渲染调用方选中的那一份。每个模板是一个 Markdown 资产：YAML front-matter 声明类别、领域、语言、写作风格、支持的格式与变量模式，正文用 `{{snake_case}}` 占位符接收调用方传入的变量。渲染结果同时返回文档、仍然未被填充的占位符与变量警告，调用方无需重新解析就能区分完整文档与残缺文档。

## 目录

- [模板资产](#template-assets)
- [list_doc_templates 工具](#list_doc_templates-tool)
- [render_doc_template 工具](#render_doc_template-tool)
- [变量解析](#variable-resolution)
- [渲染器](#renderers)
- [配置](#configuration)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)

-----

<a id="template-assets"></a>
## 模板资产

十七个模板随包分发在 `assets/templates/<category>/` 下，分属五个类别：`patent-report`（5）、`specification`（4）、`claims`（3）、`oa-response`（3）、`disclosure`（2）。它们全部为中文并用 `language: zh-CN` 自描述；上游项目的 legal 类别不在本批之内。

front-matter 字段如下，全部照搬上游模板约定：

| 字段 | 含义 |
| --- | --- |
| `name` | 模板名，在同一个 store 内唯一；必填。 |
| `title` | 文档标题，用作渲染器的一级标题。 |
| `category` | 文档类别，决定选用哪条样式免责声明。 |
| `description` | 一行描述，展示给模型。 |
| `domain` | 模板所属领域，如 `patent`。 |
| `version` | 模板版本。 |
| `language` | 正文语言；为空表示采用部署默认语言。 |
| `style` | 写作风格名，在已加载的样式里解析。 |
| `use_when` | 适用场景描述。 |
| `formats` | 支持的渲染格式；缺省表示仅 Markdown。 |
| `vars` | 变量定义，每项含 `name`、`type`、`required`、`default`、`description`。 |
| `changelog` | 变更历史，每项含 `version`、`date`、`description`。 |
| `shared_vars` | 与其他模板共享的变量名。 |
| `extends` | 本模板继承的模板名。 |

变量的 `type` 取值是 `string`、`multiline`、`number`、`bool` 之一；未声明类型即单行字符串。`language` 是本批相对上游唯一新增的字段，`formats` 则在上游依赖隐式「仅 Markdown」默认值的地方被显式写出。

<a id="list_doc_templates-tool"></a>
## list_doc_templates 工具

`list_doc_templates` 按类别顺序（patent-report、specification、claims、oa-response、disclosure）再按名称返回可渲染的模板及其变量模式。可选过滤项 `category`、`domain`、`language`、`query` 可任意组合；`query` 是不区分大小写的子串匹配，作用在名称、标题、描述与适用场景文本上。模板的语言取自身声明的 `language`，未声明时取部署默认语言。

<a id="render_doc_template-tool"></a>
## render_doc_template 工具

`render_doc_template` 解析一个模板的变量并渲染它。结果包含渲染后的文档、建议文件名、内容类型、编码方式、解析后的 Markdown 正文、残余占位符与校验警告。`format` 默认 Markdown，且必须是该模板声明的格式之一；`title`、`author`、`date`、`filename` 可覆盖模板自带的值。

以下情形直接报错，而不是返回一份降级文档：未知模板、未知样式名、模板不支持的格式、变量值不是字符串、缺少必填变量。类型不匹配与未填充的占位符不算失败：它们分别以警告和残余占位符的形式报告，因为调用方可能仍需要这份部分填充的文档。

<a id="variable-resolution"></a>
## 变量解析

`validatedResolve(template, variables)` 是上游的解析流水线，语义未改：校验、套用默认值、替换、再报告剩余部分。

- `VarSchema.validate` 先报必填变量缺失再报类型，因为不存在的值没有类型；值不是数值或不是 `true`/`false` 时报 `invalid_type`。
- `VarSchema.applyDefaults` 复制变量并填入声明的默认值；空的默认值视为没有默认值。
- `substitutePlaceholders` 只替换它拿到值的占位符，因此没有值的占位符会留在正文里。
- 返回的 `residual` 按首次出现顺序列出仍然存在的每一个 `{{snake_case}}` 占位符，`warnings` 按声明顺序列出校验问题。

上游把这两个列表交回调用方就结束了。本包保留该流水线，并在其上补一个判断：渲染路径把 `missing_required` 警告升级为错误，因为缺少必填变量的文档不该被当作交付件。残余占位符列表是确定性文档门禁唯一可依据的证据，因此每次渲染成功都会返回它。

<a id="renderers"></a>
## 渲染器

随包分发三个渲染器，按格式注册。

- `markdown` 原样输出解析后的正文，前面加上样式免责声明，以及正文自身没有一级标题时的文档标题。
- `html` 用 `marked`（GFM、硬换行）把正文转成独立文档，样式名指向专利类时用 A4 打印样式表，否则用屏幕样式表。只在这个格式下，变量值在替换前先做 HTML 转义，因为转换器会放行模板自带的原始 HTML。
- `docx` 委托给 `@deepseek-ai/dsh-docx-kit`，它产出的 OOXML 包与上游渲染器一致。

不提供 PDF 渲染器。上游项目有三条：一条 Chrome、一条 LibreOffice、一条自研。harness 已经拥有 Chrome 与 LibreOffice 两条路径，第三条会与两者重复，因此 `pdf` 不是本包的输出格式。

<a id="configuration"></a>
## 配置

Schemastery 配置，所有字段可选。

| 键 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `templateDirs` | string[] | `[]` | 额外的模板根目录，相对工作目录解析，叠加在随包根目录之后。同名的后一个根目录覆盖前一个。 |
| `styleDirs` | string[] | `[]` | 额外的样式目录，按优先度递增叠加在随包目录之后。 |
| `defaultLanguage` | string | `zh-CN` | 未声明语言的模板渲染时使用的语言。 |
| `includeDisclaimer` | boolean | `true` | 是否把样式免责声明注入渲染结果。 |
| `styleGuide` | string | `''` | 把哪个已加载风格的指南注入为系统提示段落；空串表示不注入。 |
| `styleSectionOrder` | number | `100` | 注入的指南在系统提示中的位置。 |

列出的每个目录都必须存在：配置的根目录缺失会让插件加载失败，而不是无声退回到随包资产。`styleGuide` 指定的风格若未加载同样会让加载失败——指南静默不生效会让模型按一套没有校验方认同的风格写作。

## Model Experience

### 注入的样式指南

#### What the model sees

部署指定 `styleGuide` 后，该风格的指南进入系统提示：风格声明的语气、行文原则、禁用词及其替换建议、免责声明、引用规则与输出约定。文档 preset 把它指向 `assistant-neutral`，而 [`@deepseek-ai/dsh-document-deliver`](../document-deliver/README.zh.md) 按同一风格核验登记，因此"被告知要避开的词"与"门禁会拒绝的词"是同一份清单。

#### Token effect

挂载本插件的智能体每次请求都有固定成本：随包的 `assistant-neutral` 指南为 20 行 428 字符，`patent-standard` 为 40 行 1222 字符。不想要固定成本的部署把 `styleGuide` 留空即可；此时禁用词只通过交付门禁的提示到达模型，这也是下文把"关指南、留门禁"记为局限而非建议的原因。

#### KV Cache effect

该段落是静态文本，位于前缀中：注册或移除指南只改变一次前缀，此后不随请求变化。

### render_doc_template 结果

#### What the model sees

`render_doc_template` 的工具定义与结果。结果文本依次给出模板名、格式、建议文件名、内容类型与编码，然后给出残余占位符与警告，最后是文档正文。base64 的 DOCX 结果只报告包大小而不打印它，并把解析后的 Markdown 作为可读文档展示。

#### Token effect

工具启用期间每次请求固定承担定义成本，另加渲染出的文档——这是本插件放进请求的最大一块，一份完整的专利模板大约数千 token。结果只在压缩之前被重发。

#### KV Cache effect

追加式；工具定义与渲染结果都接在可复用的请求前缀之后，不会让已存在的 KV 缓存失效。

### list_doc_templates 结果

#### What the model sees

`list_doc_templates` 的工具定义与结果，每个模板一组行：类别、名称、标题、描述、格式、语言、风格，以及每个变量的类型、是否必填与默认值。过滤后无匹配时用一句话回答，不列出任何模板。

#### Token effect

工具启用期间每次请求固定承担定义成本，另加每个命中模板的一小组行——随包目录全量约数百 token，这也是目录支持过滤而不是整份倾倒的原因。

#### KV Cache effect

追加式；列表接在可复用的请求前缀之后，不会让已存在的 KV 缓存失效。

<a id="known-limitations-and-deferred-work"></a>
## 已知局限与延期工作

- **十二个模板未声明变量** — claims、specification、oa-response、disclosure 的上游资产在正文里给了 `填写指引` 段而不是 `vars` 块，因此 `list_doc_templates` 对它们报告「无变量」，渲染时它们的占位符进入残余列表。模型依据残余列表或资产自带的填写指引补齐；把指引转写成 `vars` 声明属于待办，而不是在这里凭空发明。
- **patent-report 模板只渲染 Markdown 与 HTML** — 它们的正文带 HTML 元数据块（`<div class="doc-meta">`、`<div class="callout">`），DOCX 包无法还原，因此 `docx` 被有意排除在它们的 `formats` 之外。其余十二个模板三种格式都支持。
- **同名只保留一个模板** — store 对每个名字只保留一项，语言变体需要各自的名字，这台上游 store 已说明。因此 `findByNameAndLanguage` 是在唯一一项上做过滤，而不是在多个变体之间选择。
- **模板版本漂移只报告不处理** — `listConflicts` 会指出版本与首次加载不一致的覆盖项；目前没有消费者，也不会合并或降级任何模板。
- **`systemPromptForTemplate` 目前没有消费者** — [`@deepseek-ai/dsh-doc-style`](../doc-style/README.zh.md) 的模板上下文投影已可用，但本包注入的是不带模板上下文的 `systemPrompt`，渲染路径只用到 `toRenderStyle` 与 `disclaimerFor`。
- **注入的指南不是按模板区分的** — 一个智能体只读一份指南，在加载期选定；跨风格组合模板的部署会拿到配置风格的指南，以及各模板自身的免责声明（渲染路径分别解析）。
- **`styleGuide` 留空会让门禁无预告** — [`@deepseek-ai/dsh-document-deliver`](../document-deliver/README.zh.md) 只看风格的 `block` 判定，与模型是否见过指南无关；因此"开了核验但不注入指南"的部署可能拒绝掉模型无从预判的登记。请把 `styleGuide` 设成门禁所用的那套风格。
- **随包模板只有中文** — 资产用 `language: zh-CN` 自描述，不提供双语孪生版本，其他语言的文档需要自己的模板资产。
- **`mergeVarContext` 目前没有消费者** — 多个模板的合并变量空间对组合它们的调用方可用；目前没有随包工具组合模板。
- **DOCX 以 base64 传输** — `docx` 结果把包以 base64 放在 `content` 字段里，体积比原包大约三成；工具文本本身不把包带进对话记录。

### 开发备注

本包是 MIT 许可的 Go 项目 Mady 六个文件的重写：`domains/doctmpl/loader.go`、`vars.go`、`store.go`、`format.go`、`renderer_registry.go`、`renderer_html.go`、`renderer_markdown.go`、`renderer_docx.go`，以及 `domains/doctmpl/templates/` 的二十二个模板与 `doc-templates/` 的二十个模板。有意差异记录在涉及模块的 JSDoc 里：未知格式名会让加载失败，而上游是丢弃；同一个资产根目录内的重名会让加载失败，而上游保留第一个；`DocIndex` 未移植，因为结构化列表取代了它的展示字符串；DOCX 渲染委托给 `@deepseek-ai/dsh-docx-kit`，不再自带第二份 OOXML 写入器。

不发布 companion：本包不拥有任何持久状态或事件，两个工具都是对加载期资产的纯函数，资产缺失或非法会让那次加载失败。
