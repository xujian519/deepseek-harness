---
description: "Service Definition for the patent data seam (`ctx.patentData`): the LRU-cached search provider factory over the vendored [`@deepseek-ai/nuo-patent`](../../../vendor/nuo-patent/README.md) engine, the structured metadata mapper, the patent result cache, and the ego-browser anti-crawl session runner over the injected subprocess service, plus the persistence and case-path helpers ported from Sati. Consumers own every model-facing surface; this package resolves and serves patent data."
kind: "package-reference"
---

# @deepseek-ai/dsh-patent-data

English | [中文](README.zh.md)

## Summary

Service Definition for the patent data seam (`ctx.patentData`): the LRU-cached search provider factory over the vendored [`@deepseek-ai/nuo-patent`](../../../vendor/nuo-patent/README.md) engine, the structured metadata mapper, the patent result cache, and the ego-browser anti-crawl session runner over the injected subprocess service, plus the persistence and case-path helpers ported from Sati. Consumers own every model-facing surface; this package resolves and serves patent data.

## Table of Contents

- [Service](#service)
- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Service

The `PatentData` service injects `subprocess` and exposes two capability methods.

### createSearchProvider(options?)

Builds a nuo-backed `StageProvider` whose `search(query, { maxResults })` maps source hits to the `{ title, snippet, url }` stage vocabulary. Without `options.search` it wraps the nuo `searchPatents` in the LRU cache, so a repeated query within the TTL reuses the cached result instead of re-spawning the network path.

### createEgoSession(options?)

Builds an `EgoBrowserSession` over the injected `ctx.subprocess`. The runner checks ego-browser availability, probes the connection, names session-scoped task spaces, and runs scripts verbatim through stdin (the subprocess seam's batch stdin replaces the single-quoted heredoc, so script content is never shell-expanded). `options.runner` overrides the subprocess-backed default, and the deployment's `Config` supplies the command name, the probe and run deadlines, and the output cap; a per-call option overrides each of those.

## Configuration

cordis.yml `Config` declares the ego-browser values a deployment varies; a per-call option overrides the same-named field.

| Key | Default | Meaning |
| --- | --- | --- |
| `commandName` | `ego-browser` | CLI command name. |
| `probeTimeoutMs` | `8000` | Connection-probe timeout in milliseconds. |
| `defaultTimeoutMs` | `90000` | Default run timeout in milliseconds. |
| `maxTimeoutMs` | `300000` | Hard cap for a per-run timeout. |
| `maxOutputBytes` | `500000` | Soft cap in bytes for the merged output. |
| `nuoRequestChannel` | `auto` | Channel nuo's requests travel over: `auto` keeps nuo's own availability probe, `native` forces the plain fetch, `browser` the ego-browser path. Either explicit value writes the process-wide `NUO_PATENT_EGO_BROWSER`, because that variable is the only switch nuo exposes. |

The remaining options are per-call only: they are test seams or values this service cannot know.

| Method | Key | Default | Meaning |
| --- | --- | --- | --- |
| `createSearchProvider` | `search` | LRU-cached nuo `searchPatents` | Underlying search function injection. |
| `createEgoSession` | `homeDir` | `os.homedir()` | Home directory locating `~/.local/bin`. |
| `createEgoSession` | `pathEntries` | `[<home>/.local/bin]` | Extra PATH directories injected into the spawn env. |
| `createEgoSession` | `platform` | `process.platform` | Platform override. |
| `createEgoSession` | `env` | `process.env` | Environment override. |
| `createEgoSession` | `runner` | subprocess-backed runner | Spawn runner injection for tests. |

## Model Experience

None, as the data seam resolves and serves patent data to the tool layer; dsh-patent-tools owns every model-facing schema and result.

#### KV Cache effect

Independent; the data seam registers no prompt, tool schema, or result of its own.

## Known Limitations and Deferred Work

- **External `ego-browser` CLI dependency** — the anti-crawl scrape path needs the external `ego-browser` (ego-lite) CLI installed and on the PATH (macOS only); the package ships no ego-browser script assets (Sati's `skills/ego-browser/` holds only learnings), so site anti-crawl upgrades are maintained outside this package.
- **nuo's browser path breaks search when a JSON viewer extension is installed** — `fetchHtml` prefers the ego-browser path whenever that CLI is installed on macOS, so leaving `NUO_PATENT_EGO_BROWSER` unset is not the same as staying on the plain fetch. In that path a browser JSON-viewer extension renders the search XHR's `application/json` response as HTML: `parseSearchResultsJson` receives no JSON, the HTML fallback parses no hit, and `patent_search` returns zero results carrying only a non-fatal warning. Measured 2026-10-03 on the same proxy: three queries returned zero hits through the browser path and ten hits each through the plain fetch. Set `nuoRequestChannel: native` where search must work (the patent preset does); the choice is process-wide because nuo exposes it only as an environment variable.
- **Consumer wiring** — the search provider and ego-session runner are consumed by `dsh-patent-tools` (patent_search/metadata/legal_status and patent_pdf_download). The cache, mapper, persistence, and path modules stay library exports for those consumers.

### Dev Note

None.

No companion is published because the data seam serves callers on demand and owns no durable package-local event stream; search and ego-browser runs are consumed by the tool layer, which owns the model-visible and session-log relations.
