/** Chat-owned per-Session view state. */

/** Tool call identity as carried by Chat nodes, owned by the host LLM vocabulary. */
export type { ToolCallId } from '@deepseek-ai/dsh-llm'

/** One manually expanded Turn answer generation. */
export interface TurnProcessViewEntry {
  readonly turn: number
  readonly answerStep: number
}

/** Per-Session state shared only by the Chat view and details surface. */
export interface ChatStoreState {
  turnProcesses: TurnProcessViewEntry[]
}
