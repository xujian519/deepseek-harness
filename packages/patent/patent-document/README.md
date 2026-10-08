---
description: "Function plugin porting the Sati patent document renderer into the DeepSeek Harness: eleven shipped Chinese attorney-deliverable HTML templates, brand injection, headless-Chrome PDF rendering through ctx.subprocess, the render_patent_document tool, and the verify_deliverable delivery-consistency check."
kind: "package-reference"
---

# @deepseek-ai/dsh-patent-document

English | [中文](README.zh.md)

## Summary

Function plugin porting the Sati patent document renderer into the DeepSeek Harness: eleven shipped Chinese attorney-deliverable HTML templates, brand injection, headless-Chrome PDF rendering through ctx.subprocess, the render_patent_document tool, and the verify_deliverable delivery-consistency check.

## Table of Contents

- [render_patent_document tool](#render_patent_document-tool)
- [verify_deliverable tool](#verify_deliverable-tool)
- [Document engine (library API)](#document-engine-library-api)
- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## render_patent_document tool

render_patent_document renders one of the eleven shipped templates — patentability-opinion, search-report, oa-response, claims-spec, invalidation-opinion, rectification-response, re-examination-request, infringement-opinion, litigation-pleading, right-evaluation-report, or search-report-form — into an HTML file and, by default, a PDF. Pick a template id and an outputName, then pass sections as an id -> innerHTML record to fill the template slots. The result is model-facing prose naming the written htmlPath, pdfPath, any pdfError, and warnings; when the PDF fails, the HTML still exists.

The renderer also checks the assembled document and reports each finding in `warnings`: a `一、`-style number outside the section heading level (the level is the document's first numbered heading, and the shipped templates that number sections use `h2`, so a numbered `h3` or `h4` collides with the skeleton), a duplicated section number, a section number out of ascending order, and a heading using internal working-record wording. A supplied section replaces the skeleton's entire inner HTML, chapter heading included, so a caller that wants the heading keeps supplying it. The rules and the wording list the renderer checks live in `document/documentCompliance.ts`; `scripts/verify-patent-document-output.ts` applies the same checks offline to a produced file or to the shipped template examples. The checks report rather than reject, so a rendered document with findings still reaches the caller.

A template declares paragraph numbering on a container with `data-paragraph-numbering`; the attribute value is the number's form (`[0001]` means bracketed, four digits, zero-padded). No Patent Law, Implementing Regulations, or Examination Guidelines clause requires paragraph numbering, so the claims-spec specification section does not carry the attribute by default; add it to a section when the filing format uses numbering, and every `<p>` and `<li>` in that section is written with a literal `[0001]`, `[0002]`, … number, continuous from 1, while headings, table content, and image-only paragraphs receive no number. The number is literal text rather than a CSS counter so the PDF and any downstream HTML-to-docx conversion read the same characters. Existing numbers are stripped and rewritten, so re-rendering is idempotent and hand-written numbers never stack — do not author the numbers by hand.

## verify_deliverable tool

verify_deliverable decides whether a delivery is the one the case main path shows. It takes `artifacts` (each pairing a role with the case main path `canonical_path` and the delivered copy `delivered_path`), optional `figures`, and an optional `rendered` file. Each pair is compared byte for byte, and `rendered` is ordered against every input the check read. The result is `passed`, a `manifest` naming each file with its SHA-256 and mtime, and the violations: `artifact_mismatch` means a reader opening the case main path sees a superseded file, and `render_order` means the rendered deliverable predates an input it shows. Optional `requirements` (each the instructing party's own wording plus the files that evidence it) turn the check into the delivery's requirement checklist: a requirement with no evidence, or with an evidence file that does not exist, fails the delivery, and the result carries one row per requirement (requirement, evidence, satisfied) that the delivery report quotes instead of a prose assurance.

## Document engine (library API)

The package re-exports the ported engine for direct callers: renderPatentDocument, renderPdf, findChrome, buildBrandStyle, mergeBrand, loadBrandFromPath, readTemplateManifest, resolveTemplate, readTemplateHtml, getTemplateRoot, and DocumentRenderError. These are keyless pure functions; nothing mounts them automatically.

## Configuration

Schemastery configuration, every field optional.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| chromePath | string | none | Absolute Chrome executable used for PDF; overrides DSH_CHROME_PATH/CHROME_PATH discovery. |
| outputRoot | string | .dsh/documents | Default output directory (relative to the process working directory) when neither outputDir nor caseId is given. |
| pdfTimeoutMs | number | 120000 | Timeout for one headless-Chrome print; a slower deployment can raise it without changing the SIGTERM->SIGKILL grace (3 s) or the per-stream output cap (100000 bytes), which stay fixed as a teardown symmetry and a memory bound. |

## Model Experience

### render_patent_document tool

#### What the model sees

One registered tool named `render_patent_document` with a required `template` enum (eleven ids: `patentability-opinion`, `search-report`, `oa-response`, `claims-spec`, `invalidation-opinion`, `rectification-response`, `re-examination-request`, `infringement-opinion`, `litigation-pleading`, `right-evaluation-report`, `search-report-form`), a required `outputName`, and optional `caseId`, `outputDir`, `format`, `sections`, `brand`, and `brandPath`. The result renders as Markdown prose naming the written `htmlPath`, `pdfPath`, any `pdfError`, and `warnings`.

#### Token effect

Fixed definition cost on every request while the tool is enabled; each result is a few short file-path lines resent only until compaction.

#### KV Cache effect

Append-only; newly visible result prose follows the reusable request prefix and does not invalidate existing KV-cache entries.

### verify_deliverable tool

#### What the model sees

One registered tool named `verify_deliverable` with a required `artifacts` array (`role`, `canonical_path`, `delivered_path`), optional `figures`, an optional `rendered` path, and optional `requirements` (`requirement` in the instructing party's words plus `evidence` file paths). The result renders as Markdown: a pass/fail head, the delivery manifest naming each file with its SHA-256 and mtime, the per-requirement checklist when requirements were given, then any violations with a suggestion each.

#### Token effect

Fixed definition cost on every request while the tool is enabled; each result carries one manifest line per file it read.

#### KV Cache effect

Append-only; newly visible result prose follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **No default brand theme.json** — the Sati products/_example/brand/theme.json default-brand fallback is dropped; callers must pass brand or brandPath explicitly, or the templates' tokens.css defaults apply.
- **PDF needs a discoverable Chrome** — headless PDF printing spawns Chrome through ctx.subprocess (replacing Sati's execFile); when no Chrome is discoverable (or chromePath/DSH_CHROME_PATH is unset), rendering degrades to HTML-only and the result carries pdfError.
- **Default output directory is .dsh/documents** — relative to the process working directory (replacing Sati's .sati/documents); a caseId keeps the data/cases/<caseId>/outputs convention.
- **brandPath reads a Sati-shaped theme.json** — the loader reads the documents.patent namespace from that file; no other theme schema is supported.
- **No figure page or image embedding** — the templates carry the 附图说明 text section only; a rendered document contains no drawing images, so drawings reach the client as separate attachments that the caller names and ships alongside the rendered file.
- **Paragraph numbering is opt-in and needs the renderer** — `data-paragraph-numbering` is a declaration, not markup; it is interpreted only by render_patent_document. No Patent Law, Implementing Regulations, or Examination Guidelines clause requires paragraph numbering, so the claims-spec template declares none; a template that declares it relies on the render path, and the writer must not author the numbers.

### Dev Note

None.
