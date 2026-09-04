---
description: "函数插件，供[文档智能体 preset](../../preset/agent-presets/presets/document/preset.yml)使用：一个模型可见的 `document_deliver` 工具，登记交付的成品文件、导出格式与质量门结果。工具调用与其他工具一样写入会话日志，[交付工作室](../../../packages/client/ui-document-studio/README.zh.md)据此从日志推导交付物列表（路径、格式、质量门状态）——不新增会话事件类型，也不新增 host 写 RPC。"
kind: "package-reference"
---

# @deepseek-ai/dsh-document-deliver

[English](README.md) | 中文

## 概述

函数插件，供[文档智能体 preset](../../preset/agent-presets/presets/document/preset.yml)使用：一个模型可见的 `document_deliver` 工具，登记交付的成品文件、导出格式与质量门结果。工具调用与其他工具一样写入会话日志，[交付工作室](../../../packages/client/ui-document-studio/README.zh.md)据此从日志推导交付物列表（路径、格式、质量门状态）——不新增会话事件类型，也不新增 host 写 RPC。

不发布运行时不变式伴生；工具除常规 tool/call 与 tool/result 日志外不写入包级持久会话事件，tool/result 日志由工具注册表持有，本包之外无人读取这些注册文件。


## 目录

- [挂载内容](#what-it-mounts)
- [Model Experience](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

<a id="what-it-mounts"></a>
## 挂载内容

- **`document_deliver`** —— 声明 `files`（`{ path, format }`，format 取值 `markdown | html | pdf | docx | pptx | other`）、`gate`（必填的 `p0` 已通过项列表、可选 `p1` 列表）、可选 `brief_ref`。按调用方会话工作区解析每个路径；文件不存在（幽灵文件不算交付物）即报错；登记成功时回执 P0/P1 项数。

## Model Experience

### 工具 schema

#### 模型看到什么

一个已注册的工具定义：`document_deliver`，含参数 schema（文件列表与格式、质量门清单、可选 brief 引用）与登记回执渲染。精确的 description 与参数见生成的[工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-document-deliver)。

#### Token 影响

固定一个工具的定义成本，每次请求都存在；回执内容仅几行，压缩前每次结果都会重发。未注册 system-prompt 段落，无额外固定提示词成本。

#### KV Cache 影响

注册工具集与 description 不变时前缀稳定。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **登记是声明而非转换** —— 工具不复制、渲染或转换文件，只做存在性校验并在会话日志记录声明。PDF 导出仍走交付工作室的打印动作；`.docx`/`.pptx` 转换仍依赖用户级 `officecli` 技能。
- **无跨会话聚合** —— 交付工作室只折叠单个会话的日志窗口；跨会话历史、搜索与批量导出属于延期的文档工作台 v2（见[工作台提案](../../../.agents/notes/proposed/feature/2026-08-23-document-mode-workbench.zh.md)）。
- **质量门状态由模型自报** —— P0/P1 项来自模型自己的质量门自检；工具只强制 P0 非空与文件存在，不保证清单被如实执行。

### 开发备注

无。
