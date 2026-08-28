---
description: "Domain plugins for the [document agent preset](../preset/agent-presets/presets/document/preset.yml): the structured deliverable registration that backs the delivery studio's file list and quality-gate badges."
kind: "package-group"
---

# document/ — document-delivery domain plugins

English | [中文](README.zh.md)

Domain plugins for the [document agent preset](../preset/agent-presets/presets/document/preset.yml): the structured deliverable registration that backs the delivery studio's file list and quality-gate badges.

| Package | Role | ctx key |
|---|---|---|
| [`document-deliver/`](document-deliver/README.md) | Model-facing `document_deliver`: record delivered files, formats, and quality-gate state in the session log. | (registers on `ctx.tools`) |

Each package README owns its contract.
