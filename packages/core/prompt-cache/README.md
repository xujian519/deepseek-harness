---
description: "Prompt-prefix cache for `SystemPrompt.assemble()`: the `ctx.promptCache` service caches a session's contiguous stable-prefix sections (TTL-bounded, in memory) so `system-prompt` skips re-evaluating stable providers on later assemblies. When the service is absent, assembly takes the pre-existing per-assembly path byte-for-byte."
kind: "package-reference"
---

# dsh-prompt-cache

English | [中文](README.zh.md)

## Summary

Prompt-prefix cache for `SystemPrompt.assemble()`: the `ctx.promptCache` service caches a session's contiguous stable-prefix sections (TTL-bounded, in memory) so `system-prompt` skips re-evaluating stable providers on later assemblies. When the service is absent, assembly takes the pre-existing per-assembly path byte-for-byte.

## Table of Contents

- [Config](#config)
- [Public API](#public-api)
- [Relationship to provider caches](#relationship-to-provider-caches)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Config

| Field | Default | Meaning |
| --- | --- | --- |
| `ttlMs` | `86400000` | In-memory entry lifetime in milliseconds. |

## Public API

- `ctx.promptCache` The cache service: `get(key)` / `set(key, sections)` / `invalidate(scope)`. The key's `signature` covers the stable sections' ordered fingerprints only — the cached text is uninterpolated, so variable values never enter the identity; `configFingerprint` covers the deployment persona. Any change in either recomputes the entry.
- `DEFAULT_PROMPT_CACHE_TTL_MS` The default entry lifetime.

Registration changes invalidate every entry: the service listens for `system-prompt/change` and clears all scopes, because a prompt-provider change alters every scope's stable signature.

## Relationship to provider caches

This cache saves recomputation, not provider cost: provider-side KV caches are byte-addressed, so any request whose stable prefix bytes match hits regardless of scope. A byte-identical prefix is what makes both work, which is why `system-prompt` declares `stable` sections explicitly rather than caching everything.

## Model Experience

Indirectly, through `system-prompt`, the cache reuses already-resolved stable-prefix text so model requests keep byte-identical prefixes and provider KV caches keep hitting.

#### KV Cache effect

Byte-stable prefixes preserve provider KV reuse across requests; a cache miss only re-evaluates the stable providers, and the request bytes stay the same either way.

## Known Limitations and Deferred Work

- **In-memory only** — entries live in one process and expire on restart; there is no shared or persistent cache across runs.
- **Uninterpolated text only** — variable interpolation still runs per request, so the cache cannot skip the final render step.
- **Stale-prefix exposure** — a misdeclared `stable` provider (output that changes within the TTL) yields a stale prefix; TTL, explicit invalidation on `system-prompt/change`, and telemetry bound the damage rather than eliminate it.

### Dev Note

None.
