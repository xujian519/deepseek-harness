# Agent Note: Document deliverable registration

Status: implemented

English | [中文](2026-08-23-document-deliver-registration.zh.md)

## Problem

The [document delivery studio](2026-08-23-document-delivery-studio.md) derived its produced-file list only from the mutation tools' render-intent `locations` (diff cards, generic edit cards). The document workline's binary outputs — `.docx` and `.pptx` produced through the user-level `officecli` skill via shell (`terminal` cards carry no `locations`), and PDFs saved by the print action — never appeared in the studio. The quality gate (`document-quality-gate`) was prose-only: its P0/P1 result lived in message text, so nothing could render gate state per deliverable.

## Decision

**One model-facing registration tool, `document_deliver` (`@deepseek-ai/dsh-document-deliver`, mounted by the document preset), makes the declaration the data source.** After the gate passes, the model calls `document_deliver` with `files` (`path` + `format` from `markdown | html | pdf | docx | pptx | other`), `gate` (`p0` verified checklist items, optional `p1`), and an optional `brief_ref`. The tool resolves every path against the calling session's workspace and fails loud when a file is missing — a ghost file is not a deliverable — and otherwise confirms the registration with the P0/P1 counts. The call is session-logged like every tool call, so model-visible ⟺ logged holds by construction: no new session event type, no `SessionEventMap` change, no host write RPC; the session log remains the only write path. The `document-quality-gate` skill's final step calls the tool after P0 passes.

**The studio folds the call from the log.** The `documentDeliverables` node definition parses the `document_deliver` `tool/call` arguments (lossless JSON in the logged event), and on a successful `tool/result` emits entries carrying `format`, `gate`, and `briefRef`. The session fold keeps first-seen order but upgrades a mutation-derived entry in place when a later registration covers the same path, so a file first seen via `write` shows its announced format and gate state once registered. Entries without a registration show the visible "no gate record" degrade badge instead of reporting gate success by default; sessions recorded before the tool existed degrade to the mutation-derived list.

## Alternatives considered

- **Extending the render-intent union with a `deliver` kind** — would make shell-produced files listable through the existing fold, but the closed union needs bridge changes and carries no gate payload or format; the logged-arguments route covers list and metadata with zero transport change.
- **A dedicated session event for registration** — a new `SessionEventMap` member plus `SESSION_FORMAT_VERSION` mechanics; the tool-call log already carries everything, and the repo rule only requires model-visible ⟺ logged, not a new event.
- **Client-side parsing of the gate prose** — no schema enforcement, replay-fragile; rejected in favor of the schema-validated call.
- **Verifying the checklist honestly executed** — the tool enforces non-empty P0 and file existence, not that the model actually ran the checklist; making the gate machine-verified is out of scope and remains a documented risk rather than an unenforceable claim.

## Consequences

- The studio lists binary outputs once registered (format + gate badges) and still lists mutation-derived files; old sessions show the degrade badge.
- Gate state is model-reported — the declaration is the actor, the checklist honesty remains the model's discipline.
- Registration is declaration-only: no copy, render, or conversion; PDF export stays with the print action and `.docx`/`.pptx` conversion stays with the user-level `officecli`.
- The tool mounts only with the document preset; other presets see neither the tool nor the badges (the studio tab renders for every session but lists only what its derivation sees).
