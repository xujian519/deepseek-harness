---
description: "Function plugin porting the Sati academic-literature layer into the DeepSeek Harness: four free, keyless scholarly sources — arXiv, OpenAlex, Semantic Scholar, and Crossref — normalized behind one connector registry and exposed to the model as three stateless tools, `paper_list_sources`, `paper_search`, and `paper_download`. The port preserves the source's per-host polite rate limiting (arXiv 1 request per 3 seconds, keyless Semantic Scholar 1 request per second) and its in-process GET cache with LRU eviction, so fan-out across sources is not over-serialized and malformed responses never poison the cache."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-literature

English | [中文](README.zh.md)

## Summary

Function plugin porting the Sati academic-literature layer into the DeepSeek Harness: four free, keyless scholarly sources — arXiv, OpenAlex, Semantic Scholar, and Crossref — normalized behind one connector registry and exposed to the model as three stateless tools, `paper_list_sources`, `paper_search`, and `paper_download`. The port preserves the source's per-host polite rate limiting (arXiv 1 request per 3 seconds, keyless Semantic Scholar 1 request per second) and its in-process GET cache with LRU eviction, so fan-out across sources is not over-serialized and malformed responses never poison the cache.

## Table of Contents

- [Tools](#tools)
- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Tools

The model discovers available `db` ids through `paper_list_sources`, then queries a specific source through `paper_search` and downloads a paper's PDF through `paper_download`; the tool count stays constant (three) no matter how many sources are wired in. All three are stateless over public sources and need no agent or session.

### paper_list_sources

Lists the connector catalog with no network I/O: each source's `id`, `name`, and `description`, plus the set of distinct domains (currently only `literature`). It takes one optional `domain` filter.

### paper_search

Searches one source by `db` id and `query`, with an optional `limit` (1–50, default 10). Results are normalized hits carrying `id`, `title`, `summary`, `url`, an optional `score`, and an opaque `extra` payload. A source failure (rate limiting or unavailability) fails the call with actionable guidance rather than returning an empty result the model could misread as "no such paper"; a genuine zero-hit query returns an empty `hits` list.

### paper_download

Downloads one paper's PDF by `db` + `id` (from a `paper_search` hit), saving it as `<outputDir>/<id>.pdf` (default `<cwd>/论文原文/YYYY-MM-DD/<id>.pdf`). The direct PDF link wins — the first non-empty of `extra.pdf_url` / `extra.pdf` / `pdf_url` / `pdf`, OpenAlex `best_oa_location.pdf_url` / `open_access.oa_url` / `primary_location.pdf_url`, and Semantic Scholar `openAccessPdf.url` — verified by PDF magic and minimum size. When the link is missing or the fetch fails (403/404/HTML shell page), the ego extractor opens the record page (`url`, `URL`, `landing_page_url`, a nested location landing page, or an `id` that is itself an HTTP URL), extracts the PDF link, and the same fetch path downloads it. An explicit `pdfUrl` override skips connector resolution. `timeoutMs` (default 60000, max 300000) bounds the whole call: connector lookup, the direct fetch, browser extraction, and the fallback fetch share one deadline. Mirrors the patent_pdf_download channel design (direct-first, browser fallback).

## Configuration

Schemastery configuration, every field optional.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `arxiv` | boolean | `true` | Register the arXiv connector. |
| `openalex` | boolean | `true` | Register the OpenAlex connector. |
| `semanticScholar` | boolean | `true` | Register the Semantic Scholar connector. |
| `crossref` | boolean | `true` | Register the Crossref connector. |
| `openalexMailto` | string | — | OpenAlex polite-pool email; falls back to `OPENALEX_MAILTO`, then a default. |
| `semanticScholarApiKey` | string | — | Semantic Scholar API key for a higher rate tier. |
| `timeoutMs` | number | `30000` | Timeout for one HTTP request, in ms. |
| `cacheTtlMs` | number | `300000` | GET cache TTL in ms; `0` disables the cache. |
| `retry.maxRetries` | number | `3` | Retries after the first attempt. |
| `retry.baseDelayMs` | number | `1000` | First backoff delay, in ms. |
| `retry.maxDelayMs` | number | `15000` | Cap for one backoff delay, in ms. |

The connector factories accept a `fetchImpl` override used only by tests; it is not a `Config` field.

## Model Experience

### Tools

#### What the model sees

Three registered tool definitions: `paper_list_sources` (optional `domain`), `paper_search` (required `db` and `query`, optional `limit`), and `paper_download` (required `db` and `id`, optional `pdfUrl`/`outputDir`/`timeoutMs`). Each description instructs the model to call `paper_list_sources` first to discover a `db` id, and notes that fielded arXiv queries such as `ti:transformer AND cat:cs.LG` pass through. Connector enablement changes only which `db` ids are valid, never the definitions.

#### Token effect

Fixed definition cost per request, independent of how many connectors are enabled; disabling a connector removes no schema tokens, it only narrows the catalog `paper_list_sources` returns.

#### KV Cache effect

Prefix-stable while the three definitions and their visibility are unchanged; plugin registration or disposal invalidates reuse from the first changed definition token.

### Search result

#### What the model sees

A successful `paper_search` renders one Markdown block per hit — a `## <title>` heading followed by `**id**`, an optional `**url**`, an optional `**pdf**` link when the source reports one, an optional ` · score`, and the summary. A zero-hit query renders `No results for "<query>" in <db>.`; a source failure renders its actionable guidance text.

#### Token effect

Data-dependent results are resent until compaction; each hit's summary and title are bounded by the connector's snippet truncation (600 characters for summaries, 300 for titles), and the source response bounds the rest.

#### KV Cache effect

Append-only; newly visible result text follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Source list result

#### What the model sees

`paper_list_sources` renders `Available literature sources (<count>):` followed by one `- **<id>** (<name>) — <description>` line per source. With no matching sources it renders `No literature sources are registered.` (or the domain-filtered variant).

#### Token effect

Small and bounded: the catalog is fixed at registration time (at most four entries), so the rendered list is stable and resent until compaction.

#### KV Cache effect

Append-only; newly visible list text follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Keyless public sources only** — the four connectors cover free, no-API-key sources; there is no model for authenticated or premium tiers, and no connector requires credentials to function (a Semantic Scholar key only raises the rate limit).
- **Per-host rate limiting can add latency** — arXiv paces to 1 request per 3 seconds and keyless Semantic Scholar to 1 request per second, so a multi-source fan-out with many arXiv hits may queue behind the polite interval; pacing is per-host, so unrelated sources proceed in parallel.
- **PDF availability follows the source's open-access status** — `paper_download` resolves the link the source reports (arXiv pdf, OpenAlex best-oa / primary location, Semantic Scholar openAccessPdf, Crossref record URL only); paywalled records have no direct link, so the call either fails with guidance or succeeds only if the record page still exposes a PDF.
- **The direct PDF fetch makes one attempt** — `paper_download` does not retry the direct link or the browser-extracted link; a transient 5xx surfaces as a failed result carrying the attempted `pdfUrl`, which the model can retry through `pdfUrl`.
- **The browser fallback channel is the unified ego stack** — `paper_download`'s fallback opens the record page through `EgoExtractor`; browser-use extraction is no longer a download-channel fallback.

### Dev Note

None.
