# Agent Note: Bound the retained Synapse canvas and its persistence write

Status: implemented

English | [中文](2026-10-10-synapse-canvas-retention-window.zh.md)

## Problem

The desktop Host is one long-lived Node process carrying every plugin, and the Synapse canvas store had no bound on what it kept. `WorkspaceStore` retained every card a session had ever produced, every folded tool call's full `arguments`, and every tool result's full text — and `save()` serialized all of it with a single `JSON.stringify` on every debounced write.

A real installation reached 470 MB of `workspaces.json` after two months of patent work: 854 projection threads, 74,761 cards, and 87,616 tool-process entries holding 213 MB of arguments and results (`packages/web/synapse`). Loading that file costs 1.2 GB of heap, and writing it holds the state, a 334-million-character JSON string, and that string's 493 MB UTF-8 buffer at once. Two desktop sessions died with `FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed - JavaScript heap out of memory`, both while the process was inside that write path; the crash report's Python child (`BrokenPipeError` on the stdio MCP server) is the downstream symptom of the Host dying mid-turn, not its cause.

Two amplifiers compounded it. The map document polls `/synapse/api/workspaces` every second and re-opened the whole canvas whenever any summary moved, so a running session pulled all 37 workspace projections (320 MB of JSON, each one `structuredClone`d and re-stringified in the Host) per second; and the persisted-session baseline in `apply()` ran unguarded on every browser sync, re-reading and re-projecting the log of the very session the live event stream was already projecting.

## Decision

The canvas is retained state, not an archive, and every part of the pipeline now says so.

**Retention window** (`packages/web/synapse/src/projection.ts`, applied by `store.ts` at the end of every projection pass and once to a file loaded from disk):

- `MAX_THREAD_MESSAGES = 200` cards per projected thread; older cards drop off.
- `MAX_THREAD_PROCESS_MESSAGES = 20` newest cards keep their folded tool process; older cards keep their text and lose the fold.
- `MAX_PROCESS_FIELD_LENGTH = 1,000` characters for each surviving `arguments`/`result`, marked with the existing `（详情查看全文）` suffix that points at the detail view.
- Manual boards are never trimmed: their notes are user-authored, while a projected card is derived from a session log that `GET /synapse/api/sessions/<id>/history` still serves in full.

`retainCanvasCards` is idempotent under replay because `projectEventInto` drops any event below `canvasFloorSeq` — the `seq` of the oldest retained card. Without that floor a replay re-adds the dropped prefix and walks the window forward on every pass. Because both the live projection and the load-time pass call the same function, a canvas written before the window existed comes back inside it on the next start.

**Chunked persistence.** `writeState` opens the temporary file and writes `{"version":…,"hiddenSessionIds":…,"workspaces":[`, then one `JSON.stringify(workspace)` per workspace, then `]}`. The bytes are identical to one `JSON.stringify(state)`, but the largest transient is one workspace instead of the whole document plus its UTF-8 buffer.

**Baseline bounds.** `replayPersistedBaseline` coalesces overlapping runs into one, and skips any session the live `ctx.sessions.list()` still holds — that session's turn belongs to the `session/created`/`session/event` stream, and its log is the one that keeps growing while the browser syncs.

**Bounded fetches in the map.** `threadsForDshWorkspace` keeps a session→thread cache keyed by each workspace summary's `updatedAt|threadCount`: a summary whose revision is unchanged is not fetched again, and `openDshWorkspace` reloads only the histories whose thread revision moved. The five-way batch bound stays.

Against the same real fixture the canvas drops from 470 MB to 127 MB (59,906 cards, 14,160 process entries), the steady-state heap after load from 1,214 MB to 180 MB, and a save no longer allocates the document.

## Alternatives considered

**Raise the Host heap limit (`--max-old-space-size`).** Delays the crash instead of removing it, and hides the real defect: a derived view that grows without bound and is re-serialized whole.

**Cap only the tool payload, keep every card.** Measured on the real fixture, capping `arguments`/`result` at 2,000 characters with all 74,761 cards retained still leaves 151 MB, and the card count — not the per-entry size — is what grows here (87,616 entries have a median of ~400 characters, so no cap reaches them). The window is the lever that works.

**Truncate only on the first load, keep the window out of the live path.** A canvas re-grows to the same size within weeks, and the two paths would then disagree about what the canvas contains.

**Trim manual boards too.** Their notes are user-authored; nothing can rebuild them, unlike projected cards.

**A streaming JSON parser for the load.** The one-time legacy load still peaks at ~1.5 GB parsing the oversized file, but the parse is a single allocation with the rest of the Host still composing, and every later start reads the compacted 127 MB. A streaming parser is a large dependency for a one-time migration.

**Keep the store's `JSON.stringify` and rely on the smaller state.** The document is the whole canvas, and this install already proved that the string plus its buffer is what breaks the process. Chunking is fifteen lines and removes that allocation permanently.

**Serve a batch endpoint instead of the per-id workspace fetch.** Changes the host API for a view-local problem, and [the fetch-bounding note](2026-08-27-bounding-synapse-workspace-fetch.md) already rejected it; the revision cache solves it without touching the wire contract.

## Consequences

The durable canvas is now proportional to recent work per session rather than to everything every session ever produced. The visible loss is the canvas card deck: a thread longer than 200 cards shows its newest 200, and the tool fold survives only on the newest 20. The detail view, which reads the session log directly and pages 200 messages at a time, is unaffected and remains the full record.

The first start after this change still pays the legacy parse (1.5 GB peak on the measured fixture) and rewrites the compacted file; later starts read 127 MB. Bounding the *total* canvas — the number of sessions, not the size of each — remains unbounded: 854 threads at 200 cards each is the next ceiling if usage keeps growing, and evicting whole sessions is a product decision this change does not make.

The map now holds each fetched workspace projection in the renderer instead of re-fetching it: one workspace's cards at steady state, with the other fetched workspaces retained until the store stops listing them.
