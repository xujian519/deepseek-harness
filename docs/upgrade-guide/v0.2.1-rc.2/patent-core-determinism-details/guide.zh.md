---
kind: upgrade-guide
description: "`mergeWithSchema` 按码位排序节点名，`FactBlackboard.getFact` 不再返回已丢弃事实，manifest 拒绝非整数重试次数，IPC 上下文的要点与提示各占一行。"
---

# patent-core 修正合并排序、已丢弃事实、manifest 校验与 IPC 上下文

[English](guide.md) | 中文

## 变更

`mergeWithSchema` 改为按 UTF-16 码位排序，不再使用 `localeCompare`。图契约要求同一份日志在每台主机上产出同一状态；`localeCompare` 受运行时区域设置影响，仅大小写不同的节点名可能以不同顺序合并。reducer 语义不变。

`FactBlackboard.getFact(id)` 在 `discardFact(id)` 之后不再返回该事实。此前已丢弃的事实仍能满足 `ruleAssertion`，使回溯掉的事实继续支撑三段论。需要读取历史时用 `getFact(id, { includeDiscarded: true })`；`allFacts()` 仍返回全部事实。

`validateWorkflowManifest` 拒绝不是非负整数的 `retry.maxRetries` 与 `validation.maxRetries`。manifest 来自 YAML 或 JSON，`NaN`、小数或带引号的数字可以穿过声明的 TypeScript 类型；此前的检查只拒绝负数。合法 manifest 不受影响。

`formatStandardsAsContext` 让每条要点与每条提示各占一行。此前两段直接拼接、中间没有分隔符，最后一条要点与第一条提示会挤在同一行。

`SPEC-ABSTRACT` 规则的描述不再引用专利法实施细则第23条。该条针对独立权利要求的必要技术特征，摘要条款也不要求关键词，原引用有误。

依赖 `getFact` 返回已丢弃事实、依赖区域相关的合并顺序、传入小数重试次数或解析拼接后 IPC 行的仓库外代码，会看到新的行为。

## 迁移

1. 调用方若确实要读取已丢弃事实，把 `getFact(id)` 改为 `getFact(id, { includeDiscarded: true })`；否则保留原调用并处理新增的 `undefined`。
2. 不要依赖文档码位序之外的节点顺序。仅大小写不同的节点名现在可能以相反顺序归并。
3. 在 manifest 中传入整数 `maxRetries` 与 `validation.maxRetries`，或省略这两个字段。
4. 若解析渲染后的 IPC 上下文，需按新格式处理：要点与提示各占一行。
5. 确认：`pnpm exec vitest run packages/patent/patent-core packages/patent/patent-rule packages/patent/patent-workflow` 通过，且 `maxRetries: 1.5` 的 manifest 抛出 `必须为非负整数`。
