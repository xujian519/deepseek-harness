# Agent Note: Make `subagent` cold-read concurrency configurable

Status: implemented

English | [中文](2026-09-14-subagent-cold-read-concurrency-config.zh.md)

## Problem

`packages/subagent/subagent/src/list-children.ts` hardcoded `COLD_READ_CONCURRENCY = 4` and used it directly when resolving cold candidates in `listChildren` and `listDescendants`. The source comment already noted that a networked persistence provider must promote the value to a validated deployment setting, but there was no config field or named default to promote. This was the next-highest-priority item in [Issue #88](https://github.com/xujian519/deepseek-harness/issues/88).

## Decision

**`coldReadConcurrency` is now a `SubagentRuntime` config field.** `packages/subagent/subagent/src/index.ts` declares:

- `DEFAULT_COLD_READ_CONCURRENCY = 4` exported from `list-children.ts`.
- `Config.coldReadConcurrency?: number` resolved by the Cordis loader.
- `static Config` schema defaulting to `DEFAULT_COLD_READ_CONCURRENCY` and validating that the value is a positive integer.
- A private `coldReadConcurrency` field on `SubagentRuntime` passed into every listing call.

`listChildren` and `listDescendants` keep their existing signatures and gain an optional trailing `coldReadConcurrency` parameter defaulting to `DEFAULT_COLD_READ_CONCURRENCY`, so direct callers are unaffected.

## Alternatives considered

- **Keep the module-level constant and add a separate setter or per-call argument.** Rejected: the AGENTS.md rule requires defaulting to be an explicit `resolve(request): Spec` step at the service boundary, not a hidden constant or an ad-hoc method parameter.
- **Make `coldReadConcurrency` a required config field.** Rejected: existing compositions mount `SubagentRuntime` without config; breaking them for a value that has a safe default contradicts the tunables cleanup goal of making defaults explicit without forcing every profile to change.

## Consequences

The concurrency cap has one named default and one validated config path. Existing deployments continue to use `4` unless they opt in. Deployments with networked persistence can now raise (or lower) the value from `cordis.yml` without code changes.

## Testing

- `pnpm exec vitest run packages/subagent/subagent` — 675 passed.
- Added unit tests in `packages/subagent/subagent/tests/list-children.spec.ts` for schema default, custom value, validation rejection, and end-to-end listing with `coldReadConcurrency: 1`.
- `pnpm run lint`, `pnpm run typecheck`, `pnpm run duplication`, and `pnpm run doc-sync` all pass.

## Related

- [Issue #88](https://github.com/xujian519/deepseek-harness/issues/88) — parent hardcoded-tunables cleanup.
