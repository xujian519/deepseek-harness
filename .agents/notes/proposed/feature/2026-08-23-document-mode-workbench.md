# Agent Note: Document mode workbench

Status: proposed

English | [中文](2026-08-23-document-mode-workbench.zh.md)

## Problem

The [document delivery studio](../../implemented/feature/2026-08-23-document-delivery-studio.md) gives a document-agent session a deliverables tab: produced files (mutation-derived plus `document_deliver` registrations, with format and gate badges), HTML/text preview, open / show-in-folder / print. The [structured deliverable registration](../../implemented/feature/2026-08-23-document-deliver-registration.md) closed the prose-only gate gap: gate state is logged data, and the studio renders P0/P1 counts. Four gaps remain for a document delivery workline:

- **The workbench-level gate view is missing.** Gate state renders as badges in the studio, but nothing shows which P0/P1 items passed per deliverable, and no application-level view composes gate state, pipeline progress, and the deliverable list.
- **The pipeline is invisible.** brief → outline → template → artifact → gate → delivery is a black box until the final file appears.
- **Deliverables are per-session islands.** No cross-session history, search, or archive.
- **Preview stops at text and inert HTML.** `.docx`/`.pptx`/`.pdf` have no inline preview, and JS-driven artifacts (decks, dashboards) render only their first paint under `sandbox=""`.

The document preset serves both pre-delivery verification (gate before delivery) and post-delivery consumption (view/export), but today both happen outside the GUI.

## Proposal

**An application-level document workbench, shown when the current session's preset is the document agent, independent of the conversation deliverables tab.** It composes gate state, pipeline progress, and the deliverable list into one screen; the existing studio tab stays untouched.

### Data paths

Three sources, in order of authority:

1. **Existing derived vocabulary (all history).** The studio's `documentDeliverables` fold (locations → turn data → session view target) is reused; the workbench reads the same session-scope target, so every past session renders a deliverable list. Since the registration tool shipped, entries carry the announced format and gate state; sessions without a registration degrade to the mutation-derived list with the visible badge.
2. **A structured deliverable-registration tool (shipped).** The host tool `document_deliver` (`@deepseek-ai/dsh-document-deliver`, mounted by the document preset) records `{files, gate: {p0[], p1[]}, briefRef}` after the quality gate passes; tool calls are session-logged, so the client folds them with the same conversation-node machinery and "model-visible ⟺ logged" holds by construction — no new session event type, no `SessionEventMap` change. The workbench consumes this data; no further registration work is needed for the workbench itself. See the [implemented note](../../implemented/feature/2026-08-23-document-deliver-registration.md).
3. **A host aggregation query (v2).** Cross-session history, search, and batch export need a host-side query over the session projection; deferred to v2.

### Application-level view slot

The GUI has one view ring, the session-scoped `'conversation.view'`; `workspace.*` RPC is a data interface, not a UI slot. The workbench needs a new application-level slot (provisional `app.view`, workspace scope) plus a navigation entry, designed under the [slot system standard](../../implemented/architecture/2026-07-22-slot-type-chain-implementation.md). The slot row and its owner entry are a cross-package SlotMap change and are reviewed before implementation.

### Agent-mediated revision

The workbench composes a structured revision request (which file, what to change, target format, constraints); the user confirms; the request is injected as a session prompt through the existing `Session.prompt` channel (composer-equivalent acceptance semantics, logged and replayable). The document agent re-runs its delivery skills on the instruction. No host write RPC is added; the session log remains the only write path.

### Executable preview with a trust boundary

HTML artifacts render in a sandboxed iframe with `sandbox="allow-scripts"` — no `allow-same-origin` (opaque origin: no parent DOM or storage), no `allow-popups`, no `allow-forms`. Execution is allowed only for files the session log records as produced (the produced-file list is the allowlist). Network requests stay allowed by default because decks and dashboards fetch data; this is the one open security decision (see Risks). This is the GUI's first executing artifact surface.

### Layered preview

- PDF: native browser render, zero dependency.
- HTML: sandboxed execution above.
- `.docx`/`.pptx` (v1): a host-side officecli conversion pipeline renders an HTML snapshot; when officecli is unavailable the workbench degrades to open-in-app.
- Text: existing `readFileText` budgets (1 MiB caller, 4 MiB absolute).

### Scope

- MVP: workbench skeleton, rich deliverable list, PDF/HTML-JS preview, agent-mediated revision.
- v1: officecli previews, gate item visualization, pipeline timeline.
- v2: host aggregation query, search, batch export, archive.
- Out of scope: host direct file write, a panel layout customization engine, and the same workbench for non-document presets.

## Alternatives considered

- **Extending the studio tab in place** — the workbench is application-level and session-spanning while the studio is a per-session tab; one entry cannot serve both scopes.
- **Host direct file write from the panel** — no host write RPC exists today; adding one crosses the sandbox and approval surface and strains the replayable-session rule; agent-mediated revision reaches the same outcome through the logged prompt channel.
- **Parsing the model's gate report as JSON in the client** — fragile, no schema enforcement; rejected — the registration tool (now shipped) keeps the tool-call → log → client-derive pattern the studio already uses.
- **Free execution or `sandbox=""` only** — `sandbox=""` cannot render JS-driven artifacts; free execution has no trust boundary; the opaque-origin `allow-scripts` sandbox with a produced-file allowlist is the middle ground.
- **A full mini-app platform** — deferred by the [inline rendered conversation nodes proposal](2026-08-20-inline-rendered-conversation-nodes.md); out of scope here.

## Acceptance criteria

- With the document preset active, an application-level workbench entry appears; the studio tab still works.
- Produced files list with format, source session, and gate status; gate items render from the registration tool's logged call (the studio already shows the counts and degrade badge; the workbench renders the items per deliverable).
- PDF previews inline; HTML artifacts execute only in the opaque-origin sandbox and only when session-produced.
- Revision confirm injects a session prompt; the agent answers with a revised file.
- A keyless snapshot covers the visible GUI change; `test:gui` and the repo gates pass. The workbench package joins the client-lane coverage exemption with jsdom and real-registry specs, matching the studio.

## Risks

- **Executable preview is a new security surface** — the GUI's first executing artifact. A produced file containing script runs in an opaque-origin sandbox with no popups or forms, so it cannot read the app or the host, but it can make network requests. Allowing network is the default; blocking it (injected CSP `connect-src 'none'`) trades deck/dashboard functionality for a stricter surface and needs a product decision.
- **The registration tool depends on model discipline** — a missed call degrades the session to the locations-derived list; the degrade is visible, not silent (this risk is now realized in production and the degrade badge ships with it).
- **A new application-level slot is a cross-package SlotMap change** — contract review cost; if the review rejects the slot row, the workbench falls back to a full-screen studio tab in the existing ring.
- **officecli conversion is user-level dependent** — previews degrade to open-in-app when unavailable.
- **Vocabulary duplication** — the workbench must reuse the studio's fold, not fork it, or the two views drift.
