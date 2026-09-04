---
description: "The open plugin-catalog seam (`ctx.pluginMarket`): user-registered HTTPS catalog sources, catalog search, and a managed install pipeline with snapshot/rollback and durable receipts. Remote catalog payloads are untrusted input — validated against the wire schemas under `docs/schemas/` and fetched through a restricted HTTPS client."
kind: "package-reference"
---

# `@deepseek-ai/dsh-host-plugin-market`

English | [中文](README.zh.md)

## Summary

The open plugin-catalog seam (`ctx.pluginMarket`): user-registered HTTPS catalog sources, catalog search, and a managed install pipeline with snapshot/rollback and durable receipts. Remote catalog payloads are untrusted input — validated against the wire schemas under `docs/schemas/` and fetched through a restricted HTTPS client.

No runtime invariant companion is published; the capability's authority lives in the provider's persisted source/receipt files, which the provider itself observes.


## Table of Contents

- [What it does](#what-it-does)
- [Composition](#composition)
- [Security boundary](#security-boundary)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## What it does
- **Catalog protocol** — a source is a manifest (see [`docs/schemas/catalog-source.schema.json`](docs/schemas/catalog-source.schema.json)) declaring its identity, attribution, transport base URL, and the query parameters it supports. Queries go to `baseUrl + /v1/plugins`; pages follow [`catalog-provider-page.schema.json`](docs/schemas/catalog-provider-page.schema.json). Only declared parameters are sent; every entry is provenance-stamped with the source that served it.
- **Restricted network** — `restricted-fetch.ts` enforces HTTPS-only, no URL credentials or fragments, blocks loopback/private/link-local/metadata targets before and after DNS resolution, re-validates every redirect, and caps response size, timeout, and redirect depth.
- **Managed install** — `install.ts` snapshots the profile's `package.json`/`pnpm-lock.yaml`/`pnpm-workspace.yaml` before `pnpm add`, restores them on failure, and persists a receipt per successful install. Uninstall verifies the receipt matches the profile before `pnpm remove`. The provider re-runs the registry preview as the install gate: deprecated, dist-less, or lifecycle-script packages never reach the profile through the market.
- **CLI** — `dsh plugin source add|remove|list`, `dsh plugin search`, `dsh plugin preview`, `dsh plugin install`, `dsh plugin uninstall` run the same pipeline against the resolved profile.

## Composition

Mount the provider with a profile directory:

```yaml
- id: plugin-market
  name: '@deepseek-ai/dsh-host-plugin-market'
  config:
    profileDir: /absolute/path/to/profile
```

Sources persist to `<profileDir>/.dsh-plugin-market/sources.json`; receipts to `<profileDir>/.dsh-plugin-market/receipts/`.

## Security boundary

Catalog listings are not security reviews: a listed package installs and runs as the current user. The restricted client bounds what the host will even fetch; the preview pipeline rejects deprecated and dist-less releases and surfaces lifecycle scripts. There is no signature verification — the trust model is explicit.

## Model Experience

None, as this package registers no prompt text, tool schema, or provider request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- The preview's Node-engine check is a heuristic for the first comparator; the package manager remains the authority when `engine-strict` is configured.
- Install recovery (a WAL for interrupted installs) and a media proxy for catalog icons are deferred; the receipt trail is the current recovery mechanism.

### Dev Note

None.
