# Agent Note: OpenViking memory plugin

Status: implemented

English | [中文](2026-08-23-dsh-openviking-memory-plugin.zh.md)

## Problem

The harness needs a cross-session long-term memory plugin: user preferences,
project knowledge, and lessons learned in one conversation must be retrievable
semantically in later conversations, with context injection that is
token-cheap, replayable, and neutral to existing compositions. Until now this
repository had only in-conversation context (`context/`) and local session
retrieval (`session-query/`), with no external context-database integration.

## Decision

**A new group `packages/memory/` carries `@deepseek-ai/dsh-openviking` (single package, function plugin).** The integration target is [OpenViking](https://github.com/volcengine/OpenViking) (context database: `viking://` virtual filesystem, L0/L1/L2 tiers, observer queue). Transport is a **hybrid dual channel**:

- **Direct HTTP (recall/capture/commit/management):** an in-house `OpenVikingClient` over the REST surface `/api/v1/{search,content,fs,sessions,skills,stats,observer}` — controllable, testable, no subprocess; credentials travel as `X-API-Key` plus account/user/agent headers.
- **MCP streamable-http direct:** `@deepseek-ai/dsh-mcp-client` in `streamable-http` mode points straight at the server's `/mcp` endpoint — **no stdio proxy**. The official bundle's stdio proxy exists because older `stateless_http` servers answer `GET /mcp` with an idle SSE stream that stalls the SDK; measured against OpenViking 0.4.15, `/mcp` handles streamable HTTP correctly (POST initialize/tools/list work), so the proxy approach was dropped. Server upgrades add tools without a release.
- **3 HTTP tools** (`memcommit`/`memqueue`/`memlearn`): MCP `remember` stores into the server's short-lived session and cannot commit the current DSH session; the observer queue has no MCP face; deliberate capture (redaction/dedupe/skill minting) has no MCP semantics.

**Recall injection uses the `systemPrompt.context()` channel, not pre-step messages or system-prompt sections.** The key evidence: a `complete: true` persona restores only the assembled `sections` to a single section — **dynamic context survives** (only explicit `runtimeContextSuppressed` clears it); and the channel is a durable user-role snapshot, satisfying Model-visible ⟺ logged. The pre-step hook only stages (the query comes from the accepted batch), and assembly renders the block.

**Mounted by default but fail-soft.** When the service is unreachable: the plugin still activates, one deduplicated boot warning fires, automatic layers skip silently, explicit tool calls give clear errors, and the status route reports `healthy: false`.

**Local configuration and state:** config is exposed as the `openviking` namespace through `installSettingsSection` (rendered and seam-validated by the Web UI settings page); the state file stores only message seqs and commit timestamps (atomic writes, corrupt/identity-change quarantine), transport is at-least-once, and the server dedupes through `source_message_ids`.

## Alternatives considered

- **stdio proxy bridge (the official bundle pattern)** — adds a resident subprocess and requires credential pass-through via env; the current server's streamable HTTP works, so it was rejected.
- **All 11 mem* tools (Rxiain style)** — duplicates the MCP tool surface with a second maintenance surface; only the 3 tools whose semantics MCP cannot express were kept.
- **System-prompt section injection** — discarded under `complete: true` personas (the official bundle switched to pre-step messages for the same reason); this package uses the context channel for the same durability without touching the message stream.

## Consequences

- The new group README and the [packages/README.md](../../../packages/README.md) group table are updated; `packages/memory/` owns the external-service contract links.
- Web surface: the settings page gains the `openviking` config section automatically; `GET /openviking/status` (exact host webServer route) serves health + queue JSON.
- The browser status card (a client `ui-*` plugin with client-build registration) is **not shipped with this package**: client-side slot integration and the client-build registration surface are a separate large block, recorded as a Known Limitation in the package README.
- e2e is opt-in (`OPENVIKING_E2E=1` plus a reachable server); CI skips without a key.
