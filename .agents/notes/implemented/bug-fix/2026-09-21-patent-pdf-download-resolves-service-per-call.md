# Agent Note: patent_pdf_download resolves its data service per call

Status: implemented

English | [中文](2026-09-21-patent-pdf-download-resolves-service-per-call.zh.md)

## Problem

In this deployment `patent_pdf_download` failed on every call: 12 of 12 calls across the 143-session corpus recorded between 2026-08-26 and 2026-09-21, each with `patent_pdf_download 需要 patent-data 服务（preset 挂载 @deepseek-ai/dsh-patent-data 后自动接线 ego 通道）；当前未挂载。` The preset *did* mount that package, in the same isolate realm as the consumer, so the message named a cause that was not true and pointed the reader at a row that was already there.

The defect was activation order. `PatentData` declares `static inject = ['subprocess']`, so its fiber waits for the host's `subprocess` service to exist before it applies, while `dsh-patent-tools` declares `inject: ['tools']` and therefore applies one dependency hop earlier. `packages/patent/patent-tools/src/index.ts` read `ctx.get('patentData')` once during that apply and kept the result in a closure; the read landed before the provider activated, so the tool registered its fail-loud stub in every composition built this way — a wiring bug presented to the model as a missing mount.

The downstream cost shows up in the same corpus: with the tool permanently failing, agents downloaded patents by hand — 132 direct `patentimages.storage.googleapis.com` links and 366 `pdftotext` commands — so a capability that exists as a tool was performed outside every audit trail the tool would have kept.

## Decision

The download channel resolves the service per call instead of at apply time:

```ts ignore-check
const runEgo = createDownloadChannelRunner(() => ctx.get('patentData'))
```

`createDownloadChannelRunner` (in `packages/patent/patent-tools/src/tool/patent-pdf-download-channel.ts`) consults the lookup on each batch. A present service drives the ego-browser channel; an absent service, or one whose browser reports itself unusable (`setup_required`), falls through to a browser-free channel that scrapes each patent page for its CDN PDF link and hands the URL to the tool's existing fetch fallback (`networkFetch` with bounded retry, timeout, and `Retry-After` backoff). Ego failures that are *not* setup problems — a timed-out script, an unparsable payload, a spawn error — still fail the call, so a real fault cannot masquerade as a degraded success.

## Alternatives considered

- **Keep the fail-loud stub and rely on the preset's row.** Rejected: the row existed. The stub's message asserted a missing dependency while the actual fault was when the consumer looked for it, which is why the audit's first reading of this failure ("preset missing `patent-data`") was wrong.
- **Declare `inject: ['patentData']` on `dsh-patent-tools`.** Rejected: it would gate all 29 patent tools on one optional data service, so a host without the ego stack would lose search, drafting, and figure tools along with the download.
- **Register the tool inside a `ctx.inject(['patentData'], …)` callback.** Rejected as the primary mechanism: the tool must exist in catalogs even when the service is absent (it is a documented capability with a degradation path), and registering from a callback means either a second registration path or a tool that appears late in the session. A per-call lookup also survives service restarts, which a one-shot registration does not.
- **Drop the ego channel and always scrape.** Rejected: the browser intercept reuses the operator's logged-in session and saves files the CDN link alone cannot reach; the fallback exists to make the tool work without it, not to replace it.

## Consequences

- Downloads now work in compositions where the service activates late, and continue without a browser where none is usable. Ten channel tests cover the ego, unusable-browser, absent-service, and non-setup-failure paths, plus a composition test that reproduces the ordering: a `tools`-only consumer observes `ctx.get('patentData')` as undefined during apply and as the service one tick later.
- A batch without a browser performs one page scrape per patent before the fetch, so it is slower than the intercept path and depends on the page structure that carries the CDN link.
- The browser-free channel relies on the scrape's own request timeout: the LRU-cached scrape seam (`cachedScrapePatent`) accepts neither a per-call timeout nor an abort signal, so a batch cannot be aborted mid-scrape. The module doc states this.
- The tool's user-visible contract is unchanged — same output schema, same MANIFEST resume, same per-patent failure reporting. Only which channel serves the batch, and whether the batch runs at all, changed.
