# Agent Note: Centralize the `maxParallelSubCalls` default in `dsh-tools`

Status: implemented

English | [中文](2026-09-14-centralize-max-parallel-sub-calls.zh.md)

## Problem

`packages/core/tools/src/index.ts` owned the `maxParallelSubCalls` config field and its Loader schema, but the value `10` appeared three times inside the file: in the JSDoc for `Config.maxParallelSubCalls`, in `resolveMaxParallelSubCalls`, and in the `ToolRuntime.Config` schema default. `packages/core/agent-loop/src/constants.ts` exported `DEFAULT_MAX_PARALLEL_TOOL_CALLS = 10` as the scheduler's default, with no shared binding to the tools runtime. The two packages therefore had two independent sources for the same concurrency cap.

This was the highest-priority subset of [Issue #88](https://github.com/xujian519/deepseek-harness/issues/88) because it was a duplicated default across a capability seam (tools runtime defines the config, agent loop consumes it for scheduling).

## Decision

**The authoritative default lives in `dsh-tools`, next to the config it defaults.** `packages/core/tools/src/index.ts` now exports `DEFAULT_MAX_PARALLEL_SUB_CALLS = 10` and uses it for the JSDoc link, the runtime resolver fallback, and the Loader schema default.

**`dsh-agent-loop` re-exports the same value.** `packages/core/agent-loop/src/constants.ts` imports `DEFAULT_MAX_PARALLEL_SUB_CALLS` from `@deepseek-ai/dsh-tools` and exports `DEFAULT_MAX_PARALLEL_TOOL_CALLS` as an alias, so the scheduler keeps its own named constant without redefining the value.

## Alternatives considered

- **Move the constant to `dsh-agent-loop` and have `dsh-tools` import it.** Rejected: the config schema and resolver live in `dsh-tools`; a default imported from its consumer would invert the seam's ownership.
- **Create a new shared `constants` package for cross-package defaults.** Rejected: one re-export is not enough coupling to justify a new package and its dependency wiring.
- **Keep the duplicated literals and rely on tests to catch drift.** Rejected: the point of the tunables cleanup is to remove dual sources of truth, not to add guards around them.

## Consequences

The concurrency cap has a single source of truth. Observable behavior is unchanged: the default value is still `10`, the schema still rejects non-positive integers, and the agent loop still receives the same cap. The only change is the dependency direction: `dsh-agent-loop/constants` now references `dsh-tools` for the value, matching the semantic ownership of the config.

## Testing

- `pnpm exec vitest run packages/core/tools packages/core/agent-loop` — 805 passed.
- `pnpm run lint`, `pnpm run typecheck`, `pnpm run duplication` — clean.
- `pnpm run doc-sync` — clean after regenerating `docs/config-catalog.md` and syncing its Chinese counterpart.

## Related

- [Issue #88](https://github.com/xujian519/deepseek-harness/issues/88) — the parent hardcoded-tunables cleanup.
- [Session history request spec](2026-09-13-session-history-request-spec.md) — an earlier cleanup that references `resolveMaxParallelToolCalls` as the template for explicit resolver-owned defaults.
