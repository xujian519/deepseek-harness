---
description: "Browser automation backend cascade for model-facing download and scraping tools, ported from the Sati browser backend layer (`src/browser/backend/`). Four backends are probed and routed in a fixed order — **ego lite → BrowserOS neo → browser-use → @playwright/mcp** — with a cold-decision rule: the backend for a task is resolved once before the task starts and never switches mid-task. The unified ego stack routes downloads to ego only; the other backends join the probe matrix but never take a download."
kind: "package-reference"
---

# @deepseek-ai/dsh-browser-backend

English | [中文](README.zh.md)

## Summary

Browser automation backend cascade for model-facing download and scraping tools, ported from the Sati browser backend layer (`src/browser/backend/`). Four backends are probed and routed in a fixed order — **ego lite → BrowserOS neo → browser-use → @playwright/mcp** — with a cold-decision rule: the backend for a task is resolved once before the task starts and never switches mid-task. The unified ego stack routes downloads to ego only; the other backends join the probe matrix but never take a download.

No runtime invariant companion is published; the backend probes and routing are stateless read-only operations with no package-owned durable state, and the download tools that consume the routed backend own their execution relations.


## Table of Contents

- [Backends and capabilities](#backends-and-capabilities)
- [Routing](#routing)
- [Link extractors](#link-extractors)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Backends and capabilities

Each backend exposes a read-only `probe()` (no browser spawn, ≤5s, side-effect free by default) and a capability bitmask. The download tools decide whether a backend can safely take a task from the bits:

| Backend | probe | downloadInterception | loginState | antiBot |
| --- | --- | --- | --- | --- |
| `ego` | macOS/Windows + `ego-browser` CLI (looked up in `~/.local/bin` then PATH; optional `--doctor` connection probe) | yes | yes | yes |
| `browseros-neo` | HTTP reachability of the MCP endpoint (`127.0.0.1:9010/mcp`, `DSH_BROWSEROS_MCP_URL` override) + listening-pid ownership | yes | yes | yes |
| `browser-use` | `browser-use --version` (browser-harness CLI) | no (downloads go through link extraction + fetch) | yes | yes |
| `playwright` | global `playwright` / `@playwright/mcp` CLI presence | no | no | no |

## Routing

- `buildBackendCandidates(options)` — ordered candidate list; `prefer` moves one backend to the front, `exclude` drops candidates.
- `resolveBrowserBackend(options)` — cold decision: the first candidate whose probe is `ok`; throws with install guidance when none is available.
- `probeAllBackends(options)` — probe every candidate without short-circuiting (used by the `browsers` diagnostic command).

The ego lookup matches the execution session (`~/.local/bin` then each PATH segment, Windows-aware extensions), so the availability probe is consistent with what actually runs.

## Link extractors

- `BrowserUseExtractor` runs the browser-harness `browser-use` CLI (heredoc Python script, helpers pre-imported) to open a page and extract a value with a `js(...)` expression, printing a `BU_EXTRACT:<value>` marker on stdout.
- `EgoExtractor` runs the `ego-browser` CLI to open a page and extract a value with a `js(...)` expression, emitting an `EGO_EXTRACT:<value>` cliLog marker over the browser's task-space/login state. `paper_download` uses it as the ego fallback channel.

Both extractors are `PageExtractor` implementations; download tools pick one and fetch the extracted link.

## Known Limitations and Deferred Work

- **Probe-only backends**: `browseros-neo` and `playwright` participate in probing and routing, but no download execution exists for them yet — the download tools reject them with guidance (they lack the intercept/extract channel the downloaders implement).
- **Downloads route to ego only**: with the unified ego stack, `patent_pdf_download` and `paper_download` resolve the ego backend; browseros-neo / playwright / browser-use never take a download.
- **browser-use has no download interception**: per the Sati POC mapping, its downloads go through link extraction + fetch; screencast and handoff capabilities are also off.
- **browser-use is a local CLI, not an npm dependency**: the probe fails with an install hint when the CLI is absent; the package never assumes it is installed.

### Dev Note

None.
