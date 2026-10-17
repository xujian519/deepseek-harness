---
kind: upgrade-guide
description: "@deepseek-ai/dsh-methodology 移除未使用的方法论注册表、注入器与通用组件，只保留 TRIZ 工具及其数据 API。"
---

# Methodology 包移除未使用的方法论注册表

[English](guide.md) | 中文

## 变更

`@deepseek-ai/dsh-methodology` 不再导出 `MethodologyRegistry`、`DEFAULT_METHODOLOGY_COMPONENTS`、`injectMethodology`、`extractMethodologyKeywords`、八个组件（`fiveWhys`、`mece`、`swot`、`pdca`、`fishbone`、`firstPrinciples`、`sixHats` 与 TRIZ 组件）、`detectParamNumbers`，以及方法论协议类型（`MethodologyComponent`、`MethodologyContext`、`MethodologyMatch` 等相关类型）。本仓库内没有消费方使用它们。

`triz` 工具、其 `tool:triz` 系统提示词区段、`createTrizTool` 与数据 API 保留：`loadMatrix`、`lookupMatrixCell`、`loadPrinciples`、`loadSeparations`、`ENGINEERING_PARAMS`、`paramLabel`、`principleById` 与 `principleNames`。`lookupMatrixCell` 现在会对 `(19, 9)` 的源转录去重，`triz` 的对角物理矛盾查询结果新增 `separations` 数组。

## 迁移

1. 当改善与恶化参数编号已知时，用显式 `triz` 工具调用替代 `injectMethodology(registry, goal)`。编号未知时，改用读取源文本的领域分析工具，例如 `triz_contradiction_analysis`。

2. 如果调用方自己持有组件，用直接组件逻辑替代 `new MethodologyRegistry()` 与 `DEFAULT_METHODOLOGY_COMPONENTS`。本包不再提供通用组件的替代实现。

3. 用模型或领域提取器提供的参数替代 `detectParamNumbers(goal)`。本包不再从自然语言猜测参数编号。

4. 直接读取矩阵时，继续使用 `lookupMatrixCell(improving, worsening)` 或 `createTrizTool()`。两者仍然导出，返回相同的原理编号，并已去重。

5. 确认迁移：`pnpm run build` 通过，且生产代码不再导入被移除的符号。仓库搜索仍会命中历史 Agent Note、本指南，以及 `packages/patent/methodology/tests/scaffold.spec.ts` 中验证导出已消失的断言。

本版本目录中的升级指南继续记录外部可见的破坏性变更；决策依据见 [methodology 范围说明](../../../../.agents/notes/implemented/simplification/2026-10-17-methodology-registry-scope.zh.md)。
