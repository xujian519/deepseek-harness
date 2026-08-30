# Agent Note: Plugin-catalog discovery tools for the model

Status: implemented

English | [中文](2026-08-31-plugin-market-agent-tools.zh.md)

## Problem

The plugin market seam ([`@deepseek-ai/dsh-host-plugin-market`](../../../../packages/host/plugin-market/README.md)) is a complete install path: catalog sources, a restricted HTTPS fetch, an npm preview, and the snapshot/rollback install receipt. But it is only reachable through the operator-driven `dsh plugin` CLI. The model inside a session cannot see any of it: it cannot enumerate the catalog sources the deployment registered, search one for a package, or check a `name@version` before recommending an install. So when a user asks the session to "add a plugin that does X", the model guesses at package names and versions, or inventing a package that does not exist — the pre-existing gap the standalone `deepseek-harness-studio` surfaces through its `/find-plugins` flow.

The service-side action was already present; what was missing is the model-facing view. Closing it means wrapping the existing read-only verbs as tools, so the model answers the three questions a discovery flow needs: *what sources exist*, *what matches this query*, and *does this exact pin exist and is it sane to install*.

## Decision

Ship [`@deepseek-ai/dsh-tool-plugin-market`](../../../../packages/extensions/tool-plugin-market/README.md): three read-only tools over the live `ctx.pluginMarket` seam that the host composition mounts, plus one system-prompt section teaching the workflow.

| Tool | Contract |
|---|---|
| `market_source_list` | List every registered catalog source: stable source id, provider id, display name, built-in flag, and the query parameters it accepts. |
| `market_plugin_search` | Query one source. Omit `sourceId` to hit the bundled catalog; filter with `q` / `category` / `capability`, bound the page with `limit`. Returns one page of provenance-stamped entries. |
| `market_plugin_preview` | Check one `name@version` against the npm registry: whether it resolved, any rejection reasons, the declared lifecycle scripts, and whether its engines accept the running Node. |

Every verb is read-only by construction. None of them installs a package, edits a profile, or changes `cordis.yml`. Installation stays on the operator-driven `dsh plugin` CLI, so an Agent never commits a package without an explicit operator decision.

### Source resolution

Explicit source id → bundled catalog → first registered source → fail loud. An unknown source id names the missing source and points the model at `market_source_list` rather than silently searching the wrong catalog; a session with no registered source fails with an actionable message. Each `execute` first asserts an Agent-backed session (require-agent guard) so a tool call cannot run outside a real session.

### Bundled source short-circuit

The bundled catalog is a release snapshot served by the host (`builtin-deepseek`), and it never fetches its `builtin://` endpoint: `searchBuiltinCatalog` is a pure in-memory filter, so the discovery default works offline. A live public catalog source is a registered HTTPS source over the market's restricted fetch, which is the outstanding gap (see Known Limitations in the package README).

### Composition

It is agent-plane and scoped to the preset's tool layer. The standard agent preset mounts `@deepseek-ai/dsh-tool-plugin-market`; the host provider row lives in the base composition. The Cordis config is a registered function plugin (named-export `name` / `inject` / `apply`, no default export) and its cargo is the same three tools the CLI reaches.

## What was rejected

- **No model-facing install/uninstall.** Writing to a profile needs approval and durable receipts; it stays on the CLI. The model's job is discovery and recommending an exact pin, not committing one.
- **No re-declared contracts.** The tools reuse the `plugin-market` service types for `CatalogPage` / `CatalogItem` / `InstallPreview` rather than restating them, so a wire-schema change cannot drift a mirror.
- **Not part of the browser UI.** A discovery panel deferred to a separate surface; this package is the model-facing half only.

## Generated catalog

The three tool schemas render into the [generated tool catalog](../../../../docs/tool-catalog.md) under `#deepseek-aidsh-tool-plugin-market`, gated by the same freshness check as every generated artifact.
