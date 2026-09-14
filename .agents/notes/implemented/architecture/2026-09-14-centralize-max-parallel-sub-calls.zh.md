# Agent Note: 将 `maxParallelSubCalls` 默认值集中到 `dsh-tools`

Status: implemented

[English](2026-09-14-centralize-max-parallel-sub-calls.md) | 中文

## Problem

`packages/core/tools/src/index.ts` 拥有 `maxParallelSubCalls` 配置字段及其 Loader schema，但数值 `10` 在该文件中出现了三处：`Config.maxParallelSubCalls` 的 JSDoc、`resolveMaxParallelSubCalls` 的回退值，以及 `ToolRuntime.Config` schema 的默认值。`packages/core/agent-loop/src/constants.ts` 又以 `DEFAULT_MAX_PARALLEL_TOOL_CALLS = 10` 的形式导出调度器默认值，且与 tools runtime 没有任何共享绑定。两个包因此拥有了同一并发上限的两个独立事实源。

这是 [Issue #88](https://github.com/xujian519/deepseek-harness/issues/88) 中优先级最高的子项，因为该默认值跨越了一条能力接缝（tools runtime 定义配置，agent loop 消费配置进行调度）。

## Decision

**权威默认值放在 `dsh-tools` 中，紧邻它所默认的配置。** `packages/core/tools/src/index.ts` 现在导出 `DEFAULT_MAX_PARALLEL_SUB_CALLS = 10`，并在 JSDoc 链接、运行时 resolver 回退、Loader schema 默认值三处统一使用它。

**`dsh-agent-loop` 重新导出同一数值。** `packages/core/agent-loop/src/constants.ts` 从 `@deepseek-ai/dsh-tools` 导入 `DEFAULT_MAX_PARALLEL_SUB_CALLS`，并作为 `DEFAULT_MAX_PARALLEL_TOOL_CALLS` 的别名导出，这样调度器保留自己的命名常量，同时不再重复定义数值。

## Alternatives considered

- **把常量移到 `dsh-agent-loop`，让 `dsh-tools` 导入它。** 已拒绝：config schema 和 resolver 都在 `dsh-tools` 中；默认值从消费者导入会颠倒这条接缝的归属关系。
- **新建一个共享的 `constants` 包来存放跨包默认值。** 已拒绝：仅一次重导出的耦合不足以值得新建一个包及其依赖布线。
- **保留重复字面量，靠测试发现漂移。** 已拒绝：可调参数清理的目的正是消除双重事实源，而不是为它们增加守卫。

## Consequences

并发上限现在只有一个事实源。可观察行为没有改变：默认值仍然是 `10`，schema 仍然拒绝非正整数，agent loop 收到的上限也相同。唯一的改变是依赖方向：`dsh-agent-loop/constants` 现在从 `dsh-tools` 引用该数值，与配置的语义归属保持一致。

## Testing

- `pnpm exec vitest run packages/core/tools packages/core/agent-loop` — 805 项通过。
- `pnpm run lint`、`pnpm run typecheck`、`pnpm run duplication` — 无告警/错误。
- `pnpm run doc-sync` — 在重新生成 `docs/config-catalog.md` 并同步其中文孪生后通过。

## Related

- [Issue #88](https://github.com/xujian519/deepseek-harness/issues/88) — 父级硬编码可调参数清理任务。
- [Session history request spec](2026-09-13-session-history-request-spec.zh.md) — 之前的清理工作，将 `resolveMaxParallelToolCalls` 作为显式 resolver 归属默认值的模板引用。
