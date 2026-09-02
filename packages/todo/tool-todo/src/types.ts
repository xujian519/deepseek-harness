/**
 * Pure types of the todo domain: the ONE home of the `todos` projection-key
 * declaration plus its payload types, free of this package's host-side value
 * imports (dsh-tools, zod). Two namespace projections serve it — `./types`
 * for host consumers, `./client/types` (the browser half-entry's re-export)
 * for client aggregates — with zero content duplication.
 *
 * @module @deepseek-ai/dsh-tool-todo/types
 */

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
export interface TodoItem {
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

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Whole-list snapshot; latest write wins on replay. Log-only UI state; never derived history. */
    'todo/write': { todos: TodoItem[] }
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    todos: TodoItem[] | null
    todosLatest: TodoItem[] | null
  }
  interface SessionProjectionMap {
    /**
     * The agent's current whole todo list (the latest `todo/write` snapshot),
     * or `null` before the first write. Whole-value rule: every `todo/write`
     * carries the complete replacement list, so the fold is last-wins.
     */
    todos: TodoItem[] | null
    /**
     * The agent's latest whole todo list across the entire log, or `null`
     * before the first write. Unlike {@link todos} this fold never clears:
     * turn boundaries keep the last written list visible, which is what a
     * cross-session board (not the current-turn dock strip) renders.
     */
    todosLatest: TodoItem[] | null
  }
}
