---
description: "Package map for the document group: the model-facing deliverable registration for the document agent preset, and Host Office conversion to reusable PDFs."
kind: "package-group"
---

# document/ — document delivery and Office conversion

English | [中文](README.zh.md)

## Summary

The document group holds the model-facing domain plugins for the document agent preset and the Host-side Office conversion service. `document-deliver/` provides the `document_deliver` tool, which records delivered files, formats, and quality-gate state in the session log and backs the delivery studio's file list and quality-gate badges. `office-to-pdf/` converts authorized Office files to reusable PDFs on the Host, through the LibreOffice kit where a target declares a native engine and Node WASM otherwise. Child READMEs own each package contract.

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
| [office-to-pdf](office-to-pdf/README.md) | Authorized Office bytes to complete PDFs with bounded queues and caching | `ctx.officeToPdf` |

-----

<a id="related-documentation"></a>
## Related documentation

Consumers own source authorization and presentation.

- [Document conversion](../../docs/subsystems/office-to-pdf.md) — shared operation and generated service reference.
- [Document preset](../preset/agent-presets/presets/document/preset.yml) — the composition that mounts the delivery plugins.
- [Independent kit ownership](../../.agents/notes/implemented/architecture/2026-09-14-independent-libreoffice-kit.md) — engine distribution and application integration.
- [Workspace Files](../api/workspace-files/README.md) — authorized bounded source reads.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
