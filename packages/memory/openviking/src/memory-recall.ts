/**
 * Auto-recall: search OpenViking before a model step and stage a bounded
 * `<relevant-memories>` block for the context-injection channel.
 *
 * The block is staged at `agent/pre-step` (where the accepted input batch is
 * known) and rendered by the `openviking:memories` system-prompt context
 * provider at assembly time — a durable user-role snapshot, visible to
 * compaction, never mirrored back into OpenViking. Procedural queries
 * (audit, recovery, playbooks, ordered steps) get a dedicated branch lane so
 * a durable playbook is not buried under higher-scoring event memories.
 * @module @deepseek-ai/dsh-openviking/memory-recall
 */

import type { Logger } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'

import { OpenVikingClient, type SearchItem } from './client.ts'
import type { AutoRecallConfig } from './config.ts'
import { textOf } from './messages.ts'

/** Procedural-query intent signals (local classification, no model call). */
const PROCEDURE_QUERY_RE = new RegExp(
  '\\b(workflow|audit|review|recover|restore|compensat\\w*|replay|verif\\w*|remediat\\w*|diagnos\\w*|migrat\\w*|'
  + 'runbook|playbook|procedure|process|steps?|how do i|how can i|what steps)\\b|'
  + '审计|审核|恢复|补偿|重放|回放|验证|核验|修复|补救|诊断|迁移|流程|步骤|怎么做|如何处理|排查',
  'i',
)

/** Procedure-bearing branch markers in the user-memory tree. */
const PROCEDURE_PATH_RE = new RegExp(
  '(?:^|[\\/])(?:方法论|方法|流程|剧本|playbook|playbooks|method|methods|pattern|patterns|case|cases|'
  + 'runbook|runbooks|workflow|workflows|skill|skills)(?:[\\/]|$)',
  'i',
)

/** Retrieval limit per search. */
const SEARCH_LIMIT = 20
/** Maximum procedure branches searched per step. */
const PROCEDURE_BRANCH_LIMIT = 16
/** Per-branch deadline in ms. */
const PROCEDURE_BRANCH_DEADLINE_MS = 3000
/** Tree cache TTL for procedure branch discovery. */
const BRANCH_CACHE_TTL_MS = 5 * 60_000

/** Short hash for query-identity tracking (no cryptographic purpose). */
function queryHash(query: string): string {
  let hash = 0
  for (let index = 0; index < query.length; index += 1) {
    hash = (hash * 31 + query.charCodeAt(index)) >>> 0
  }
  return `${query.length}:${hash}`
}

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => { resolve(undefined) }, ms)
  })
  return Promise.race([promise, deadline]).finally(() => { clearTimeout(timer) })
}

/** Per-agent recall state. */
interface AgentRecallState {
  /** The staged block for the next assembly. */
  block: string
  /** URIs already injected for the current query (refresh-driven complement). */
  shownUris: Set<string>
  /** Hash of the query the block was built for. */
  queryHash: string
  /** Step index at which the current block was prepared. */
  preparedStep: number
  /** User turn count since mount (startup-map cadence reads it). */
  userTurns: number
}

/** Pre-step staging for one agent session. */
export class MemoryRecall {
  private readonly client: OpenVikingClient
  private readonly config: () => AutoRecallConfig
  private readonly logger: Logger
  private readonly states = new Map<string, AgentRecallState>()
  private branches: { at: number; branches: string[] } | undefined

  /**
 * @param client - OpenViking HTTP client.
 * @param config - Configuration snapshot for the operation.
 */
  constructor(client: OpenVikingClient, config: () => AutoRecallConfig, logger: Logger) {
    this.client = client
    this.config = config
    this.logger = logger
  }

  /**
   * Latest staged block for an agent; empty string contributes nothing.
   * @param agentId - The DSH session id of the recall scope.
   * @returns the staged block, or empty when nothing was staged.
   */
  renderContext(agentId: string): string {
    return this.states.get(agentId)?.block ?? ''
  }

  /**
   * User-turn count since mount for an agent (startup-map cadence).
   * @param agentId - The DSH session id of the recall scope.
   * @returns the user-turn count since mount.
   */
  userTurnCount(agentId: string): number {
    return this.states.get(agentId)?.userTurns ?? 0
  }

  /**
   * Forget one disposed agent.
   * @param agentId - The DSH session id of the recall scope.
   */
  forget(agentId: string): void {
    this.states.delete(agentId)
  }

  /**
   * Stage the recall block for the accepted input batch.
   * @param agent - the owning agent (session id is the recall scope).
   * @param step - the model step index of the accepted batch.
   * @param messages - the accepted claimed batch.
   * @param signal - cancellation for in-flight searches.
   */
  async prepareStep(agent: Agent, step: number, messages: readonly UserMessage[], signal: AbortSignal): Promise<void> {
    const config = this.config()
    const agentId = String(agent.id)
    if (!config.enabled) return
    const query = this.queryOf(messages)
    if (query === undefined) return
    const state = this.stateOf(agentId)
    const hash = queryHash(query)
    const refreshDue = config.refreshSteps > 0 && state.block !== '' && state.queryHash === hash
      && step >= state.preparedStep + config.refreshSteps
    if (state.queryHash === hash && !refreshDue) return

    const results = await this.searchSpaces(query, config, signal)
    const procedureCandidates = PROCEDURE_QUERY_RE.test(query)
      ? await this.procedureCandidates(query, config, signal)
      : []
    if (signal.aborted) return

    const isNewQuery = state.queryHash !== hash
    // shownUris scopes to the current query (refresh complement); a new
    // question must re-evaluate its own best hits, not be filtered by a
    // previous question's selection.
    if (isNewQuery) state.shownUris.clear()
    const selected = this.select(results, procedureCandidates, state.shownUris, config)
    if (selected.length === 0 && !isNewQuery) return
    if (selected.length > 0) {
      state.block = this.renderBlock(selected)
      for (const item of selected) state.shownUris.add(item.uri)
    }
    // A new query with no hits keeps the previous block (stale-but-useful
    // context beats a void); a refresh with no new hits keeps it too.
    state.queryHash = hash
    state.preparedStep = step
    if (isNewQuery) state.userTurns += 1
  }

  private stateOf(agentId: string): AgentRecallState {
    let state = this.states.get(agentId)
    if (state === undefined) {
      state = { block: '', shownUris: new Set(), queryHash: '', preparedStep: -1, userTurns: 0 }
      this.states.set(agentId, state)
    }
    return state
  }

  /** The last user-sourced message text in the accepted batch. */
  private queryOf(messages: readonly UserMessage[]): string | undefined {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (message === undefined) continue
      if (message.source.kind !== 'user') continue
      const text = textOf(message.content)
      if (text.length >= 3) return text
    }
    return undefined
  }

  /** Search user + agent spaces in parallel; failures degrade to empty. */
  private async searchSpaces(query: string, config: AutoRecallConfig, signal: AbortSignal): Promise<SearchItem[]> {
    const targets = config.agentSpaces
      ? ['viking://user/memories/', 'viking://agent/']
      : ['viking://user/memories/']
    const settled = await Promise.allSettled(targets.map(targetUri =>
      this.client.find({ query, targetUri, limit: SEARCH_LIMIT, scoreThreshold: config.scoreThreshold }, { signal })))
    const items: SearchItem[] = []
    for (const result of settled) {
      if (result.status === 'rejected') {
        this.logger.info('openviking recall search failed', { error: String(result.reason) })
        continue
      }
      items.push(...result.value.memories, ...result.value.resources, ...result.value.skills)
    }
    return items
  }

  /** One guaranteed slot for procedure-bearing branches; never fails the step. */
  private async procedureCandidates(query: string, config: AutoRecallConfig, signal: AbortSignal): Promise<SearchItem[]> {
    const branches = await this.procedureBranches(signal)
    if (branches.length === 0) return []
    const settled = await Promise.allSettled(branches.map((branch) => {
      const find = this.client.find(
        { query, targetUri: branch, limit: SEARCH_LIMIT, scoreThreshold: config.scoreThreshold },
        { signal },
      )
      return withDeadline(find, PROCEDURE_BRANCH_DEADLINE_MS)
    }))
    let best: SearchItem | undefined
    for (const result of settled) {
      if (result.status !== 'fulfilled' || result.value === undefined) continue
      const hit = result.value.memories[0] ?? result.value.resources[0] ?? result.value.skills[0]
      if (hit === undefined) continue
      if (best === undefined || hit.score > best.score) best = hit
    }
    if (best === undefined) return []
    return [best]
  }

  /** Cached procedure-bearing leaf branches (max 16, longest path first). */
  private async procedureBranches(signal: AbortSignal): Promise<string[]> {
    const now = Date.now()
    if (this.branches !== undefined && now - this.branches.at < BRANCH_CACHE_TTL_MS) return this.branches.branches
    try {
      const nodes = await this.client.tree('viking://user/memories/', { nodeLimit: 200, levelLimit: 3, signal })
      const collected = new Set<string>()
      const walk = (node: { path: string; type?: string; children?: readonly unknown[] }): void => {
        const children = node.children ?? []
        if (children.length > 0) {
          for (const child of children as Array<{ path: string; type?: string; children?: readonly unknown[] }>) walk(child)
          return
        }
        // Leaf only: a directory with no listed children is a searchable branch;
        // files are not retrieval targets. Depth-limited trees stop at leaves.
        if (node.type !== 'file' && PROCEDURE_PATH_RE.test(node.path)) collected.add(node.path)
      }
      for (const node of nodes) walk(node)
      const branches = [...collected].sort((left, right) => right.length - left.length).slice(0, PROCEDURE_BRANCH_LIMIT)
      this.branches = { at: now, branches }
      return branches
    } catch (error) {
      this.logger.info('openviking procedure branch discovery failed', { error: String(error) })
      this.branches = { at: now, branches: [] }
      return []
    }
  }

  /** Score-filter, dedupe, cap, and slot a procedure winner first. */
  private select(all: SearchItem[], procedure: SearchItem[], shown: Set<string>, config: AutoRecallConfig): SearchItem[] {
    const winner = procedure[0]
    const filler = all
      .filter(item => item.uri !== winner?.uri && !shown.has(item.uri))
      .sort((left, right) => right.score - left.score)
    const ordered = winner === undefined ? filler : [winner, ...filler]
    const seen = new Set<string>()
    const maxChars = config.tokenBudget * 4
    const result: SearchItem[] = []
    let used = 0
    for (const item of ordered) {
      if (seen.has(item.uri) || shown.has(item.uri)) continue
      if (result.length >= config.limit) break
      const snippet = item.abstract.slice(0, config.maxContentChars)
      if (used + snippet.length > maxChars) break
      seen.add(item.uri)
      result.push(item)
      used += snippet.length
    }
    return result
  }

  /** The model-visible block; stable format pinned by snapshot tests. */
  private renderBlock(items: SearchItem[]): string {
    const lines = items.map(item =>
      `- [${item.context_type}] ${item.uri} (${item.score.toFixed(2)}) — ${item.abstract}`)
    return `<relevant-memories>\n${lines.join('\n')}\n</relevant-memories>`
  }
}
