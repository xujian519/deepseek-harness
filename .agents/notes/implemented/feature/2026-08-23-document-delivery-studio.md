# Agent Note: Document delivery studio

Status: implemented

English | [中文](2026-08-23-document-delivery-studio.zh.md)

## Problem

The document-agent workline (P1 landed the `document` agent preset) needs its
delivery surface: when a session runs the document agent, the center column
should show a dedicated deliverable studio — the session's produced files,
HTML/text preview, open / show-in-folder / print actions — instead of plain
chat. The frontend is the existing desktop app hosting the Web UI.

## Decision

**The studio is a conversation view, switched through the controller.** The
`'conversation.view'` ring (id `document`, order 20) is the platform's
additive view surface, so the studio is one more tab and the existing tab
ring provides the manual switch. Programmatic auto-switch had no sanctioned
cross-package channel — the per-session chat store handle is apply-local by
design, and peer views are content-only. The gap was closed with a minimal
service extension: `ctx.conversation.setActiveView(sessionId, view)`. The
conversation-session seat registers its store-backed setter on the
controller; the method returns whether a setter is mounted yet so a caller
can retry across the session-seat race. This is the only channel that does
not export a store handle (slot composition standard:
[2026-07-22-slot-type-chain-implementation](../architecture/2026-07-22-slot-type-chain-implementation.md)).

**The studio owns its produced-file vocabulary.** `ui-deliverables` publishes
per-turn produced files under its own `deliverables` turn-data key via a
private module augmentation — not reachable cross-package without exporting
it, which client export discipline forbids. The studio therefore owns a
parallel turn-scoped definition (`documentDeliverables`) with the same
`locations` vocabulary and a session-scoped view target folding every turn in
the window into one first-seen ordered list. The studio works whether or not
`ui-deliverables` is composed in.

**Preview bytes come from a new bounded host RPC.** The browser cannot read
workspace files; `host.readFileText` joins `HostApi` as a capped UTF-8 read
(caller budget, absolute 4 MiB ceiling, strict decode,
`file-unreadable`/`cancelled` errors) mirroring the `openPath` trust model.
The client `api.host.readFileText` flows from the RpcMethodMap automatically.

## Alternatives considered

- **A center-column takeover outside the view ring** — replacing the `conversation` slot would collide with the resident shell and duplicate the draft-mirror and view-ring duties the seat owns; rejected as fighting the slot system.
- **Exporting the chat store handle for peer access** — the store contract forbids module-level handles (a disguised singleton across plugin reloads); rejected in favor of the controller channel.
- **Reading `ui-deliverables` turn data cross-package** — its private augmentation is unreachable without exporting the type; rejected in favor of the parallel vocabulary.

## Consequences

- PDF export: inside the desktop app the print action goes through the
  `window.desktop.printHtmlToPdf` bridge (hidden-window rasterization + OS
  save dialog); outside the desktop shell it falls back to the browser print
  dialog ("Save as PDF"). Print re-reads the file at the host's 4 MiB ceiling
  when the preview head is truncated, and blocks with an explanation when the
  file still does not fit.
- HTML preview is sandboxed (`sandbox=""`, no scripts): preview, not
  execution; interactive artifacts show only their first paint.
- The studio's auto-switch fires on session entry only; a deliberate tab pick
  back to chat survives until the user leaves and re-enters the session.
- Coverage: `packages/client/ui-document-studio/src/*` joins the client-lane
  coverage exemption (the jsdom lane cannot map the eval'd bundle artifact
  back to src), matching ui-trajectory; the package ships jsdom and
  real-registry specs instead.
