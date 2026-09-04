---
description: "Host Remote owner for the open plugin-catalog discovery surface: it projects the read-only plugin-market seam onto the generated pluginMarket namespace for browser discovery and preview."
kind: "package-reference"
---
# Plugin Market Controller

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-api-plugin-market-controller` exposes the generated `ctx.remote.pluginMarket` namespace for browser plugin discovery. It forwards only the read-only face of the `ctx.pluginMarket` seam — source listing, source catalog search, and install preview — into the browser. Installs and uninstalls stay with the `dsh plugin` profile CLI: this controller exposes no write, so a browser session can discover and preview a plugin but never mutate a profile. When the plugin-market provider is absent, the namespace stays registered and returns an actionable configuration error instead of silently being missing.

No runtime invariant companion is published; the plugin-market seam owns catalog sources, install receipts, and their events, while this package only projects its read-only methods onto the wire.


## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this package as a Loader entry in a profile that serves a browser plugin-discovery surface (the `dsh-web-app` bundle does). The entry registers the `pluginMarket` namespace independently of its provider, so a missing provider produces a named `internal` failure at invocation rather than an absent namespace. Its generated descriptors enter the strict Typert registry.

`listSources()` returns every catalog source the Host has registered, including a `builtin` marker the browser uses to distinguish an offline bundled directory from a network one. `search(sourceId, query)` forwards a `CatalogQuery` to one source and returns a provenance-stamped `CatalogPage`; unsupported query fields are dropped by the provider. `preview(ref)` checks a `name@version` reference against the registry and returns an `InstallPreview` without touching the profile.

Each method maps a `PluginMarketError` from the seam onto a `TypertRemoteFailure` whose `code` is the closed business code, so the browser sees `source-not-found`, `preview-failed`, `network`, and friends rather than an opaque transport error. Any other failure becomes `internal` with the provider's message. The browser-side `result.error` is therefore a typed failure carrying the business code.

-----

<a id="model-experience"></a>
## Model Experience

None, as plugin discovery is browser and Host state and registers no prompt, tool, or session event.

#### KV Cache effect

No direct effect; reading plugin-market state does not alter model requests already in flight.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Read-only by construction** — this controller exposes no install or uninstall method. Installs and uninstalls are intentionally left to the `dsh plugin` profile CLI so a browser session cannot mutate a profile.
- **No online HTTPS catalog source yet** — the shipped composition supplies a built-in offline catalog source, so discovery works without a network endpoint, but a remote HTTPS `dsh-plugin` directory is deferred.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
