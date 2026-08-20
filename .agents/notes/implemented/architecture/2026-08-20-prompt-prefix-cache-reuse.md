# Agent Note: Prompt-prefix cache reuse for provider KV caching

Status: implemented

English | [中文](2026-08-20-prompt-prefix-cache-reuse.zh.md)

## Problem

Every model request re-assembles its **prefix** — the system prompt, tool schemas, and the runtime-context snapshot — from scratch. `agent-loop` calls `ctx.systemPrompt.assemble()` once per step (`packages/core/agent-loop/src/agent.ts`), re-evaluating every registered section, context, variable, and tool provider and re-interpolating variables each time. Provider-side prompt caches (KV caches) key on the request prefix: any changed byte invalidates the cache from that byte onward, so long sessions repeatedly re-pay the prefix's input-token cost.

The surrounding ground was already in place when this decision shipped:

- **History bytes are stable.** The session log is append-only and `deriveMessages()` caches its projection (`packages/core/session/src/index.ts`): each surface node projects exactly once and a rewrite (`replace`) rebuilds the generation.
- **Cache telemetry exists end to end.** `TokenUsage` separates `cacheReadTokens`/`cacheWriteTokens` from uncached `inputTokens` (`packages/llm/llm/src/types.ts`); the DeepSeek adapter's `mapUsage` maps `prompt_cache_hit_tokens`/`prompt_tokens_details.cached_tokens` and subtracts hits from `prompt_tokens` (`packages/llm/llm-deepseek/src/translate.ts`); the pi-ai adapter maps read and write counts; token-meter's `tokenUsage` projection folds all four buckets, and usage reaches the session log via `assistant/chunk` and `assistant/message`.

What was missing was **prefix reuse**: no cache identity, no TTL, no persistence, no inheritance into derived sessions — and `system-prompt/assemble`'s waterfall plus per-step variable providers were active prefix-churn sources.

## Decision

The harness caches each session's **contiguous stable prefix** — the sections from the first one onward whose text is deterministic — so later assemblies reuse the resolved text instead of re-evaluating stable providers.

- `PromptSection` gained `stable?: boolean` (`packages/core/system-prompt`): static strings are stable by definition; a function provider must declare `stable: true` to enter the cache.
- `SystemPrompt.assemble()` resolves the stable prefix by `(scope, signature, configFingerprint)` through the optional `ctx.promptCache` service. The signature covers the ordered `(name, order, fingerprint)` of the stable sections only — the cached text is uninterpolated, so variable values never enter the identity; the config fingerprint covers the deployment persona. A hit returns the cached sections and skips those providers; the `system-prompt/assemble` waterfall and per-request variable interpolation still run. Sections from the first unstable one onward evaluate per assembly, preserving the existing order join. Tool schemas stay out of the cache (tool changes are low-frequency, explicit actions; ordering is already deterministic).
- New package `@deepseek-ai/dsh-prompt-cache` (`packages/core/prompt-cache`) implements the cache: an in-memory TTL strategy (default one day) mounted at `ctx.promptCache` in `dsh-base`. A `system-prompt/change` event clears every scope's entries. When no strategy is mounted, assembly is byte-identical to the pre-cache path.
- The key is the agent scope (`assembleContextFor` resolves `scope: agent`, `packages/core/agent/src/dispatch.ts`), so a same-agent derived session reuses the cache while a subagent session keys differently. No clone protocol exists: provider caches are byte-addressed, so any request whose stable-prefix bytes match hits regardless of scope.
- A baseline script (`scripts/token-economy-baseline.ts`, `pnpm run token-economy:baseline`) reads plaintext session logs and reports per-turn and total cache hit rates from the usage each request reports, mirroring token-meter's same-step replacement rule (a final assistant-message usage replaces the earlier usage chunk).

Compression rewrites history, not the prefix, so it does not invalidate the prefix cache.

Deferred (explicitly not shipped): a persistent (SQLite-backed) strategy — the in-memory strategy is the shipped default; an explicit `invalidate` consumer — nothing rewrites the prefix today; zstd-compressed logs in the baseline script — plaintext logs are supported.

## Alternatives considered

- **A separate cache package wiring a new assembly point in `agent-loop`**: needs a loop edit, against "plugins, not loop changes"; the `system-prompt/assemble` waterfall runs after providers evaluate, so it cannot skip the recompute.
- **A single stable tool-dispatch entry (BitFun evaluated and declined this)**: new tools must appear in the request payload, a reminder cannot express them; low-frequency, user-driven — accept the cache miss.
- **Snapshot-and-diff listings (BitFun's skill/subagent diff reminders)**: the runtime context here is free text with nothing to diff; `RuntimeContextProjection` already skips re-injection when unchanged, which is the available benefit.
- **Per-session keys plus an explicit clone protocol (BitFun's `clone_prompt_cache`)**: provider caches are byte-addressed, so byte-identical stable prefixes hit from any scope; an explicit client-side clone adds bookkeeping without adding provider hits.

## Consequences

- Stable providers are evaluated once per cache entry instead of per assembly; the system-prompt and prompt-cache suites assert this by provider call counting.
- Token cost follows provider-side cache hits, which depend on byte stability, not on this client cache; the baseline script measures the hit rate.
- Core-surface change: `system-prompt`'s `assemble()` grew an optional cache branch; with no strategy mounted the behavior is byte-identical (regression-tested), and the round-trip invariant (`packages/core/prompt-cache/src/invariant.ts`) pins the cache contract.
- A misdeclared `stable` provider yields a stale prefix within TTL; TTL, invalidation, and the round-trip invariant bound the damage instead of failing silently.
- Tool changes still break the prefix (accepted): new tools must exist in the request payload; low-frequency and explicit.
- DeepSeek exposes no cache-write telemetry; the hit-rate metric uses hit/(hit+miss).
