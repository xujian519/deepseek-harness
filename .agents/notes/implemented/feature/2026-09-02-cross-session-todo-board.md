# Agent Note: Cross-session todo board view

Status: implemented

English | [中文](2026-09-02-cross-session-todo-board.zh.md)

## Problem

The retired desktop demo (the history-only PR #374 merge) carried a Mission Control board: a three-column kanban that aggregated every session's latest `todo/write` list, with a badge on each card that jumped to the owning session. The shipped Web GUI has no cross-session todo surface — the dock's Todo strip ([todo plan clears on the next turn](2026-07-28-todo-plan-clears-on-next-turn.md)) shows only the current session's current-turn standing plan, so a user cannot see at a glance what any other session is working on, and a finished session's last checklist disappears from the UI at the next `turn/start`.

## Decision

The board lives in the Web GUI as a `Board` tab in the conversation view ring, next to Chat and Trajectory. The tab is owned by a new client plugin package, `@deepseek-ai/dsh-client-ui-todo-board`, and renders a pure projection over data that already reaches the browser.

### The `todosLatest` projection unit

`dsh-tool-todo` registers a second projection unit beside the standing-plan `todos` unit: the same whole-list `todo/write` fold, but never cleared — whole-log last-write-wins. The board (not the dock strip) is its consumer. The standing-plan unit keeps its turn-boundary lifetime and its `stateVersion`; the new unit starts at `stateVersion` 1 with no prior persisted state. Both keys merge into `SessionProjectionMap` in `dsh-tool-todo`'s types outlet, and both reach the browser through the existing carriers: the session-list projection column and `session/projection` push frames. No wire change, no new event, and no client-side folding exists.

### Scope and navigation

The board scopes to the workspace owning the current session, matched through the workspace catalog's `sessionIds` — the same membership the sidebar's browser groups render; a current session that belongs to no workspace scopes the board to the sessions outside every workspace. Each card shows the todo content verbatim plus a badge carrying the owning session's display title; activating the badge calls the session controller's `open`. Until one scoped session has written todos, the board renders a dashed ghost preview of the three columns so a first-time reader sees the shape real data will land in.

### Model-authored tags

The board's tag filter reads `tags`, an optional field added to `TodoItem`. This consciously reverses the type's original deliberately-minimal stance: grouping across sessions needs one model-authored field, and whole-list replacement keeps tags traveling with the content they describe — no per-item identity is introduced. The tool normalizes tags (trimmed, non-empty, unique per item; absent and empty arrays collapse to no key), the durable invariant enforces the same shape on replay, and the board renders per-card tag chips and a filter bar — an All option plus one chip per distinct tag — while owning no tag state of its own. The field is optional, so pre-tags logs replay unchanged and the model may leave any item untagged.

## Alternatives considered

- **Reuse the `todos` projection for the board** — its standing-plan lifetime clears at `turn/start`, so every board would empty whenever any session starts a new turn; the two surfaces genuinely want different lifetimes.
- **A workspace-level main-area view switch** — closest to the demo's Mission Control shape, but it means layout surgery on `ui-layout`/`ui-conversation` contracts; the view ring is the established additive home for alternate activity views.
- **Client-side log backscan for todos** — re-folds session logs in the browser and duplicates the host projection seam; the projection column already delivers the whole value for every listed session.
- **User-authored tags stored client-side** — cards have no stable identity (each write replaces the list), so client-stored tags cannot follow their cards across writes without a fragile content-keyed match, and they would need a new persistence seam or live device-local in localStorage.

## Consequences

A user sees every scoped session's latest checklist in one view, including sessions that finished earlier and sessions running in the background; writes from any scoped session land without a reload. The dock Todo strip and the board read different folds of the same events, so a new turn keeps the strip's current-turn semantics while the board keeps the last checklist visible. Coverage: tool-todo projection specs (whole-log last-wins, turn-boundary survival, key absence without the tool), the connection fixture carrying `todosLatest`, the board's client specs (column projection, the tag filter and its reset when the active tag vanishes, registration, chat-landing retries, fiber-disposal lifecycle), and an assembled expected-output test pinning the rendered columns, counts, and badges over the fixture session.
