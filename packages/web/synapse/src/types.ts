/**
 * Canvas data shapes persisted by the Synapse host half. The canvas is
 * derived, reconstructable UI state: the DSH SessionStore remains the source
 * of session truth, and this file carries no runtime code.
 * @module @deepseek-ai/dsh-host-synapse
 */

/** One canvas card anchor. */
export interface Position {
  x: number
  y: number
}

/** One folded tool invocation inside an assistant card's process list. */
export interface ToolProcessEntry {
  /** The DSH callId pairing the tool/call with its tool/result. */
  callId: string
  name: string
  /** Raw JSON argument string exactly as the model produced it. */
  arguments: string | null
  /** Result text, or null while the call is still in flight. */
  result: string | null
  /** Serialized failure identity (name + code), or null on success. */
  error: string | null
}

/** One projected message card payload. */
export interface ProjectedMessage {
  id: string
  text: string
  kind: 'user' | 'assistant' | 'todo' | 'error'
  /** DSH event seq this message was projected from; absent for manual notes. */
  sourceSeq?: number
  at: string
  /** Turn/step of the owning assistant step; present only for assistant cards. */
  turn?: number
  step?: number
  /** Folded tool process for assistant cards. */
  process?: ToolProcessEntry[]
}

/** One canvas node: a manual note or a projected DSH session. */
export interface Thread {
  id: string
  title: string
  /** Canvas parent node id; the graph of fork lineage, never DSH ids. */
  parentId: string | null
  /** DSH id of the session this node's first card was forked from. */
  sourceParentSessionId: string | null
  /** Durable fork cut (header.seedLength) captured at projection time. */
  sourceSeedLength: number | null
  /** The DSH session this node projects; null for a manual note. */
  dshSessionId: string | null
  dshSessionTitle: string | null
  color: string
  position: Position
  createdAt: string
  updatedAt: string
  messages: ProjectedMessage[]
}

/** One canvas workspace: a manual board or the projection of one DSH cwd. */
export interface Workspace {
  id: string
  kind: 'manual' | 'dsh'
  cwd: string | null
  title: string
  createdAt: string
  updatedAt: string
  threads: Thread[]
}

/** Durable Synapse state (schema v4; older versions migrate on load). */
export interface WorkspaceState {
  version: 4
  /** DSH session ids the user archived on the canvas; never re-projected. */
  hiddenSessionIds: string[]
  workspaces: Workspace[]
}

/** Summary row `GET /synapse/api/workspaces` returns for the sidebar. */
export interface WorkspaceSummary {
  id: string
  kind: 'manual' | 'dsh'
  cwd: string | null
  title: string
  createdAt: string
  updatedAt: string
  threadCount: number
}
