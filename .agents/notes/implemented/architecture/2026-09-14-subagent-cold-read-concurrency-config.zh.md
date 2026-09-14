# Agent Note: 将 subagent 冷读并发数变为可配置

Status: implemented

[English](2026-09-14-subagent-cold-read-concurrency-config.md) | 中文

## Problem

`packages/subagent/subagent/src/list-children.ts` 将 `COLD_READ_CONCURRENCY = 4` 硬编码，并在 `listChildren` 与 `listDescendants` 解析冷候选时直接使用。源码注释已指出，网络化持久化提供方出现时必须将该值提升为经验证的部署设置，但当时没有可提升的配置字段或命名默认值。这是 [Issue #88](https://github.com/xujian519/deepseek-harness/issues/88) 中次高优先级的项。

## Decision

**`coldReadConcurrency` 现在是 `SubagentRuntime` 的配置字段。** `packages/subagent/subagent/src/index.ts` 声明：

- 从 `list-children.ts` 导出 `DEFAULT_COLD_READ_CONCURRENCY = 4`。
- `Config.coldReadConcurrency?: number`，由 Cordis loader 解析。
- `static Config` schema，默认值为 `DEFAULT_COLD_READ_CONCURRENCY`，并校验该值为正整数。
- `SubagentRuntime` 上的私有 `coldReadConcurrency` 字段，传入每一次 listing 调用。

`listChildren` 与 `listDescendants` 保留原有签名，并新增一个可选的末尾 `coldReadConcurrency` 参数，默认值为 `DEFAULT_COLD_READ_CONCURRENCY`，因此直接调用者不受影响。

## Alternatives considered

- **保留模块级常量，另加 setter 或每次调用的参数。** 已拒绝：AGENTS.md 要求默认值必须是服务边界上显式的 `resolve(request): Spec` 步骤，而不是隐藏常量或临时方法参数。
- **把 `coldReadConcurrency` 设为必填配置字段。** 已拒绝：现有组合在不传配置的情况下挂载 `SubagentRuntime`；为了一个有安全默认值的项破坏它们，与可调参数清理“让默认值显化但不强制每个 profile 修改”的目标相矛盾。

## Consequences

并发上限现在拥有一个命名默认值和一条经验证的配置路径。现有部署继续默认使用 `4`，除非主动配置。网络化持久化部署现在可以在 `cordis.yml` 中提高（或降低）该值，无需修改代码。

## Testing

- `pnpm exec vitest run packages/subagent/subagent` — 675 项通过。
- 在 `packages/subagent/subagent/tests/list-children.spec.ts` 中新增单元测试，覆盖 schema 默认值、自定义值、校验拒绝，以及使用 `coldReadConcurrency: 1` 的端到端 listing。
- `pnpm run lint`、`pnpm run typecheck`、`pnpm run duplication`、`pnpm run doc-sync` 均通过。

## Related

- [Issue #88](https://github.com/xujian519/deepseek-harness/issues/88) — 父级硬编码可调参数清理任务。
