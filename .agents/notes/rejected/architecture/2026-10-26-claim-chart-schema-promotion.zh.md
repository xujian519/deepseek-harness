# Agent Note: 把 claim-chart schema 升格为受管契约

Status: rejected — schema 已位于公共 API 表面并走升级指南流程，跨域复用已被法律泛化研究否决，会话事件只会重复工具结果已记录的内容

[English](2026-10-26-claim-chart-schema-promotion.md) | 中文

## 问题

`claim_chart_build` 由 `packages/patent/patent-core/src/claim-chart/` 构建要素级权利要求对照表。它的数据由三层定义：`protocol/types.ts` 的 TypeScript 协议（`ClaimChart`、`ChartRow`、`GapEntry` 等）、`CHART_SCHEMA`（`atoms/handlers/builtin/chart.ts`）约束的模型产出子集，以及 `runtime/` 的运行时不变量（要素校验、映射状态机、引用关系、pin-cite 校验）。一次运行写入 `data/cases/<caseId>/outputs/claim-chart-<chartId>.json` 与 Markdown 交付物；没有会话事件承载图表。

M3-T3 已从 M3 里程碑（#555）移出，成为 #585：在 M4 之后决定是否把该 schema 升格——升为受管 schema、跨包复用或持久化。转出的任务没有定义范围与验收，评估必须先确定目标再作判断。

## 提案

把 claim-chart schema 升格为共享、版本化的契约：

1. 跨域复用：法律与其他域按同一「要素 → 证据」网格映射证据。
2. 受管 schema：从协议生成 JSON Schema，赋予版本号，并按该版本迁移已存图表文件。
3. 耐久持久化：追加 `patent/claim-chart` 会话事件，经 `ctx.storage` 写入图表，取代工作区文件。

## 曾考虑的替代方案

### 为什么不跨域复用？

法律泛化研究（[R1, #576](../../proposed/architecture/2026-10-24-seven-step-legal-generalization.zh.md)）认定法律三元绑定是「要件 → 事实 → 证据」，而 claim chart 编码的是「技术特征 → 证据 → 法条」；其映射矩阵把五个法律任务族全部标为需要改写 schema，#551 记录的结论是「不移植 claim-chart schema」。共享该网格会把专利前提带进法律分析。

### 为什么不采用版本化受管 schema？

该协议已经是公共 API 表面：`packages/patent/patent-core/src/index.ts` 整体再导出 `claim-chart` 模块，对外可感知的变更已走升级指南流程（`docs/upgrade-guide/v0.2.1-rc.2/patent-chart-source-confinement/`）。模型可见的输入与输出由 `defineTool` 与工具目录管理；`CHART_SCHEMA` 的枚举直接取自 `MAPPINGS` 与 `ELEMENT_KINDS`；落盘 JSON 刻意包含模型不产出的字段（`claims`、`gaps`、`invalidityConclusion`）。仓库已拒绝全仓运行时 schema 注册表（[typed-event-schemas](2026-06-16-typed-event-schemas.zh.md)），而 `loadClaimChart` 的两条同版本兼容路径（缺少 `claims`、`gaps[].mapping` → `kind`）是有意的读取器行为，不是漂移。版本化只会把这些义务移进格式版本，而不会消除它们。

### 为什么不采用耐久持久化？

`claim_chart_build` 返回完整的 `chart` 值，因此模型可见的每个事实都能从会话日志里的工具结果重建。JSON 文件符合 worker 惯例（`data/cases/<caseId>/outputs/`），并跨重跑保留 HITL `verified` 状态。`patent/claim-chart` 事件需要持久化评审、双 SDK 投影、keyless 快照与升级指南，却不会新增文件与工具结果尚不具备的能力。

### 为什么保留现有分层？（选定）

三层承担不同义务：TypeScript 协议是公共契约，`CHART_SCHEMA` 只约束模型可产出的内容，运行时校验器强制语义不变量（逐字子串、pin-cite 格式、覆盖规则）。把它们合并成一份生成 schema，要么把派生字段暴露给模型，要么丢弃运行时检查。

出现以下任一情况时重开该决策：仓外消费者需要稳定的 JSON Schema 承诺；其他域需要共享证据网格（须先推翻 R1）；或出现工作区文件无法满足的跨会话审计、回放需求。
