---
description: "Document-delivery studio for the [document agent preset](../../preset/agent-presets/presets/document/preset.yml): a `conversation.view` tab (`document`, label 交付物) that lists the session's produced files, previews HTML/text through the host, and offers open / show-in-folder / print actions. It also auto-switches a session to the studio when the session's agent preset is the document agent."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-document-studio

English | [中文](README.zh.md)

## Summary

Document-delivery studio for the [document agent preset](../../preset/agent-presets/presets/document/preset.yml): a `conversation.view` tab (`document`, label 交付物) that lists the session's produced files, previews HTML/text through the host, and offers open / show-in-folder / print actions. It also auto-switches a session to the studio when the session's agent preset is the document agent.

No runtime invariant companion is published; this is a pure-consumer plugin that emits no cordis events and owns no mutable cross-plugin state — its view-slot registration and auto-switch subscriber are plain effects whose disposal the slot ledger's own specs and this package's behavior specs observe directly.


## Table of Contents

- [What it mounts](#what-it-mounts)
- [Prerequisites](#prerequisites)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## What it mounts

- **The studio view** — one entry in the `conversation.view` ring (id `document`, order 20). The tab appears for every session once the plugin is loaded; selecting it shows the studio in the center column.
- **The produced-file vocabulary** — a turn-scoped `ConversationNodeDefinition` (`documentDeliverables`) folding successful mutation `locations` (diff cards and generic edit cards) **and** `document_deliver` registration calls into turn data, plus a session-scoped view target (`documentDeliverables`) folding every turn in the window into one first-seen ordered list. A registration call augments a mutation-derived entry in place with its announced format and P0/P1 gate state — so shell/officecli-produced outputs (`.docx`, `.pptx`) appear in the studio once the agent registers them, and old sessions degrade to the mutation-derived list with a "no gate record" badge. The derivation is the same vocabulary `ui-deliverables` uses; this package owns its own key so the studio works whether or not `ui-deliverables` is composed in.
- **The preview** — selecting a file reads its text through the host `host.readFileText` RPC (default 1 MiB read budget, host ceiling 4 MiB; oversized files show the head plus a truncation note). HTML renders in a sandboxed iframe (`sandbox=""`, no scripts); Markdown/JSON/YAML/CSV/LOG renders as text.
- **The actions** — open with the OS default application, show in folder (opens the containing folder in the OS file manager, only when the host reports native open capability over a loopback authority; the host has no reveal-in-folder intent, so opening the folder itself is the handoff), and print / export PDF (re-reads the file at the 4 MiB ceiling when the preview head is truncated, then prints through the desktop bridge or the browser's print dialog, where "Save as PDF" exports).
- **The auto-switch** — when the current session's preset is the document agent, the studio view is activated on session entry. The switch goes through `ctx.conversation.setActiveView`, which is the sanctioned cross-package channel (the per-session store handle is apply-local by design); the setter mounts with the session's conversation seat, so the switch retries for a bounded window.

The shipped Web patch (`packages/bundle/web-app/cordis.patch.yml`) is the only composition that loads this package. Removing its one entry removes the tab, the vocabulary, the preview, and the auto-switch together.

## Prerequisites

The document agent preset (`document` in `packages/preset/agent-presets/presets/`) is what a document session selects; the studio renders for every session regardless. The `host.readFileText` RPC ships with the host; no OpenDesign or other external process is required.

## Model Experience

None, as this package renders already logged delivery registrations without altering model requests, tool execution, or session events.

#### KV Cache effect

None. The package is client-only presentation.

## Known Limitations and Deferred Work

- **The preview is preview, not execution** — HTML renders with `sandbox=""`, so interactive artifacts (JS-driven decks, live dashboards) show their first paint but do not run. A renderer that trusts the session's own produced files is deferred.
- **PDF is silent export on desktop** — inside the desktop app (Electron), the print action goes through `window.desktop.printHtmlToPdf` (hidden-window rasterization + OS save dialog); outside the desktop shell it falls back to the browser print dialog.
- **Auto-switch fires on session entry** — a deliberate tab pick back to chat survives until the user leaves and re-enters the session.
- **Preview is text-only by extension** — binary formats (`.docx`, `.pptx`, `.pdf`) list with their format and gate badges once registered, but have no inline preview; they open in the OS default application.
- **The list follows the session log window** — a long session whose early turns fall outside the loaded window loses those entries from the list; batch export and cross-session aggregation are the deferred workbench v2.

### Dev Note

None.
