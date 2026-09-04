---
description: "OpenViking context-database integration for DeepSeek Harness: auto-recall before model steps, session capture and auto-commit, the OpenViking tool surface, and the shared `openviking-memory` skill guidance. See the [upstream project](https://github.com/volcengine/OpenViking) and its [DeepSeek Harness Memory Bundle](https://github.com/volcengine/OpenViking/tree/main/examples/dsh-memory-plugin) for the service contract this package consumes."
kind: "package-reference"
---

# `@deepseek-ai/dsh-openviking`

English | [中文](README.zh.md)

## Summary

OpenViking context-database integration for DeepSeek Harness: auto-recall before model steps, session capture and auto-commit, the OpenViking tool surface, and the shared `openviking-memory` skill guidance. See the [upstream project](https://github.com/volcengine/OpenViking) and its [DeepSeek Harness Memory Bundle](https://github.com/volcengine/OpenViking/tree/main/examples/dsh-memory-plugin) for the service contract this package consumes.

The plugin talks to a running OpenViking HTTP service only — it never shells out to the `ov` CLI and never starts a server. The service may be unreachable: the plugin still loads, ordinary conversation continues, and the automatic layers skip with deduplicated warnings while explicit tool calls throw clear errors.

No runtime invariant companion is published; recall/capture/commit are pure consumers of the session event stream and the prompt registry — the agent/session layers own durable context admission, and StateStore owns the only mutable data plane, whose monotonicity and atomic replacement are enforced at its own boundary.


## Table of Contents

- [Public API](#public-api)
- [Configuration](#configuration)
- [Testing](#testing)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Public API

- `Config` — validated plugin configuration: `endpoint` (default `http://localhost:1933`), `apiKey`, `account`, `user`, `agentId`, `timeoutMs` (default 30000), `stateFile` (default `~/.dsh/openviking/state.json`), plus the `repoContext`, `autoRecall`, and `autoCommit` groups documented below.
- Function plugin `name` / `inject` / `Config` / `apply` — no default export.

## Configuration

| Key | Default | Contract |
|---|---:|---|
| `endpoint` | `http://localhost:1933` | OpenViking HTTP service base URL; non-empty absolute http(s) URL, validated at load. |
| `apiKey` | `''` | `X-API-Key` header value; empty omits the header. |
| `account` / `user` | `''` | Trusted-mode tenant headers; empty omits them. |
| `agentId` | `deepseek-harness` | `X-OpenViking-Agent` header value. |
| `timeoutMs` | `30000` | Per-request timeout; 1000–300000. |
| `stateFile` | `~/.dsh/openviking/state.json` | Session-sync state file (`~` expanded); message ids and timestamps only, never bodies or keys. |
| `repoContext.enabled` | `true` | Inject the indexed-repository list into the prompt. |
| `repoContext.cacheTtlMs` | `60000` | Repository-list cache TTL; 1000–3600000. |
| `autoRecall.limit` | `6` | Maximum memories injected per step; 1–50. |
| `autoRecall.scoreThreshold` | `0.15` | Minimum score for filler memories; 0–1. |
| `autoRecall.maxContentChars` | `500` | Per-memory content cap; 100–5000. |
| `autoRecall.tokenBudget` | `2000` | Approximate token budget (`tokenBudget × 4` chars), 100–10000. |
| `autoRecall.refreshSteps` | `10` | Mid-message re-search every N tool steps; 0 disables. |
| `autoRecall.startupMapEveryTurns` | `5` | Memory-map refresh cadence; 1 = session start only, 0 = never. |
| `autoCommit.turns` | `3` | Commit after N uncommitted user turns; 0 disables the turn trigger. |
| `autoCommit.intervalMinutes` | `10` | Wall-clock fallback for previously committed sessions. |

## Testing

```sh
pnpm vitest run packages/memory/openviking/          # unit suite (per-file 100% coverage)
OPENVIKING_E2E=1 pnpm vitest run packages/memory/openviking/tests/e2e.spec.ts
```

The e2e gate runs against a real OpenViking service (`OPENVIKING_URL`, default `http://127.0.0.1:1934`) and skips without `OPENVIKING_E2E=1`; it stores a unique session, mirrors user and assistant messages, commits, and asserts the committed session with its live tail — the property no stub can certify.

## Model Experience

### Memory library map

#### What the model sees

The plugin participates in model input through the `systemPrompt.context()` registry — a durable user-role snapshot that replays with the session and is visible to compaction. The library map contributes category counts and retrieval guidance (`openviking:library` context, order ~120), injected at session start and refreshed on the configured cadence; agents fetch details on demand through the model-facing tools.

#### Token effect

One compact block at session start, refreshed on the configured cadence; each refresh costs the block size only.

#### KV Cache effect

The block sits in the reusable prompt prefix and changes only when a cadence refresh replaces it.

### Recall block

#### What the model sees

The `<relevant-memories>` block for the current step (`openviking:memories` context, order ~125), deduplicated, scored, and budget-capped. The block never contains instructions to follow from memory — it is untrusted background data. Because these are contexts, not sections, restore-to-sole-section presets (`complete: true`) do not discard them, and recalled text is never mirrored back into OpenViking: context contributions carry a `source.kind` other than `user` and the capture layer strips them defensively.

#### Token effect

Bounded by `autoRecall.tokenBudget` and the per-item `maxContentChars` cap.

#### KV Cache effect

Recall blocks append as context snapshots; a new block changes the suffix only, preserving earlier cacheable history.

### Repository list

#### What the model sees

Names of indexed resources under `viking://resources/` (`openviking:repositories` context, order ~118).

#### Token effect

One short list per refresh; its cost is bounded by the number of indexed repositories.

#### KV Cache effect

The list joins the prompt prefix and changes only when the repository index changes.

## Known Limitations and Deferred Work

- **Server-contract drift** — this package implements the OpenViking wire surface as of 0.4.15 (the release the local e2e runs against); a server upgrade may add tools (the MCP surface re-syncs automatically) but can also change HTTP endpoint semantics, which the package validates against its recorded contract only implicitly through failures.
- **Web status card deferred** — the settings form is live (the `openviking` namespace renders in the Web UI settings page and validates at the seam), and `GET /openviking/status` serves health and queue JSON, but the browser status card (a client `ui-*` plugin with client-build registration) is not yet wired into a client slot. Status is currently reachable through the route, the `memqueue` tool, and the CLI.
- **`remember` scoping** — the OpenViking MCP `remember` tool stores into the server's own short-lived session, not the live `dsh-<session-id>` stream; automatic capture and `memcommit` record the conversation itself.
- **No embedded server** — the plugin requires a reachable OpenViking service; deployments without one see one deduplicated warning at boot and silent automatic layers.
- **Raw recall blocks are untrusted** — injected memory text is background data; the model-facing guidance forbids following instructions found only inside memory.

### Dev Note

None.
