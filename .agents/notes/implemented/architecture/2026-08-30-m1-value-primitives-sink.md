# Agent Note: M1 first sink — the shared `dsh-value` primitives

Status: implemented

English | [中文](2026-08-30-m1-value-primitives-sink.zh.md)

## Problem

The tech-debt ledger's M1 entry records the cross-package small-helper epidemic: helper functions copied per package that jscpd cannot flag because each copy is a few lines with drifted signatures and messages. The full-scan report quantified the two worst: `isRecord` in 26 files with three predicate variants, and `assertPositiveInteger` in 16 files with drifted signatures (`number` vs `unknown`+narrowing), error types (`Error` vs `TypeError`), and diagnostic formats. Every bug fix in one copy had to be rediscovered by the others, and diagnostic wording forked per plugin.

## Decision

- New zero-dependency package `packages/util/value` (`@deepseek-ai/dsh-value`) with three primitives: `isRecord`, `assertPositiveInteger(label, value)` (asserts `number`, throws `TypeError`), and `assertPositiveFinite(label, value)`. The shared library owns the predicate and the failure message; the caller owns the diagnostic label, so each consumer keeps naming its own option, scope, or config path.
- Migrated every `isRecord` copy (26 files, ~25 packages). The sdk/client public export is now a re-export with the JSDoc retained. The mcp-client `JsonValue`-typed predicate folded into the canonical guard — its call sites already cast to `McpContentBlock` after narrowing. Two copies (core/session `chunk-rows.ts`, session-persistence-sqlite `codec.ts`) had no array rejection; the canonical stricter guard is behaviorally equal at their call sites because downstream key checks reject arrays.
- Migrated every `assertPositiveInteger` copy (16 files, 38 call sites rewritten to pass prefixed labels). `tool-skill`'s `minimum: 3` variant became canonical assert plus an explicit `< 3` range check with the original message.
- Migrated the three verbatim `assertPositiveFinite` copies (bash-local, pwsh-local, web-fetch-http). Two semantic outliers stay local on purpose: subagent-acp's variant pins the `MAX_TIMER_DELAY_MS` timer ceiling (timer-domain contract, not value classification), and session-query-sqlite's wrapper throws the aggregated `SessionQueryError` — a different failure type, not a copy.
- Client-group consumers declare `dsh-value` as peer plus dev per the client dependency rules; every other consumer declares it as a plain dependency. 43 tsconfig files gained the project reference.

## Consequences

One definition now carries the object guard and the two positive-number assertions; a fix or message change lands once. Diagnostic messages are unchanged for every consumer whose tests pinned them, and consistent (`${label} must be ...`) everywhere else. The two retained outliers document their domain contracts next to their definitions. M1's remaining inventory shrinks to `toError`, `errorMessage`, `isENOENT`, `isPlainObject`, `deepFreeze`, and the abort-race wrappers; the ledger records the closure.

## Alternatives considered

**Absorb the outliers by widening the shared API (error-type parameter, upper-bound parameter).** Rejected: parameters that switch failure type or ceiling make the shared assertion a configuration surface instead of a primitive; the outliers read better as documented domain contracts.

**Sink `toError`/`errorMessage` in the same batch.** Deferred: their copies carry diverging placeholder wording that reaches log and diagnostic output, so consolidation changes observable text and belongs in its own reviewed change.

**Leave `isRecord` typed per call site (JsonValue/PropertyKey variants).** Rejected: every variant's call sites only read string properties or cast onward; the variants added type vocabulary, not safety.
