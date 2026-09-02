# Todo

English | [中文](todo.zh.md)

The durable todo vocabulary owned by [`@deepseek-ai/dsh-tool-todo`](../../packages/todo/tool-todo/README.md). The model-facing tool replaces one agent session's whole list; the package also owns the event declaration, replay projection, and invariant companion. Tool behavior and configuration are on the [package README](../../packages/todo/tool-todo/README.md).

Source: [`packages/todo/tool-todo/src/types.ts`](../../packages/todo/tool-todo/src/types.ts)

## `TodoItem` — one list entry

```ts type-equiv
/**
 * One entry in an agent's todo list — the unit of the `todo/write`
 * whole-list snapshot declared by this package.
 *
 * `content` and `status` are the required core; the list is replaced wholesale
 * on every write (last-write-wins), so entries need no stable identity. The
 * three statuses describe the complete portable lifecycle needed by model and
 * UI consumers. `tags` is optional model-authored grouping metadata (short
 * category labels); consumers must treat it as advisory — absent on every
 * pre-tags item and on any item the model chooses not to tag.
 */
interface TodoItem {
  /** What this task is — a short imperative line shown in the UI. */
  content: string
  /** Lifecycle state. `in_progress` marks a task being worked now; parallel work may mark several. */
  status: 'pending' | 'in_progress' | 'completed'
  /**
   * Optional short category labels (e.g. `docs`, `release`); trimmed,
   * non-empty, unique per item. `| undefined` mirrors the wire schema's
   * zod-optional inference.
   */
  tags?: string[] | undefined
}
```

## Durable event and invariant

The package declaration-merges `todo/write: { todos: TodoItem[] }` into `SessionEventMap`. The event is log-only and carries the complete replacement list; the generated [persistence catalog](../persistence-catalog.md#todowrite--log-only) records its declaration site. The package's invariant companion validates existing and newly announced sessions in one pass, then tracks committed turn boundaries incrementally so every live `todo/write` is checked before append without rescanning the log.
