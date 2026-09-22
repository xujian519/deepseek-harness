---
description: "函数插件，供[文档智能体 preset](../../bundle/web-app/presets/document.patch.yml)使用：一个模型可见的 `document_deliver` 工具，登记交付的成品文件、导出格式与质量门结果，并自行读取这些文件、把确定性核验结论与模型自述并列。调用写入会话日志，[交付工作室](../../../packages/client/ui-document-studio/README.zh.md)据此从日志与结果元数据推导交付物列表与两列质量门——不新增会话事件类型，也不新增 host 写 RPC。"
kind: "package-reference"
---

# @deepseek-ai/dsh-document-deliver

[English](README.md) | 中文

## 概述

函数插件，供[文档智能体 preset](../../bundle/web-app/presets/document.patch.yml)使用：一个模型可见的 `document_deliver` 工具，登记交付的成品文件、导出格式与质量门结果，并自行读取这些文件、把确定性核验结论与模型自述并列。调用写入会话日志，[交付工作室](../../../packages/client/ui-document-studio/README.zh.md)据此从日志与结果元数据推导交付物列表与两列质量门——不新增会话事件类型，也不新增 host 写 RPC。

## 目录

- [挂载内容](#what-it-mounts)
- [确定性核验](#deterministic-checks)
- [Model Experience](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

<a id="what-it-mounts"></a>
## 挂载内容

- **`document_deliver`** —— 声明 `files`（`{ path, format }`，format 取值 `markdown | html | pdf | docx | pptx | other`）、`gate`（必填的 `p0` 已通过项列表、可选 `p1` 列表）、可选 `brief_ref`、可选 `style` 风格名、可选 `char_budget` 字数预算。按调用方会话工作区解析每个路径；文件不存在（幽灵文件不算交付物）即报错；随后读取每个交付文件跑确定性核验，回执 P0/P1 项数、所用风格与每个文件一份核验报告。

<a id="deterministic-checks"></a>
## 确定性核验

工具读取交付文件本身，而不是相信模型的自述。Markdown 与 HTML 按文本读取；`.docx` 包经 [`@deepseek-ai/dsh-docx-kit`](../docx-kit/README.zh.md) 投影为文本；没有文本读取器的格式（`pdf`、`pptx`、`other`）报为 `unchecked` 并附原因，而不是"通过"。

| 检查 | 触发条件 | 级别 |
| --- | --- | --- |
| `placeholder` | 残留 `{{变量}}`、`[TBD]`、`[REPLACE]`、`Lorem ipsum` 或 `待补充` | 引用文本之外 `block`，代码块或行内代码之内 `warn` |
| `anti_pattern` | 所选风格把该词列为禁用 | 沿用风格自身的 `block` / `warn` |
| `empty_section` | 标题到下一个标题之间没有任何内容 | `warn` |
| `broken_anchor` | `](#片段)` 或 `href="#片段"` 指向本文档未声明的 id、命名锚点或标题 slug | `warn` |
| `length_budget` | 声明的 `char_budget` 偏差超过 20% | `warn` |

`block` 级问题直接抛错：拒绝登记，错误信息指出文件、检查项与行号，模型修复文档而不是把它登记出去。`warn` 级问题记录在结果里、登记照常进行——它们都存在评审可以接受的读法。风格取自 `defaultStyle`，单次调用可用 `style` 覆盖；未加载的风格名会让调用失败并列出可用名称。每项检查最多列 5 条，其余汇总一行，不静默丢弃。

## Model Experience

### 工具 schema

#### 模型看到什么

一个已注册的工具定义：`document_deliver`，含参数 schema（文件列表与格式、质量门清单、可选 brief 引用、风格名、字数预算）与登记回执渲染；回执包含模型自报的 P0/P1 项数、每个文件的确定性核验结论与每条提示。精确的 description 与参数见生成的[工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-document-deliver)。

#### Token 影响

固定一个工具的定义成本，每次请求都存在；结果内容是回执加每条提示一行，压缩前每次结果都会重发。本包不注册 system-prompt 段落，无额外固定提示词成本；可配置的样式指南由 [`@deepseek-ai/dsh-doc-template`](../doc-template/README.zh.md) 注入，本包核验所用的风格资产同样由该包持有。

#### KV Cache 影响

注册工具集与 description 不变时前缀稳定。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **登记是声明而非转换** —— 工具不复制、渲染或转换文件，只做存在性与内容核验并在会话日志记录声明。PDF 导出仍走交付工作室的打印动作；幻灯片与特殊 Office 格式转换仍依赖用户级 `officecli` 技能。
- **无跨会话聚合** —— 交付工作室只折叠单个会话的日志窗口；跨会话历史、搜索与批量导出属于延期的文档工作台 v2（见[工作台提案](../../../.agents/notes/proposed/feature/2026-08-23-document-mode-workbench.zh.md)）。
- **核验不等于评审** —— 它只覆盖质量门里可机械判定的部分（占位符、风格禁用词、空章节、同文档片段、声明字数预算），对来源、正确性、可访问性不发一言。P0/P1 项仍是模型的自述；工具把结论并列展示而不去验证它，面板两列都显示。
- **只强制已配置风格的词表** —— 需要避开风格词表之外用词的部署，应把这些词加进风格资产（或用 `styleDirs` 指向自己的目录）。单次调用的豁免参数会让禁用词无理由地溜过去且不留记录，故本工具不提供。
- **锚点检查是启发式** —— 它接受 `id`/`name` 属性声明的片段，或按 GitHub 规则命名的标题 slug，因此采用其他 slug 约定的渲染器可能产生"其实没断"的 `broken_anchor` 提示；正因为如此该检查只报提示。
- **超限是跳过而非截断** —— 超过 4 MiB 的交付物不再读取，报为 `unreadable` 并附原因；核验跑在"什么都没查"上，而不是跑在一个可能恰好通过的开头上。

### 开发备注

确定性核验为本包原创，不是移植：它读取移植来的风格资产（[`@deepseek-ai/dsh-doc-style`](../doc-style/README.zh.md)）的禁用词表，以及移植来的模板引擎（[`@deepseek-ai/dsh-doc-template`](../doc-template/README.zh.md)）的占位符约定。`document_deliver` 工具本身、其参数校验与存在性检查沿用原插件，未作改动。

不发布运行时不变式伴生：工具除常规 tool/call 与 tool/result 日志外不写入包级持久会话事件，tool/result 日志由工具注册表持有，本包报告的核验结论也没有本包之外的持有者。
