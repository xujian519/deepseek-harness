# @deepseek-ai/dsh-browser-backend

English | [中文](README.zh.md)

Browser automation backend cascade for model-facing download and scraping tools, ported from the Sati browser backend layer (`src/browser/backend/`). Four backends are probed and routed in a fixed order — **ego lite → BrowserOS neo → browser-use → @playwright/mcp** — with a cold-decision rule: the backend for a task is resolved once before the task starts and never switches mid-task.

## Backends and capabilities

Each backend exposes a read-only `probe()` (no browser spawn, ≤5s, side-effect free by default) and a capability bitmask. The download tools decide whether a backend can safely take a task from the bits:

| Backend | probe | downloadInterception | loginState | antiBot |
| --- | --- | --- | --- | --- |
| `ego` | macOS + `ego-browser` CLI (`--doctor` connection probe optional) | yes | yes | yes |
| `browseros-neo` | HTTP reachability of the MCP endpoint (`127.0.0.1:9010/mcp`, `DSH_BROWSEROS_MCP_URL` override) + listening-pid ownership | yes | yes | yes |
| `browser-use` | `browser-use --version` (browser-harness CLI) | no (downloads go through link extraction + fetch) | yes | yes |
| `playwright` | global `playwright` / `@playwright/mcp` CLI presence | no | no | no |

## Routing

- `buildBackendCandidates(options)` — ordered candidate list; `prefer` moves one backend to the front, `exclude` drops candidates.
- `resolveBrowserBackend(options)` — cold decision: the first candidate whose probe is `ok`; throws with install guidance when none is available.
- `probeAllBackends(options)` — probe every candidate without short-circuiting (used by the `browsers` diagnostic command).

## Browser-use link extractor

`BrowserUseExtractor` runs the browser-harness `browser-use` CLI (heredoc Python script, helpers pre-imported) to open a page and extract a value with a `js(...)` expression, printing a `BU_EXTRACT:<value>` marker on stdout. Download tools use it as the browser fallback channel: open the page, extract the PDF link, then fetch and verify the file. It is the complement of the ego-browser download-intercept path.

## Known Limitations and Deferred Work

- **Probe-only backends**: `browseros-neo` and `playwright` participate in probing and routing, but no download execution exists for them yet — the download tools reject them with guidance (they lack the intercept/extract channel the downloaders implement).
- **browser-use has no download interception**: per the Sati POC mapping, its downloads go through link extraction + fetch; screencast and handoff capabilities are also off.
- **browser-use is a local CLI, not an npm dependency**: the probe fails with an install hint when the CLI is absent; the package never assumes it is installed.
