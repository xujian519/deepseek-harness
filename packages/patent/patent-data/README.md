# @deepseek-ai/dsh-patent-data

English | [中文](README.zh.md)

Service Definition for the patent data seam (`ctx.patentData`): the LRU-cached search provider factory over the vendored [`@deepseek-ai/nuo-patent`](../../../vendor/nuo-patent/README.md) engine, the structured metadata mapper, the patent result cache, and the ego-browser anti-crawl session runner over the injected subprocess service, plus the persistence and case-path helpers ported from Sati. Consumers own every model-facing surface; this package resolves and serves patent data.

## Service

The `PatentData` service injects `subprocess` and exposes two capability methods.

### createSearchProvider(options?)

Builds a nuo-backed `StageProvider` whose `search(query, { maxResults })` maps source hits to the `{ title, snippet, url }` stage vocabulary. Without `options.search` it wraps the nuo `searchPatents` in the LRU cache, so a repeated query within the TTL reuses the cached result instead of re-spawning the network path.

### createEgoSession(options?)

Builds an `EgoBrowserSession` over the injected `ctx.subprocess`. The runner checks ego-browser availability, probes the connection, names session-scoped task spaces, and runs scripts verbatim through stdin (the subprocess seam's batch stdin replaces the single-quoted heredoc, so script content is never shell-expanded). `options.runner` overrides the subprocess-backed default.

## Configuration

The service has no cordis.yml `Config` schema; both methods take per-call options.

| Method | Key | Default | Meaning |
| --- | --- | --- | --- |
| `createSearchProvider` | `search` | LRU-cached nuo `searchPatents` | Underlying search function injection. |
| `createEgoSession` | `commandName` | `ego-browser` | CLI command name. |
| `createEgoSession` | `defaultTimeoutMs` | `90000` | Default run timeout in milliseconds. |
| `createEgoSession` | `maxTimeoutMs` | `300000` | Hard cap for per-run timeout. |
| `createEgoSession` | `homeDir` | `os.homedir()` | Home directory locating `~/.local/bin`. |
| `createEgoSession` | `pathEntries` | `[<home>/.local/bin]` | Extra PATH directories injected into the spawn env. |
| `createEgoSession` | `maxOutputBytes` | `500000` | Soft cap in bytes for the merged output. |
| `createEgoSession` | `runner` | subprocess-backed runner | Spawn runner injection for tests. |

## Model Experience

None, as the data seam resolves and serves patent data to the tool layer; dsh-patent-tools owns every model-facing schema and result.

#### KV Cache effect

Independent; the data seam registers no prompt, tool schema, or result of its own.

## Known Limitations and Deferred Work

- **External `ego-browser` CLI dependency** — the anti-crawl scrape path needs the external `ego-browser` (ego-lite) CLI installed and on the PATH (macOS only); the package ships no ego-browser script assets (Sati's `skills/ego-browser/` holds only learnings), so site anti-crawl upgrades are maintained outside this package.
- **Scaffold-stage service surface** — the service exposes only the search provider factory and the ego-session runner; the cache, mapper, persistence, and path modules are exported but not yet wired to model-facing tools, which land with `dsh-patent-tools` (P3.x).
