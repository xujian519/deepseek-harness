---
description: "函数插件，将 TRIZ 40 条发明原理、经典 39×39 Altshuller 矛盾矩阵与 5 条分离原理作为包资产随包分发，通过一个 `triz` 工具加上一段简洁的 `tool:triz` 系统提示词区段提供给模型。矩阵、原理与分离原理也可通过无需密钥的数据 API 读取。"
kind: "package-reference"
---

# @deepseek-ai/dsh-methodology

[English](README.md) | 中文

## 概述

函数插件，将 TRIZ 40 条发明原理、经典 39×39 Altshuller 矛盾矩阵与 5 条分离原理作为包资产随包分发，通过一个 `triz` 工具加上一段简洁的 `tool:triz` 系统提示词区段提供给模型。矩阵、原理与分离原理也可通过无需密钥的数据 API 读取。

## 目录

- [triz 工具](#triz-tool)
- [数据 API](#data-api)
- [配置](#configuration)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)

<a id="triz-tool"></a>
## triz 工具

`triz` 是基于随包数据的无状态、只读工具。无参数调用它会列出 39 个经典工程参数与 40 条发明原理。传入 `improving` 与 `worsening` 参数编号（各 1-39）可读取对应矛盾矩阵单元格，获得推荐的发明原理编号、名称与说明。对角线单元格（改善参数等于恶化参数）是物理矛盾，不返回经典矩阵条目，改为返回 5 条分离原理。该转录版在非对角线位置也有空格（273 个空格中占 234 个），工具会把它说明为矩阵空缺而不是矛盾。本工具只按明确的参数编号查表；从交底书中提取参数或矛盾由 `triz_contradiction_analysis` 这类领域分析工具负责。

<a id="data-api"></a>
## 数据 API

包重新导出基于随包资产的只读、无需密钥 API：`loadMatrix`、`lookupMatrixCell`、`loadPrinciples`、`loadSeparations`、`ENGINEERING_PARAMS`、`paramLabel`、`principleById`、`principleNames` 与 `createTrizTool`。`lookupMatrixCell(improving, worsening)` 会对唯一一个重复源格去重。包内没有任何逻辑会把方法论匹配到任务并自动注入提示词。

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
triz only reads a matrix cell for two explicit parameter numbers; identifying parameters or contradictions from a disclosure is outside its scope.
```

#### Token 影响

区段启用期间，每次请求承担固定的四行成本；禁用 `registerSection` 会移除这四行。

#### KV Cache 影响

只要区段文本与顺序不变，前缀就保持稳定；切换 `registerSection` 会插入或移除该区段，并从该点起使复用失效。

### TRIZ 工具 schema

#### 模型看到的内容

一个名为 `triz` 的已注册工具定义，含两个可选整数参数 `improving` 与 `worsening`（各 1-39）。查询结果包含 `recommended` 原理；对角格另含 5 条 `separations`。其确切描述与参数见生成的 [`triz` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-methodology)；结果以 Markdown 渲染，而非 schema token。

#### Token 影响

启用期间，每次请求承担固定定义成本；40 条原理目录与每次矩阵单元格查询都是数据依赖结果，仅在压缩前重发。

#### KV Cache 影响

只追加；新可见的结果文本接在可复用的请求前缀之后，不会使已有的 KV Cache 条目失效。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓事项

- **仅 TRIZ** — 本包只提供 TRIZ 工具及其数据 API，不包含通用方法论注册表或目标文本参数识别。调用方提供明确的参数编号；从文本中提取参数由领域分析工具负责。
- **区段文本是静态的** — `tool:triz` 区段是固定文本；它不会随某个部署的参数列表变化。
- **仅经典矩阵数据** — 随包分发的 39×39 矩阵是公开的 Altshuller 转录版；1521 个单元格中有 273 个不含推荐（其中 39 个位于对角线、属物理矛盾，234 个在非对角线位置），也不包含任何更新或派生的矩阵。
- **源数据异常** — `(改善 19, 恶化 9)` 格在两个参考来源中都被转录为 `[8, 35, 35]`；读取层会去重，原始值保留。数据来源、许可证与全部已知偏差见 [`assets/README.zh.md`](assets/README.zh.md)。

### 开发备注

无。

本包不发布 invariant 伴生组件：triz 工具除常规 tools/result 日志外不写入任何包属的持久会话事件；执行关系归它调用的工具注册表所有。
