---
description: "Function plugin porting the Sati patent document renderer into the DeepSeek Harness: nine shipped Chinese attorney-deliverable HTML templates, brand injection, headless-Chrome PDF rendering through ctx.subprocess, and the render_patent_document tool."
kind: "package-reference"
---

# @deepseek-ai/dsh-patent-document

English | [中文](README.zh.md)

## Summary

Function plugin porting the Sati patent document renderer into the DeepSeek Harness: nine shipped Chinese attorney-deliverable HTML templates, brand injection, headless-Chrome PDF rendering through ctx.subprocess, and the render_patent_document tool.

## Table of Contents

- [render_patent_document tool](#render_patent_document-tool)
- [Document engine (library API)](#document-engine-library-api)
- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## render_patent_document tool

render_patent_document renders one of the nine shipped templates — patentability-opinion, search-report, oa-response, claims-spec, invalidation-opinion, rectification-response, re-examination-request, infringement-opinion, or litigation-pleading — into an HTML file and, by default, a PDF. Pick a template id and an outputName, then pass sections as an id -> innerHTML record to fill the template slots. The result is model-facing prose naming the written htmlPath, pdfPath, any pdfError, and warnings; when the PDF fails, the HTML still exists.

## Document engine (library API)

The package re-exports the ported engine for direct callers: renderPatentDocument, renderPdf, findChrome, buildBrandStyle, mergeBrand, loadBrandFromPath, readTemplateManifest, resolveTemplate, readTemplateHtml, getTemplateRoot, and DocumentRenderError. These are keyless pure functions; nothing mounts them automatically.

## Configuration

Schemastery configuration, every field optional.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| chromePath | string | none | Absolute Chrome executable used for PDF; overrides DSH_CHROME_PATH/CHROME_PATH discovery. |
| outputRoot | string | .dsh/documents | Default output directory (relative to the process working directory) when neither outputDir nor caseId is given. |

## Model Experience

### render_patent_document tool

#### What the model sees

One registered tool named `render_patent_document` with a required `template` enum (nine ids: `patentability-opinion`, `search-report`, `oa-response`, `claims-spec`, `invalidation-opinion`, `rectification-response`, `re-examination-request`, `infringement-opinion`, `litigation-pleading`), a required `outputName`, and optional `caseId`, `outputDir`, `format`, `sections`, `brand`, and `brandPath`. The result renders as Markdown prose naming the written `htmlPath`, `pdfPath`, any `pdfError`, and `warnings`.

#### Token effect

Fixed definition cost on every request while the tool is enabled; each result is a few short file-path lines resent only until compaction.

#### KV Cache effect

Append-only; newly visible result prose follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **No default brand theme.json** — the Sati products/_example/brand/theme.json default-brand fallback is dropped; callers must pass brand or brandPath explicitly, or the templates' tokens.css defaults apply.
- **PDF needs a discoverable Chrome** — headless PDF printing spawns Chrome through ctx.subprocess (replacing Sati's execFile); when no Chrome is discoverable (or chromePath/DSH_CHROME_PATH is unset), rendering degrades to HTML-only and the result carries pdfError.
- **Default output directory is .dsh/documents** — relative to the process working directory (replacing Sati's .sati/documents); a caseId keeps the data/cases/<caseId>/outputs convention.
- **brandPath reads a Sati-shaped theme.json** — the loader reads the documents.patent namespace from that file; no other theme schema is supported.

### Dev Note

None.
