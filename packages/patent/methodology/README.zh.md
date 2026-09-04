---
description: "函数插件，将 Sati 推理方法论层移植进 DeepSeek Harness：TRIZ 40 条发明原理与经典的 39×39 Altshuller 矛盾矩阵作为包资产随包分发，通过一个 `triz` 工具加上一段简洁的 `tool:triz` 系统提示词区段提供给模型。完整的方法论注册表（八个组件、关键词匹配与提示词注入）也作为无需密钥的库 API 随包分发，供提示词组装消费方使用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-methodology

[English](README.md) | 中文

## 概述

函数插件，将 Sati 推理方法论层移植进 DeepSeek Harness：TRIZ 40 条发明原理与经典的 39×39 Altshuller 矛盾矩阵作为包资产随包分发，通过一个 `triz` 工具加上一段简洁的 `tool:triz` 系统提示词区段提供给模型。完整的方法论注册表（八个组件、关键词匹配与提示词注入）也作为无需密钥的库 API 随包分发，供提示词组装消费方使用。

## 目录

- [triz 工具](#triz-tool)
- [方法论注册表（库 API）](#methodology-registry-library-api)
- [配置](#configuration)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)

<a id="triz-tool"></a>
## triz 工具

`triz` 是基于随包数据的无状态、只读工具。无参数调用它会列出 39 个经典工程参数与 40 条发明原理。传入 `improving` 与 `worsening` 参数编号（各 1-39）可读取对应矛盾矩阵单元格，获得推荐的发明原理编号、名称与说明。对角线单元格（改善参数等于恶化参数）是物理矛盾，不返回经典矩阵条目。

<a id="methodology-registry-library-api"></a>
## 方法论注册表（库 API）

包重新导出移植的方法论层：`MethodologyRegistry`、`DEFAULT_METHODOLOGY_COMPONENTS`、`extractMethodologyKeywords`、`injectMethodology` 以及八个组件（`fiveWhys`、`mece`、`swot`、`pdca`、`fishbone`、`firstPrinciples`、`sixHats`、`triz`）。这些是纯规则、无需密钥的实现；不会有任何东西自动挂载它们——提示词组装消费方自行决定何时匹配并注入方法论提示词。

<a id="configuration"></a>
## 配置

Schemastery 配置，所有字段均可选。

| 键 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `registerSection` | boolean | `true` | 注册常驻的 `tool:triz` 系统提示词区段。 |

<a id="model-experience"></a>
## 模型体验

### TRIZ 系统提示词区段

#### 模型看到的内容

一段名为 `tool:triz`、顺序为 111 的常驻提示词区段，仅在 `registerSection` 为 `true`（默认值）时注册。其逐字文本如下：

##### 区段逐字文本

```markdown
For patent innovation, design-around, and trade-off analysis, use the triz tool when a task names a technical contradiction or conflict between two engineering parameters.
Call triz with no arguments to list the 39 classic engineering parameters and the 40 inventive principles.
Call triz with an improving and a worsening parameter number (1-39) to read that contradiction-matrix cell and its recommended inventive principles.
```

#### Token 影响

区段启用期间，每次请求承担固定的三行成本；禁用 `registerSection` 会移除这三行。

#### KV Cache 影响

只要区段文本与顺序不变，前缀就保持稳定；切换 `registerSection` 会插入或移除该区段，并从该点起使复用失效。

### TRIZ 工具 schema

#### 模型看到的内容

一个名为 `triz` 的已注册工具定义，含两个可选整数参数 `improving` 与 `worsening`（各 1-39）。其确切描述与参数见生成的 [`triz` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-methodology)；结果以 Markdown 渲染，而非 schema token。

#### Token 影响

启用期间，每次请求承担固定定义成本；40 条原理目录与每次矩阵单元格查询都是数据依赖结果，仅在压缩前重发。

#### KV Cache 影响

只追加；新可见的结果文本接在可复用的请求前缀之后，不会使已有的 KV Cache 条目失效。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓事项

- **注册表是库 API，而非挂载的区段** — 八个方法论组件随包分发供消费方匹配与注入，但没有任何东西把它们注册进系统提示词；组合需自行调用 `injectMethodology`。
- **区段文本是静态的** — `tool:triz` 区段是固定文本；它不会随加载的组件集或某个部署的参数列表而变化。
- **仅经典矩阵数据** — 随包分发的 39×39 矩阵是公开的 Altshuller 转录版；不包含空对角线单元格（物理矛盾）与任何更新或派生的矩阵。

### 开发备注

无。

本包不发布 invariant 伴生组件：triz 工具除常规 tools/result 日志外不写入任何包属的持久会话事件；执行关系归它调用的工具注册表所有。
