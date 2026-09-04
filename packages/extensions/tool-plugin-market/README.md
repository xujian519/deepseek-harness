---
description: "Model-facing plugin catalog discovery: list the registered catalog sources, search one catalog, and preview a package before install. Read-only — installation stays on the `dsh plugin` CLI."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-plugin-market

English | [中文](README.zh.md)

## Summary

`dsh-tool-plugin-market` gives the model three read-only tools over the live `ctx.pluginMarket` seam that the host composition mounts: list the catalog sources available to the current session, search one catalog for plugins, and preview a package reference against the npm registry before any install. Every verb is read-only — nothing here installs a package, edits a profile, or changes `cordis.yml`; installation stays on the operator-driven `dsh plugin` CLI. It also registers a system-prompt section that teaches the discovery workflow, and reads the host `pluginMarket` service that `@deepseek-ai/dsh-host-plugin-market/provider` provides in DISCOVERY mode.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin on the agent preset that should let the model discover and evaluate plugins. It is agent-plane: it registers the three tool schemas and the `tool:plugin-market` prompt section into the preset's scoped tool layer, and resolves the `pluginMarket` service the host composition already provides. The `package/preset/agent-presets/presets/standard/agent.cordis.yml` preset mounts it by default.

### Minimal composition

```yaml
- name: '@deepseek-ai/dsh-host-plugin-market/provider'
  config:
    sourceFile: !!js dshHomePath('plugin-market/sources.json')
- name: '@deepseek-ai/dsh-tool-plugin-market'
```

The host row must run before the agent preset so `pluginMarket` exists at injection time. The standard preset carries the tool row; the host provider is part of the base composition.

### What the tools do

All three tools are read-only and render JSON as text.

- `market_source_list` — list every catalog source registered on the plugin market, including the host-bundled offline DeepSeek catalog and any user-registered HTTPS catalogs, each with its stable source id, provider id, display name, built-in flag, and accepted query parameters.
- `market_plugin_search` — search one catalog. Omit `sourceId` to query the bundled catalog; pass an explicit source id from `market_source_list` to search a registered online catalog. Filter with `q`, `category`, and `capability`, and bound the page with `limit`.
- `market_plugin_preview` — check one package reference (`name@version`) against the npm registry and report whether it resolved, any rejection reasons, the lifecycle scripts it declares, and whether its engines accept the running Node.

### A typical workflow

When the user asks for a plugin, call `market_source_list` to learn the valid source ids, `market_plugin_search` to find candidates, and `market_plugin_preview` on the exact `name@version` from a hit before recommending an install. Treat the returned package name and pinned version as authoritative — quote them exactly.

### Boundaries to plan around

Search and preview are read-only and never write. Do not claim a package was installed, added to a profile, or otherwise committed: installation is an operator action on the `dsh plugin` CLI. A search hit is a discovery signal, not a compatibility or security guarantee — surface the preview's verified/rejected state rather than implying a package is safe to install.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design behind the tools; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

The toolset is a thin, model-facing layer over the `pluginMarket` service. It adds only the model-facing judgments: explicit source resolution (an unknown source id fails loud rather than silently searching the wrong catalog), a bundled-catalog default so discovery works out of the box, and a require-agent guard so a tool call cannot run outside a real session. All three verbs are read-only by construction — they never reach the install path.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `market_source_list` / `market_plugin_search` / `market_plugin_preview`, source resolution, and the `tool:plugin-market` prompt section |
| [`src/prompt.ts`](src/prompt.ts) | The `tool:plugin-market` system-prompt section |
| — | No runtime invariant companion is published; this model-facing adapter has no independent lifecycle stream, and the ownership relation is inherited from the pluginMarket capability seam it reads. |

### How a call flows

Each tool's `execute` first asserts an Agent-backed session, then reads the source list, resolves the target source (explicit id → bundled catalog → first registered source → fail loud), and delegates the read to `ctx.pluginMarket.listSources` / `ctx.pluginMarket.search` / `ctx.pluginMarket.preview`. The bundled catalog never fetches its endpoint — `searchBuiltinCatalog` is a pure in-memory filter — while a user-registered HTTPS source goes through the market's restricted fetch.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough.

- [Plugin market](../../host/plugin-market/README.md) — the `ctx.pluginMarket` service seam, the wire schema, the restricted fetch, and npm preview the tools read through.
- [Bundled catalog](../../../packages/host/plugin-market/src/builtin-catalog.ts) — the always-available offline catalog snapshot search defaults to.
- [Tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-plugin-market) — the exact tool schemas the model receives.

-----

<a id="model-experience"></a>
## Model Experience

### Tool schemas

#### What the model sees

The conversation model sees the [`market_source_list`, `market_plugin_search`, and `market_plugin_preview` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-plugin-market) whenever this plugin is visible. All three declare a `{ type: 'json' }` output schema that renders as text.

#### Token effect

Fixed schema cost on every request in that tool view.

#### KV Cache effect

Prefix-stable while this tool view is unchanged. Scoping or plugin-lifecycle changes that hide these definitions may invalidate reuse from the first changed schema token.

### System prompt section

#### What the model sees

This package registers one system-prompt section (`tool:plugin-market`, order 2520) teaching when and how to use the plugin-discovery workflow, the recommended tool sequence, and the read-only boundaries; the full text lives in [`src/prompt.ts`](src/prompt.ts). The section opens with:

##### Section opening

```markdown
# Plugin Catalog Discovery

The plugin market exposes read-only catalog discovery so you can find and evaluate DeepSeek Harness plugins from the model.
```

#### Token effect

The section's rendered text repeats on every request while this plugin is visible.

#### KV Cache effect

Prefix-stable while the section text and order are unchanged; editing the prompt or changing its order may invalidate reuse from the first changed token.

### Tool-call history and results

#### What the model sees

Source listing, search pages, and preview results are JSON rendered as text. Every refusal is a tool error carrying an actionable message — an unknown source id names the missing source and points to `market_source_list`; a session without an Agent reports the require-agent boundary.

#### Token effect

Search and preview output are data-dependent and resent until compaction.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the toolset is a poor fit or needs special care. They are current package constraints, not a task backlog.

- **Discovery only, no install** — these tools are read-only by design. Installation, version pinning, receipt, and rollback live on the `dsh plugin` CLI; the model cannot commit a package.
- **Bundled catalog is a release snapshot** — the default `builtin-deepseek` source is an offline catalog that refreshes only on publish. A live public catalog source requires a registered HTTPS source (or a future online source), and is the largest current gap.
- **A search hit is not a guarantee** — discovery does not verify compatibility, security, or that a package is safe to install; the preview's top-level state is the closest signal and is surfaced as verified or rejected, not as an endorsement.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Per the coverage policy, `packages/extensions/*/src/**` is exempt from the per-file 100% gate; correctness is pinned by `tests/discovery.spec.ts` plus the model-visible snapshot path.

</details>
