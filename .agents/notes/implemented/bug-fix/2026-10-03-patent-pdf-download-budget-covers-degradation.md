# Agent Note: patent_pdf_download budgets the overall call for its own degradation path

Status: implemented

English | [中文](2026-10-03-patent-pdf-download-budget-covers-degradation.zh.md)

## Problem

`patent_pdf_download` derived its default overall timeout from a flat per-patent allowance of 25 seconds — `clamp(patents × 25s, 60s, 180s)` — while the same request handed its ego leg `pageTimeoutSec` (default 20) plus `downloadTimeoutMs` (default 60), 80 seconds per patent. A one-patent call therefore had a 60-second budget for up to 80 seconds of permitted work, and a three-patent call 75 seconds for 240.

The shortfall is only reachable through the fallback the tool documents. The ego leg fails a batch outright when the browser is usable but the script faults, and an unusable browser is precisely the case that falls through to the page scrape plus HTTP fetch. On this deployment's ego-browser 0.5.1.13 (Chromium 152) the intercept never lands a file, so the leg spends its whole poll before falling through — and the overall timeout kills the call first. Measured on 2026-10-03 against a real case's comparison patents: a default call ended in `patent_pdf_download 超出 ego-browser 整体超时` at 60,007 ms, while the same call with an explicit `timeoutMs: 180000` succeeded in 63,410 ms through the HTTP fallback.

## Decision

The default derives from the per-patent budgets it wraps, plus one batch-level setup allowance, under the input's own 300s ceiling:

```ts ignore-check
const perPatentMs = pageTimeoutSecValue * 1000 + downloadTimeoutMsValue
timeoutMs = Math.min(300_000, Math.max(60_000, patents.length * perPatentMs + PER_BATCH_OVERHEAD_MS))
```

`PER_BATCH_OVERHEAD_MS` is 15 seconds. A caller that passes `timeoutMs` is unaffected.

## Alternatives considered

- **Shorten `downloadTimeoutMs` so the sums fit the old ceiling.** Rejected: that poll budget is what a working intercept needs for a large PDF, so shrinking it trades a broken deployment's latency for a working one's correctness.
- **Have the ego script emit partial results before the overall deadline.** Deferred rather than rejected: it requires threading the deadline into the script and reserving time per patent, and it does not by itself make the default consistent with the budgets it wraps.
- **Repair the intercept instead.** Unreachable with the surface available: `Page.setDownloadBehavior` is inert on Chromium 152 (no file lands in 15 seconds), `Browser.setDownloadBehavior` is absent from `cdp` (`'Browser.setDownloadBehavior' wasn't found`) and sets nothing when sent through `sendCDPMessage`, and a page-context `fetch` of the CDN URL fails CORS. The `ego` object exposes task spaces and CDP only, with no download primitive.

## Consequences

- A default batch whose intercept stalls now completes through the HTTP fallback instead of failing, at the cost of the ego poll (about 60 seconds per patent) spent first. Every patent still reports its `method` and landed path, and the MANIFEST resume is unchanged.
- The tool's schema description and `timeoutMs` JSDoc state the new formula; `docs/tool-catalog.md` and its Chinese pair are regenerated.
- `patent-pdf-download.spec.ts` asserts the derived budget against the per-patent sum, an explicit `pageTimeoutSec`/`downloadTimeoutMs` pair, the 60-second floor, and the 300-second ceiling.
- The preset's PDF channel is an ordered degradation chain — the tool, then a backoff retry and the CNIPR, CNIPA, and Google Patents channel skills, and only then a direct CDN link with its failure reason and channel recorded — and its `检索通道顺序` reference now points at the order stated in the same bullet instead of an undefined section.
