---
description: "Cross-session todo board for the Web GUI: a conversation view tab that aggregates every workspace session's latest todo list into three status columns; for users and maintainers of the board experience."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-todo-board

English | [中文](README.zh.md)

## Summary

This package renders the cross-session todo board in the Web GUI: a `Board` tab in the conversation view ring next to Chat and Trajectory. It folds each workspace session's latest whole todo list (the `todosLatest` session projection written by `todo/write` events) into three status columns — Pending, In Progress, Completed — so the work across all sessions of the current workspace is visible in one place. Each card carries a session badge; activating it opens the owning session in the conversation. An empty board renders a dashed ghost preview of the three columns so a first-time reader sees the shape real todos will land in.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin alongside `ui-conversation`; the tab then appears in the view ring of every open session. The board scopes itself to the workspace owning the current session — the same membership the sidebar's browser groups render. When the current session belongs to no workspace, the board shows the sessions outside every workspace instead. Cards update live: the `todosLatest` value rides the session list's projection column and its control-frame updates, so writes from any scoped session — including sessions running in the background — land on the board without a reload.

### Columns and cards

Each column header shows the localized label and its card count. A card shows the todo's content line verbatim, its model-authored tag chips when the todo carries any, and a session badge (the session's display title) whose accessible name includes the content; activating the badge opens that session. A column with no cards shows a dash.

### Tag filter

When any visible card carries tags, a filter bar sits above the columns: an `All` option plus one chip per distinct tag (alphabetical). Activating a chip keeps only the cards carrying that tag, per column; `All` or a second click on the active chip clears the filter, and a filter whose tag has vanished from every card (the owning list was rewritten) shows the unfiltered board until the selection changes. Tags are model-authored data on the todo item (see `dsh-tool-todo`) — the board renders and filters by them but owns none.

### The empty state

Until one scoped session writes todos, the board renders a title, a one-sentence hint, and a ghost preview: the three column headers with one dashed placeholder card each, marked with a `preview` chip. The ghost carries no navigation and no real data.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The view is a pure projection over framework-standard hooks: `useSessions` supplies the list rows (including each row's `projectionValues.todosLatest`) and `useWorkspaces` supplies the workspace membership; `board-model.ts` folds both into the three columns as a pure function in a `useMemo`. The plugin owns no store, no subscription machinery, and no event listener — the session list's existing projection plumbing (list rows plus `projection` control frames) is the only data channel. The tab registers into the `conversation.view` slot through `ctx.slots.inject`, so its removal follows the declaring package; the inject face carries only `openSession`, which delegates to the session controller's `open`. The `todosLatest` projection itself (whole-log last-write-wins, never cleared) is owned and registered by `tool-todo` beside the current-turn `todos` unit.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the board is not enough. They move from the browser tab to the todo domain and the slots it fills.

- [dsh-tool-todo](../../todo/tool-todo/README.md) — the `todo_write` tool and the `todos` / `todosLatest` projection units the board reads.
- [ui-conversation](../ui-conversation/README.md) — declares the `conversation.view` slot ring and owns the view tabs.
- [Client package map](../README.md) — adjacent browser UI packages.

-----

<a id="model-experience"></a>
## Model Experience

None, as the board is a read-only view over an existing session projection; it registers no tool, prompt section, or session event.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the current board surface. They are current package constraints, not a todo-domain comparison or a task backlog.

- **Workspace scope, not global** — the board shows the current session's workspace (or stray sessions). Todos from other workspaces are invisible here by design.
- **Card-level interaction only** — a card offers navigation to its session; editing or moving a todo stays with the model's `todo_write` whole-list replacement, and the board renders whatever the latest write carries.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The plugin owns no store (data arrives on the session list's projection column), emits no cordis events, and holds no cross-plugin mutable state; the `conversation.view` registration and its dictionaries unload with the plugin's fiber (HMR-safety test in `tests/apply.client.spec.ts`).
