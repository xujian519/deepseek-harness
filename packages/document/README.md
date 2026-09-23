---
description: "Package map for the document group: the model-facing deliverable registration for the document agent preset, and Host Office conversion to reusable PDFs."
kind: "package-group"
---

# document/ — document delivery and Office conversion

English | [中文](README.zh.md)

## Summary

The document group holds the document agent preset's model-facing plugins and Host-side Office conversion. `document-deliver/` provides the `document_deliver` tool, which records delivered files, formats, and quality-gate state in the session log and backs the delivery studio's file list and quality-gate badges. `doc-template/` renders packaged Chinese templates to Markdown, HTML, and DOCX, `docx-kit/` renders Markdown to DOCX and reads DOCX text, and `doc-style/` owns the tone, voice, anti-pattern, and disclaimer model. `office-to-pdf/` converts authorized Office files to reusable PDFs through the LibreOffice kit where a target declares a native engine and Node WASM otherwise. Child READMEs own each package contract.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Each package owns its configuration and lifetime rules; the subsystem reference describes the shared Office conversion operation.

| Package | Role | ctx key |
|---|---|---|
| [`document-deliver/`](document-deliver/README.md) | Model-facing `document_deliver`: record delivered files, formats, and quality-gate state in the session log. | (registers on `ctx.tools`) |
| [`docx-kit/`](docx-kit/README.md) | Markdown to DOCX rendering and DOCX to text projection over Node's standard library. | — |
| [`doc-template/`](doc-template/README.md) | Packaged Chinese document templates rendered to Markdown, HTML, and DOCX, with `list_doc_templates` and `render_doc_template`. | (registers on `ctx.tools`) |
| [`doc-style/`](doc-style/README.md) | Document style model: tone/voice/anti-patterns/disclaimers with the prompt, render-style, and disclaimer projections. | — |
| [office-to-pdf](office-to-pdf/README.md) | Authorized Office bytes to complete PDFs with bounded queues and caching | `ctx.officeToPdf` |

-----

<a id="related-documentation"></a>
## Related documentation

Consumers own source authorization and presentation.

- [Document conversion](../../docs/subsystems/office-to-pdf.md) — shared operation and generated service reference.
- [Document preset](../bundle/web-app/presets/document.patch.yml) — the declaration whose composition mounts the delivery plugins.
- [Independent kit ownership](../../.agents/notes/implemented/architecture/2026-09-14-independent-libreoffice-kit.md) — engine distribution and application integration.
- [Workspace Files](../api/workspace-files/README.md) — authorized bounded source reads.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
