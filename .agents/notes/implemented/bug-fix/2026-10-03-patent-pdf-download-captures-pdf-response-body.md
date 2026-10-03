# Agent Note: patent_pdf_download captures the PDF response body through CDP

Status: implemented

English | [中文](2026-10-03-patent-pdf-download-captures-pdf-response-body.zh.md)

## Problem

Every batch on this host paid for a browser leg that cannot work: `Page.setDownloadBehavior` no longer lands a download on Chromium 152, so the ego script polled its full `downloadTimeoutMs` (60,000 by default) for each patent and then reported a `fallback` item for the tool's HTTP fetch to download the same CDN link. A ten-patent batch waited up to ten minutes to download nothing. The 2026-10-03 measurement in #350 put one patent at 63,410ms through that path, and the earlier reading of it — "the ego object exposes only task space and CDP, so a byte path needs an ego-side download primitive" — no longer held: the current build (`ego-browser 0.5.1.13 / chromium 152.0.7977.54`) exposes `page.cdp()`, `page.events()`, `page.waitForEvent()`, and a documented `download.saveAs()`.

## Decision

The generated ego script captures the response body instead of awaiting a download: arm the page with `Network.enable`, navigate to the CDN PDF link, read the `Network.responseReceived` for that URL through `page.events()`, and take the bytes from `Network.getResponseBody`. A body that does not begin with `%PDF-` is not the document and is discarded. Anything the capture cannot produce still becomes a `fallback` item carrying the extracted CDN URL, which the tool's fetch fallback downloads, so the degradation path and the output schema are unchanged.

Two details the probes settled:

- The CDN link is the `.pdf` anchor, not the first CDN anchor: a CN utility-model page leads with its drawing PNG, which the previous selector would have taken.
- The task space is resolved by name and left open, so the next call lands in the same space and keeps its login state and tab (`taskSpace('<name>')` returned the same `spaceId` across processes); the previous script closed it.

Measured after the change on this host: three real patents in 1.8–2.8s each with valid PDFs, and 2,661ms end to end through the tool for one patent, reported as `method: browser`.

## Alternatives considered

- **Keep the interception and shorten the first poll.** Rejected: the interception does not land on this Chromium at all, so any budget spent on it is spent on nothing. batch-10 shipped exactly that short-circuit and is superseded by this change.
- **`page.waitForEvent("download")` with `download.saveAs()`**, the download primitive the current ego API documents. Not taken: the Google Patents CDN answers with `application/pdf`, which the browser renders inline instead of downloading, while the CDP body path is proven on the real pages. The download primitive is the right route for a source that answers as an attachment.
- **A page-side `fetch`.** Rejected: the CDN is cross-origin, so the page's own request is refused — the reason the bytes have to come through CDP.

## Consequences

- `method: browser` now means "the browser captured the response body" instead of "the browser's download landed"; the output schema and its values are unchanged. `downloadTimeoutMs` (default 60,000) is now the per-patent body-capture deadline, and the default overall-budget derivation is unchanged and still an upper bound.
- The 60s-per-patent wait is gone because the leg no longer depends on the page-level download behavior. A host without a usable ego browser still falls through to the page-scrape + HTTP channel as before.
- The mechanism needs an ego build that exposes `page.events()` and `Network.getResponseBody`; where it does not, the per-patent `try` degrades that patent to the fetch fallback rather than failing the batch.
- `record: true` evidence screenshots were not exercised here; they still capture the page after the PDF navigation.
- The service-resolution decision and the browser-free channel in [patent_pdf_download resolves its data service per call](2026-09-21-patent-pdf-download-resolves-service-per-call.md) are unchanged; only what the browser leg does with the page changed.
