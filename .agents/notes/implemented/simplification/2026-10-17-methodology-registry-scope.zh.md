# Agent Note: Methodology package scope

Status: implemented

[English](2026-10-17-methodology-registry-scope.md) | 中文

## Problem

`@deepseek-ai/dsh-methodology` 在 TRIZ 工具之外还导出了一整套推理方法论注册表：`MethodologyRegistry`、`DEFAULT_METHODOLOGY_COMPONENTS`、`injectMethodology`、`extractMethodologyKeywords`、八个通用组件，以及一条确定性参数识别路径。包外的任何 package、preset、技能或测试都没有调用它们。包 README 把注册表描述为供提示词组装消费方使用的库 API，但这样的消费方并不存在。

这套未使用接口还带来维护成本和一个已知质量缺口：`detectParamNumbers` 用短子串匹配，`提高能力` 会命中参数 10（力），`降低应力` 同时命中 10 与 11，`提高强度同时减轻重量` 同时命中运动重量与静止重量。唯一的调用方是注册表的 TRIZ 组件，它把识别出的参数两两交叉、双向查表，并把相互矛盾的查表行注入提示词。

## Decision

本包只发布 TRIZ 能力：

- `triz` 工具与 `tool:triz` 系统提示词区段；
- `assets/` 下的矩阵、原理与分离原理资产；
- 读取这些资产的 API：`loadMatrix`、`lookupMatrixCell`、`loadPrinciples`、`loadSeparations`、`ENGINEERING_PARAMS`、`paramLabel`、`principleById`、`principleNames` 与 `createTrizTool`；
- TRIZ 类型。

方法论注册表、注入器、关键词匹配器、八个组件、方法论协议类型、`detectParamNumbers`，以及 `TrizParameter` 上的 `match` 字段全部移除。调用方若已持有明确的改善/恶化参数编号，使用 `triz` 或 `lookupMatrixCell`；从文本中提取参数或矛盾交给拥有该职责的领域工具，例如 `triz_contradiction_analysis`。

只有在出现真实的提示词组装消费方、且该消费方同时负责语义参数提取时，才重新引入方法论注册表。没有消费方的注册表不是库 API，而是一条从未被执行的代码路径。

## Alternatives considered

**把注册表保留为库 API。** 这能保留从 Sati 移植的接口并避免破坏性包变更。代价是留下没有消费方的代码、只验证自身的测试，以及会误导第一个调用方的参数识别器。仓库关于“不得导出无人使用的 API”的规则适用。

**把注册表接入提示词组装。** 增加受 Config 控制的 `autoInject` 可以补上消费方并让组件进入产品路径。但它也会把有损识别器变成产品路径，必须先补齐同义词表、方向解析与运动/静止消歧，才值得信任。当前没有产品需求支撑这一范围。

**把组件移到 `packages/experimental/`。** 这能保留代码并标记为非产品。但识别器与其测试仍需归属，跨包移动公共导出同样是破坏性变更。删除具有相同的迁移成本，且留下的表面积更小。

## Consequences

发布包的入口不再包含 `MethodologyRegistry`、`DEFAULT_METHODOLOGY_COMPONENTS`、`extractMethodologyKeywords`、`injectMethodology`、`fiveWhys`、`mece`、`swot`、`pdca`、`fishbone`、`firstPrinciples`、`sixHats`、TRIZ 组件、`detectParamNumbers` 与方法论协议类型；`TrizParameter` 移除 `match` 字段。[升级指南](../../../../docs/upgrade-guide/v0.2.1-rc.1/methodology-registry-removal/guide.zh.md)说明迁移方式。TRIZ 工具、其 schema、提示词区段与数据读取 API 仍然导出。其行为在本版本中发生以下变化：矩阵补回 58 个非空格，`lookupMatrixCell` 对 `(19, 9)` 源格去重，lookup 输出新增 `separations`，提示词区段新增一行工具路由说明。

删除识别器是用移除来消解方向丢失缺陷：现在只支持明确的参数编号，由模型或领域工具提供。本包不再声称能从目标文本识别方法论，README 也不再宣传注册表。
