# Agent Note: the session-history page size is resolved before the read begins

Status: implemented

English | [中文](2026-09-13-session-history-request-spec.zh.md)

## Problem

`AGENTS.md` requires defaulting to be an explicit `resolve(request): Spec` step in the owning implementation, never a `?? default` hidden inside the run path. The Session history entry points in `packages/api/session-controller/src/history.ts` did the opposite: each passed `request.maxMessages ?? DEFAULT_MAX_MESSAGES` straight into `paginate(...)`, four and five lines into `page()` and `follow()` respectively, and `follow()` tested `request.assistantStream === true` in three separate places. Neither method showed, at its top, the page size or cursors a caller would actually get, and the two entry points could drift apart with nothing to notice.

## Decision

**The page size is resolved once, then read.** `resolveMaxMessages(value)` owns the default, and one resolver per entry point turns a validated request into the spec the run path consumes:

- `resolvePageRequest(request): PageSpec` carries `throughSeq`, `beforeSeq`, and `maxMessages`, so the `SessionSeq`/`SessionLogOffset` branding conversions happen in the resolver instead of mid-read.
- `resolveFollowRequest(request): FollowSpec` carries `maxMessages` and `assistantStream`, so the request's optional flag is compared once rather than three times.
- Both methods now read `validate → resolve → run`, and the run path uses only resolved values.

**Validation stays in the per-request validators.** `validatePageRequest` and `validateFollowRequest` guard the Remote wire boundary for two different request kinds; the defaults are not deployment config, so the resolvers only default. This is the difference from `resolveMaxParallelToolCalls` and `resolveSessionListPageSize`, which validate the config they default because direct `apply()` callers never pass through a schema.

**The rest of the package was reviewed and kept.** `DEFAULT_MAX_MESSAGES` is the package's only `DEFAULT_*` constant, and no other inline `??` deployment default remains:

- `session.create`'s `workspace?.path ?? request.cwd ?? this.defaultCwd` is a precedence chain whose default is an explicitly configured field, resolved at the top of the method; nothing about the value is hidden in the call it feeds.
- The client spells its page sizes as request fields (`maxMessages: PAGE_MESSAGES`, `JUMP_PAGE_MESSAGES`) rather than relying on the host default.
- `SESSION_SEARCH_RESULT_LIMIT` and `SEARCH_PROVIDER_CALL_LIMIT` bound the search run path; they are limits applied where they read, not `??` defaults. If a deployment ever needs to vary them, they belong to the hardcoded-tunables family in [Issue #88](https://github.com/xujian519/deepseek-harness/issues/88), not here.

## Alternatives considered

- **Keep the inline `??` and document it.** Rejected: the rule is about where defaulting happens, not about whether it is commented.
- **Resolve only `maxMessages` and skip the spec types.** Rejected: the request/spec split is the template the rule names, and the seq branding plus the `assistantStream` predicate are the same translation from request fields to what the read needs.
- **Fold request validation into the resolvers.** Rejected: it would give the resolver a throwing contract the run path cannot see, and the two kinds validate different fields besides `maxMessages` (`throughSeq` and `beforeSeq` for pages, nothing for follows).
- **Also extract the `session.create` cwd precedence chain.** Rejected: its default is a configured field named in the expression, and extracting one line that reads explicitly would add indirection without removing a hidden default.

## Consequences

Each entry point states the resolved page size and cursors before it reads anything, and the default exists in one place. No behavior changes: the same default value, the same validation order (validation still runs before resolution), and the same errors, including the messages that interpolate `throughSeq`.

## Testing

`npx vitest run packages/api/session-controller/tests` — 742 passed. Per-file coverage stays at 100% for statements, branches, functions, and lines: `npx vitest run packages/api/session-controller/tests --coverage --coverage.include='packages/api/session-controller/src/history.ts'` — both branches of the default are exercised, since the follow tests omit `maxMessages` and the page tests pass an explicit limit. `pnpm run lint`, `pnpm run typecheck`, `pnpm run duplication`.

## Related

- [Tech-debt tracking in same-repository Issues](../process/2026-09-11-tech-debt-issue-tracking.md) — where Issue #95 is registered.
