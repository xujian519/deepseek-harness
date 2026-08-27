# Agent Note: Unified browser download onto the ego stack (ego lite)

Status: implemented

English | [中文](2026-08-27-unified-ego-browser-stack.zh.md)

## Problem

`patent_pdf_download` and `paper_download` both fall back to a browser to open a page and extract a PDF link. On macOS the operator's ego lite / ego-browser install worked well from a terminal, but the harness never chose it: the availability probe and the execution session judged availability differently, and the platform gate and PATH assumption locked ego to darwin. The agent therefore routed downloads to browser-use even though ego was present.

## Decision

The browser download channel is unified onto the ego stack:

- **Probe matches execution.** `createEgoBackend` (dsh-browser-backend) now resolves the CLI the same way `EgoBrowserSession` (dsh-patent-data) does: `<homeDir>/.local/bin` first, then each PATH segment, with Windows-aware extension lookup. The probe no longer relies on a bare `which`.
- **Platform gate widened.** Both the probe and `EgoBrowserSession.checkAvailability` accept `darwin` and `win32` (ego lite supports Windows); other platforms report unavailable.
- **Windows PATH delimiter.** `EgoBrowserSession.buildEnv` and `isCommandExecutable` join and split PATH with `;` on Windows instead of a hard-coded `:`.
- **Downloads route to ego only.** `createDownloadRunnerResolver` resolves `exclude: ['browseros-neo', 'playwright', 'browser-use']` and always returns the ego runner; browser-use extraction and fetch is no longer a download-channel fallback.
- **`paper_download` uses ego extraction.** A `PageExtractor` interface abstracts "open a URL, extract one js-expression value"; `BrowserUseExtractor` and the new `EgoExtractor` implement it. `paper_download` defaults to `EgoExtractor` (an `EGO_EXTRACT:<value>` cliLog marker over the browser's task-space/login state) instead of the browser-use extractor.

The four-backend cascade remains as a probe matrix (the `browsers` diagnostic command); only the download channel is ego-only. The harness still calls the ego CLI as a subprocess — this is not an in-process SDK embed nor an ego-lite fork.

## Alternatives considered

**Fork ego-lite and embed its source.** Rejected: ego-lite is the same JS/TS stack (no cross-language bridge needed), MIT-licensed, and ships an `installEgoSdk` in-process API, so the deep-integration goal is met with a git/npm dependency plus a thin adapter rather than a divergent fork. It also iterates fast (13.9k stars, daily pushes), so a fork would carry a permanent inter-merge cost, and the download tools' needs (open page, screenshot, extract link, download, share login state) are already covered by its SDK surface — no kernel change is required.

**Adopt browserOS neo for Windows (or as a macOS fallback).** Rejected for this change: the browseros-neo backend is probe-only (no download execution), its probe accepts any non-404 HTTP response on the port, and the MCP endpoint has no authentication. The cascade order already places ego first, so on Windows the ego backend takes precedence without a preference override.

**Keep browser-use as the download fallback.** Rejected: the unified stack makes ego the single download channel, and the split probe/execution vocabulary was the source of the "not preferred" bug. `BrowserUseExtractor` and `createBrowserUseDownloadRunner` remain for callers that explicitly want browser-use.

## Consequences

Bought: ego is now the chosen backend whenever present on macOS or Windows; the probe agrees with what actually runs; `paper_download` shares ego's task-space/login state. A single backend owns the download path, so capability bits no longer decide the download route.

Cost: `browseros-neo`, `playwright`, and `browser-use` no longer take downloads (they still probe); the download resolver keeps a `resolve` option only for test injection; a new `PageExtractor` seam sits between the tools and the two extractors. The ego CLI is still spawned per call, so the subprocess isolation (crash boundary) is preserved at the cost of a process spawn and no in-process type safety.
