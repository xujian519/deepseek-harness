---
description: "函数插件，为专利撰写者或 Agent 提供本部署适用的撰写模式：随包分发的 YAML 撰写模式语料（撰写与审查意见答复场景）经 query_writing_patterns 工具与一个 writing-patterns:skills 系统提示词 section（携带编译后的 `<writing_skills>` 块）到达模型，并作为无需密钥的库 API 供提示词装配使用。选择为词法匹配且离线完成——关键词检索、案件特征匹配、按类目列举或列举整个模式库——故同一查询始终选中同一批模式。"
kind: "package-reference"
---

# @deepseek-ai/dsh-writing-patterns

[English](README.md) | 中文

## 概述

函数插件，为专利撰写者或 Agent 提供本部署适用的撰写模式：随包分发的 YAML 撰写模式语料（撰写与审查意见答复场景）经 query_writing_patterns 工具与一个 writing-patterns:skills 系统提示词 section（携带编译后的 `<writing_skills>` 块）到达模型，并作为无需密钥的库 API 供提示词装配使用。选择为词法匹配且离线完成——关键词检索、案件特征匹配、按类目列举或列举整个模式库——故同一查询始终选中同一批模式。

## 目录

- [query_writing_patterns 工具](#query_writing_patterns-tool)
- [模式语料与库 API](#pattern-corpus-and-library-api)
- [配置](#configuration)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)

<a id="query_writing_patterns-tool"></a>
## query_writing_patterns 工具

query_writing_patterns 返回适配某个撰写或审查意见答复场景的撰写模式，并编译为 `<writing_skills>` 块。每个模式对应一个场景——权利要求撰写、说明书撰写、技术交底书撰写、IPC 策略、具体实施方式撰写，以及关于创造性、新颖性、清楚性的审查意见答复——给出有序步骤及应遵循与应避免的规则。

选择顺序固定且不经过模型。调用给出 `query` 时按关键词检索语料；只给出 features 而不给 query 时，将这些特征与模式名称、摘要、步骤名比对，并以类目充当案件类型；只给出 `category` 时按 id 顺序列举该类目；不带任何参数时列举模式库。`limit` 限制返回条数，缺省取部署的 `matchLimit`。

评分为对著录字段的词项包含计分。关键词检索在名称命中计 3，摘要计 2，场景（context）计 1.5，步骤名计 1，步骤指令或应遵循规则计 0.5，总数再乘该模式的质量权重。特征匹配在类目包含案件类型时计 5，名称命中计 3，摘要计 2，步骤名计 1.5，查询中包含任一模式关键词计 1。同分按模式 id 升序排列，故重复调用返回同一份列表。

结果携带选择模式、每个命中模式的 id、类目、名称、摘要与质量权重、模式库规模，以及编译后的块。无命中时返回空模式列表、空 `skills`，并给出一行文字说明模式库规模及放宽调用的方式。

<a id="pattern-corpus-and-library-api"></a>
## 模式语料与库 API

语料随包分发于 `assets/patterns/`，每个模式一个 YAML 文件，经 `import.meta.url` 相对本模块解析，故源码树与构建产物读取同一目录。文件要么声明一个模式，要么以 `patterns` 列表声明多个，字段为 `id`、`name`、`category`、`summary`，可选的 `sub_category`、`context`、`source_ref`、`version`，以及 `steps`、`examples`、`dos`、`donts`、`quality`。随包的十个模式是 MIT 许可的 Go 项目 `Mady/domains/writing` 的种子模式：实用新型权利要求撰写、从属权利要求分层、背景技术、发明内容、创造性三步法答复、新颖性单独对比、清楚性与支持、交底书 PFE 三元组、IPC 策略、具体实施方式。

加载 fail-loud。`loadPatternStore()` 读取随包目录，`loadPatternStore(patternDir)` 读取显式目录；目录不可读、目录下没有模式文件、YAML 语法错误、id 重复，或字段缺失、类型错误、超出范围，一律抛出 `PatternAssetError` 并点名文件与字段。类目不在已知九类之内同样如此，因为工具的类目枚举永远选不到这样的模式。`quality` 缺失或为零时取移植的默认值 0.8。

库 API 直接导出这些部件：`PatternStore`（`size`、`get`、`all`、`byCategory`、`search`、`match`）、`loadPatternCorpus`、`parsePatternFile`、`patternKeywords`、`compileWritingSkills`、`escapeXmlText` 与 `evaluateQuality`。编译器是模式的纯函数，输出与提示词 section 注入的内容完全一致，故调用方可对注入文本做断言。

`evaluateQuality(text)` 按上游定义的四维给一段成稿打分——结构（标题层级与段落数）、引用（法条、决定、专利文献引用）、论证（逻辑连接词与证据，扣减填充语）、术语（专业术语，扣减商业或绝对化用语）——并报告四维均值。分数是词法启发式的初筛建议，不是对成稿的评判。

<a id="configuration"></a>
## 配置

Schemastery 配置，全部字段可选。

| 键 | 类型 | 默认 | 含义 |
| --- | --- | --- | --- |
| patternDir | string | 随包资产 | 存放模式 YAML 文件的目录，须镜像随包布局。语料缺失或非法将使插件加载失败。 |
| matchLimit | number | 5 | 调用未给出 `limit` 时的返回条数上限。移植的上游来源把一次匹配上限写死为 5。 |
| registerSection | boolean | true | 注册常驻的 writing-patterns:skills 系统提示词 section。 |
| sectionCategories | string[] | 全部九个类目 | 注入 section 的类目；空列表则只注入指令文字。 |
| sectionOrder | number | 112 | 注入 section 在系统提示词中的位置，与专利域的 TRIZ section（111）相邻。 |

<a id="model-experience"></a>
## 模型体验

### query_writing_patterns 工具

#### 模型所见

一个名为 `query_writing_patterns` 的已注册工具，四个可选参数：`category`（九个模式类目之一）、`query`（检索关键词）、`features`（案件的技术特征）与 `limit`。结果渲染为命中模式——id、类目标签、名称、摘要——其后是编译后的 `<writing_skills>` 块，携带这些模式的步骤、应遵循规则与应避免规则。`limit` 小于 1 时以点名该参数的工具错误返回；未知类目在枚举处即被拒绝，不会进入执行。

#### Token 影响

工具启用期间每次请求承担固定定义成本；每次结果重复命中模式及其编译块，故 `limit` 越大成本越高，仅在压缩前重复占用上下文。

#### KV Cache 影响

仅追加；新可见的结果文本位于可复用的请求前缀之后，不使既有 KV 缓存条目失效。

### writing-patterns:skills 系统提示词 section

#### 模型所见

一个常驻的提示词 section，名为 `writing-patterns:skills`，仅在 `registerSection` 为 `true`（默认）时以位置 112 注册，携带 `sectionCategories`（默认为全部类目）中模式的编译后 `<writing_skills>` 块。其指令文字为：

##### 指令原文

```markdown
The <writing_skills> block below lists the writing patterns of this deployment for patent drafting and office-action replies; each pattern names one drafting situation with its ordered steps and the rules to follow or avoid.
When the case at hand is not covered by those patterns, call query_writing_patterns with the case category, the case features, or search keywords to retrieve the patterns that match it.
```

#### Token 影响

每次请求承担两行指令的固定成本，加上注入类目的编译块，该块仅在压缩前重复占用上下文；`sectionCategories` 为空时只剩两行指令，`registerSection: false` 则整个 section 消失。

#### KV Cache 影响

section 文本、其位置与编译块不变时前缀稳定；改动 `sectionCategories`、`sectionOrder`、`patternDir` 或任一模式资产都会重新编译该块，并自该 section 起使缓存复用失效。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓事项

- **随包语料只有十个种子模式** —— 它们只覆盖移植种子集的场景，别处一概不覆盖。把 `patternDir` 指向部署自备目录即可替换；其中每个文件仍须满足同一套字段规则，否则插件加载失败。
- **选择只是词法匹配，从不做语义理解** —— 查询匹配的是著录中文字段的子串，故同一场景换个说法可能命中不到。工具结果最后一段给出模式库规模，使模型能区分「库窄」与「查询窄」。
- **`query` 与 `features` 计分方式不同且不叠加** —— 两者同时给出时按关键词检索，忽略特征匹配；特征匹配服务于已知特征、却不知如何措辞的案件。
- **提示词 section 默认注入整个模式库** —— 随包语料下每次请求约 24 KB 编译文本。若部署只撰写其中部分场景，请收窄 `sectionCategories`；工具本身不受影响，始终完整。
- **`examples` 只被解析，从不参与编译** —— 编译块只含步骤、应遵循规则与应避免规则，与移植的编译器一致，且种子语料未设置 examples。需要渲染示例的调用方自行从 store 读取。
- **质量评分为启发式，而非评判** —— 四维词法评分配固定词表。上游另有进程内用户反馈存储、用户评级与自动分对用户分的校准；此处一概不发布，因为只存在于单个进程中的评级不构成持久证据。
- **工具只读且无状态** —— 它读取插件加载时读入的语料，自身不写入任何持久状态或会话事件；其结果仅作为普通工具结果进入日志。
- **资产失败发生在加载期而非调用期** —— 语料非法或缺失时在插件挂载阶段抛出 `PatternAssetError`，故部署不会带着空模式库面对模型。

<a id="dev-note"></a>
### 开发备注

无。

本包不发布 invariant 伴生组件：本包不持有持久状态与事件，每个导出都是针对语料的纯函数，唯一读取的资产目录在插件加载时 fail-loud 校验。
