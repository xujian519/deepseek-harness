# Agent Note: Open plugin market (ctx.pluginMarket)

Status: implemented

English | [中文](2026-08-20-open-plugin-market.zh.md)

## Problem

The harness had no open plugin catalog or managed-install pipeline: every install went through bare `dsh plugin add` with no rollback, no receipt trail, and no catalog discovery. Third-party hosts and community markets each invent their own protocol.

## Decision

New `@deepseek-ai/dsh-host-plugin-market` provides `ctx.pluginMarket` as a capability seam (Service Definition + default provider):

- **Catalog protocol** — user-registered HTTPS sources validated against wire schemas under `docs/schemas/` (source manifest, query, provider page, snapshot). Only declared query parameters are sent; every entry is provenance-stamped.
- **Restricted client** — `restricted-fetch.ts` enforces HTTPS-only, no URL credentials or fragments, blocks loopback/private/link-local/metadata targets before and after DNS resolution, re-validates every redirect, and caps size, timeout, and redirect depth.
- **Managed install** — `install.ts` snapshots the profile manifests before `pnpm add`, rolls back on failure, and persists durable receipts keying uninstall (receipt/profile match verified). The provider re-runs the registry preview as the install gate: deprecated, dist-less, or lifecycle-script packages never reach the profile.
- **CLI** — `dsh plugin source add|remove|list`, `search`, `preview`, `install`, `uninstall` run the same pipeline against the resolved profile.

Sources persist under `<profileDir>/.dsh-plugin-market/sources.json`; receipts under `.../receipts/`.

## Consequences

The open-catalog contract now lives upstream so third-party hosts and community markets can converge on one protocol. Install safety (snapshot/rollback/receipt) is the default path for market installs. Deferred: install-recovery WAL and a catalog-icon media proxy (the receipt trail is the current recovery), and a Web settings tab over the seam.

## Alternatives considered

- Bundling an npm-registry-backed store as the default source: rejected — no default source, no fallback source, one source at a time.
- Exposing the package-manager runner to renderer clients: rejected — the CLI and the provider are the only consumers; receipts and snapshots stay server-side.
