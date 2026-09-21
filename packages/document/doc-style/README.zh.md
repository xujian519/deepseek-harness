---
description: "纯 TypeScript 库（无 `ctx` 依赖），持有文档写作风格模型：tone、voice、anti-patterns、免责声明与引用约定的 DocumentStyle 词汇、随包分发中文样式资产的加载器，以及 system-prompt、模板上下文、渲染样式三个投影。"
kind: "package-reference"
---

# @deepseek-ai/dsh-doc-style

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-doc-style` 持有文档写作风格模型：某个领域的一份文档遵循什么语气、口吻、禁用词、免责声明与引用约定。一份样式是带六段内容的 YAML 资产；本包加载随包中文样式，把部署自备目录叠加在其上，并把一份样式投影成消费者需要的三种形态。本包不接收 Cordis 上下文、不注册工具与提示词段，也不拥有任何持久状态。

## 目录

- [样式资产](#style-assets)
- [投影](#projections)
- [加载](#loading)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)

-----

<a id="style-assets"></a>
## 样式资产

四个样式随包分发在 `assets/styles/` 下，转写自上游项目：`patent-standard`、`legal-standard`、`assistant-neutral`、`chat-friendly`。每个样式声明名称、领域、版本以及以下段落：

| 段落 | 含义 |
| --- | --- |
| `tone` | 正式程度、叙述人称与语言标签。 |
| `voice` | 口吻原则，每条一句祈使句。 |
| `anti_patterns` | 禁用或慎用词及其替换词，严重度为 `block` 或 `warn`。 |
| `disclaimers` | 按类别键索引的免责声明文本。 |
| `citation` | 引用位置与格式模板。 |
| `output_conventions` | 是否标注置信度、是否弱化低置信度内容。 |

样式资产是文件边界，因此加载时对每个声明值都做校验：正式程度超出 `casual`/`professional`/`academic`、严重度超出 `block`/`warn`、引用风格超出 `inline`/`footnote`/`endnote`、免责声明为空、约定不是布尔值，都会让加载失败。资产省略的段落保持空值。

<a id="projections"></a>
## 投影

一份样式投影成四种形态，因为各消费者需要的部分不同。

- `systemPrompt(style)` 把整份指南渲染成模型动笔前阅读的文本块：语气、口吻原则、禁用词及其替换词、免责声明、引用规则与输出约定。样式留空的段落整体不输出。
- `systemPromptForTemplate(style, template)` 在该指南之后补上模板的名称、标题、类别与必需免责声明。它只读取 `name`、`title`、`category`，所以调用方传任意模板记录即可，不必是 `@deepseek-ai/dsh-doc-template` 的类型。
- `toRenderStyle(style, categoryHint)` 把样式裁剪成渲染器要注入的部分：选中 HTML 样式表的名称，以及免责声明。
- `disclaimerFor(style, category)` 选取某个模板类别的免责声明：`specification` 与 `claims` 取 `patent_drafting`，`oa-response` 与 `disclosure` 取 `patent_analysis`，没有对应条目的类别回退到领域级 `<domain>_analysis`。两者都没有时返回空字符串，表示不需要免责声明。

`stylesForDomain(styles, domain)` 与 `findStyleByName(styles, name)` 按领域与按名称查询已加载的样式集合。

<a id="loading"></a>
## 加载

`loadStyles(directories)` 读取每个列出目录的全部 `.yaml` 资产并叠加：后列目录里同名样式就地替换先前的样式，因此部署无需重新编译即可覆盖随包样式。每个列出的目录都必须存在，非法资产会中止加载，最终为空也是错误。`stylesDirectory()` 解析随包目录，调用方把它列在第一位。

上游加载器会跳过不存在的目录、跳过解析失败的文件。本包把两者都当作失败：配置目录里的一个笔误，或一个损坏的覆盖项，不该让部署无声地停留在随包默认值上。

## Model Experience

### 消费者渲染的样式文本

#### What the model sees

本包没有自己的提示词段与工具 schema。把样式指南注入请求的消费者调用 `systemPrompt` 或 `systemPromptForTemplate` 并拥有装配过程，因此模型看到的是消费者渲染的文本块，例如 `Style: <name> (domain: <domain>, version: <version>)`，其后是该样式声明的各段落。

#### Token effect

不单独产生开销；样式指南只通过消费者进入请求，大小取决于该样式声明的段落。

#### KV Cache effect

无：本包不向提供方发送任何内容，也不改动请求前缀。

<a id="known-limitations-and-deferred-work"></a>
## 已知局限与延期工作

- **`systemPromptForTemplate` 目前没有消费者** — [`@deepseek-ai/dsh-doc-template`](../doc-template/README.zh.md) 用到 `toRenderStyle`、`disclaimerFor`，以及（部署指定 `styleGuide` 时）`systemPrompt`；模板上下文投影在等一个消费者，这也是它没有配套接线的原因。
- **免责声明映射就是上游映射** — 类别键与 `<domain>_analysis` 回退都是照抄的，因此以后新增的类别需要自己的 `DISCLAIMER_CATEGORY_KEYS` 条目，而不是推导出来的键。
- **只有 `style` 能选中样式** — 模板在 front-matter 里点名样式；渲染期没有按领域选择样式的机制，因此未声明样式的模板渲染时不带免责声明。
- **方向性并未强制** — 加载的 `tone.perspective` 与 `citation.style` 只作为取值被校验，没有任何东西拿文档去比对它们。[`@deepseek-ai/dsh-document-deliver`](../document-deliver/README.zh.md) 只核验其中唯一能机械化的一项——`anti_patterns` 词表，按资产声明的严重级别判定；其余方向要强制执行就得读懂文档含义，本包不提供。
- **随包样式只有中文** — 资产声明 `language: zh-CN` 并承载中文原则，其他语言的样式需要新的资产。

### 开发备注

本包是 MIT 许可的 Go 项目 Mady 两个文件的重写：`domains/config/style.go` 提供模型与其投影，`domains/config/style_embed.go` 提供加载器，另加 `styles/*.yaml` 四个资产。有意差异记录在涉及模块的 JSDoc 里：上游跳过不存在的目录与非法文件，本包改为 fail-loud；`systemPromptForTemplate` 接收结构化模板记录，因此本库永不依赖 `@deepseek-ai/dsh-doc-template`。

不发布 companion：本包不拥有任何持久状态或事件，每个导出都是对显式加载的样式集合的纯函数，唯一读取的资产目录在加载期 fail-loud 校验。
