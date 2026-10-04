# Todo

[English](todo.md) | 中文

本页记录 [`@deepseek-ai/dsh-tool-todo`](../../packages/todo/tool-todo/README.zh.md) 拥有的持久 todo 词汇。面向模型的工具会整体替换一个 agent（智能体）会话的列表；该包还拥有事件声明和回放投影。工具行为与配置见[包 README](../../packages/todo/tool-todo/README.zh.md)。

源码：[`packages/todo/tool-todo/src/types.ts`](../../packages/todo/tool-todo/src/types.ts)

## `TodoItem`：一条列表项

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

## 持久事件

该包通过声明合并把 `todo/write: { todos: TodoItem[] }` 加入 `SessionEventMap`。此事件仅写入日志，并携带完整替换列表；生成的[持久化目录](../persistence-catalog.zh.md#todowrite--log-only)会记录其声明位置。
