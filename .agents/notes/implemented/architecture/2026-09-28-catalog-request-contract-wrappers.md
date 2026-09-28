# Agent Note: Catalog request-contract wrappers survive a protocol override

Status: implemented

English | [中文](2026-09-28-catalog-request-contract-wrappers.zh.md)

## Problem

A pi-ai catalog provider owns more than a model list and API implementations. The OpenCode gateways refuse any request without a per-conversation `x-opencode-session`, so pi-ai wraps each of that provider's implementations to derive the header from the request's `sessionId`; the Cloudflare providers resolve the account and gateway placeholders in a model's endpoint from the ambient values their own auth resolution supplies, so pi-ai wraps theirs too.

`dsh-llm-pi-ai` builds a route two ways: it reuses the catalog provider when a profile keeps the catalog protocol, and otherwise rebuilds the provider over its own protocol table. Rebuilding substituted bare implementations for the wrapped ones, so a route named after an OpenCode gateway that also declared an explicit `api:` sent no session header and every request was refused before the model ran. That is the shape a deployment reaches when it adds a model the installed catalog has not caught up with: the OpenCode catalogs are mixed-protocol, so route resolution has no single catalog protocol to inherit and requires the route-level `api:`.

## Decision

`src/provider.ts` holds a request-contract wrapper table keyed by catalog provider id — `opencode` and `opencode-go` map to pi-ai's `withOpenCodeSessionHeader`, and `cloudflare-ai-gateway` and `cloudflare-workers-ai` to its `cloudflareStreams` — and applies that provider's wrapper to the protocol implementation a profile substitutes when it overrides the route's protocol. The wrappers are imported from pi-ai's published `providers/*` subpaths rather than restated, so the header and placeholder names and their per-request derivations stay upstream-owned; the OpenCode wrapper skips a request whose caller already set the header, so a deployment that pins one in `headers` keeps its value.

The table is keyed by catalog provider id and consulted only when the route names a catalog provider. A route pi-ai does not ship has no catalog provider whose contract it could inherit, so it receives no wrapper; the [package README](../../../../packages/llm/llm-pi-ai/README.md#known-limitations-and-deferred-work) states that gap and the two ways out of it.

## Alternatives considered

**Match the endpoint host.** Injecting the header whenever a route's `baseURL` resolves to `opencode.ai` would close the hand-declared-route gap, but it writes a gateway's private request convention into the harness, duplicates knowledge pi-ai already owns, and cannot tell a deployment that wants the header from one that does not.

**Expose the header name as a route config field.** A `sessionHeader` field would let any deployment declare any header, but it turns a provider-owned obligation into a harness-maintained compatibility surface, while the catalog route already carries the correct answer.

**Restate the obligations in the adapter.** The native `dsh-llm-deepseek` adapter already sends the official DeepSeek route's own session header, but that is a different gateway's convention. Writing OpenCode's beside it duplicates an upstream contract and rots when upstream changes it.

**Leave the override path unsupported.** An explicit `api:` on a catalog route is the supported way to add a model the installed catalog has not caught up with. Leaving it broken would make a documented configuration path refuse every request.

## Consequences

A catalog route keeps its provider's request obligations through a protocol override, and the obligation's source stays pi-ai. The hand-declared-route gap stays open and documented, because closing it needs either endpoint knowledge or a new configuration surface.

[`tests/catalog-stream-wrappers.spec.ts`](../../../../packages/llm/llm-pi-ai/tests/catalog-stream-wrappers.spec.ts) pins the catalog path, the override path, per-conversation derivation, a deployment-pinned header, the hand-declared route, and that a provider which did not ask for a session id receives none, then pins the same catalog-versus-declared split for the Cloudflare placeholders on both provider ids. The webworker host's pi-ai stub exports both wrappers as refusals, like its other request-path symbols, so a worker that ever reached one fails loudly instead of silently dropping the obligation.
