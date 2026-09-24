/**
 * Plugin configuration: schema, live values, and endpoint validation.
 * @module @deepseek-ai/dsh-openviking/config
 */

import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

/** Configuration for the indexed-resources prompt contribution. */
export interface RepoContextConfig {
  /** Inject the indexed-repository list into the prompt. */
  enabled: boolean
  /** TTL of the in-process repository cache in milliseconds. */
  cacheTtlMs: number
}

/** Configuration for automatic recall before model steps. */
export interface AutoRecallConfig {
  /** Auto-inject relevant memories before each model step. */
  enabled: boolean
  /** Maximum memories injected per step. */
  limit: number
  /** Minimum score for filler memories (0-1). */
  scoreThreshold: number
  /** Per-memory content character cap. */
  maxContentChars: number
  /** Approximate token budget; the injected block is capped at `tokenBudget * 4` chars. */
  tokenBudget: number
  /** Also search the agent space (`viking://agent/`) for cases/patterns/tools/skills memories and skill playbooks. */
  agentSpaces: boolean
  /** Re-search mid-message every N tool steps and inject only new memories (0 disables). */
  refreshSteps: number
  /** Memory map: inject on session start, refresh every N user turns (2+); 1 = start only, 0 = never. */
  startupMapEveryTurns: number
  /** Retrieval limit per search against the service. */
  searchLimit: number
  /** Maximum procedure-bearing branches searched per step. */
  branchLimit: number
  /** Per-branch search deadline in milliseconds. */
  branchDeadlineMs: number
  /** TTL of the procedure-branch discovery cache in milliseconds. */
  branchCacheTtlMs: number
}

/** Configuration for session auto-commit. */
export interface AutoCommitConfig {
  /** Periodically commit sessions with uncommitted messages. */
  enabled: boolean
  /** Commit after this many uncommitted user turns; 0 disables the turn trigger. */
  turns: number
  /** Wall-clock fallback for previously committed sessions. */
  intervalMinutes: number
}

/**
 * Plugin configuration resolved by the Loader. Every field is a stable
 * reference, so a settings save reaches running consumers without a remount;
 * read one with `.get()` at the point of use.
 */
export interface Config {
  /** OpenViking HTTP service base URL. */
  endpoint: Volatile<string>
  /** `X-API-Key` value; empty omits the header. */
  apiKey: Volatile<string>
  /** `X-OpenViking-Account` value; empty omits the header. */
  account: Volatile<string>
  /** `X-OpenViking-User` value; empty omits the header. */
  user: Volatile<string>
  /** `X-OpenViking-Agent` value; empty omits the header. */
  agentId: Volatile<string>
  /** Per-request timeout in milliseconds (1000-300000). */
  timeoutMs: Volatile<number>
  /** Session-sync state file; `~` is expanded. */
  stateFile: Volatile<string>
  /** Indexed-repositories prompt contribution (enable + cache TTL). */
  repoContext: Volatile<RepoContextConfig>
  /** Automatic pre-step recall (enable, scoring, and budget limits). */
  autoRecall: Volatile<AutoRecallConfig>
  /** Session auto-commit (enable, turn cadence, and wall-clock fallback). */
  autoCommit: Volatile<AutoCommitConfig>
}

const repoContextShape = z.object({
  enabled: z.boolean().default(true),
  cacheTtlMs: z.number().min(1000).max(3600000).default(60000),
})

const autoRecallShape = z.object({
  enabled: z.boolean().default(true),
  limit: z.natural().min(1).max(50).default(6),
  scoreThreshold: z.number().min(0).max(1).default(0.15),
  maxContentChars: z.natural().min(100).max(5000).default(500),
  tokenBudget: z.natural().min(100).max(10000).default(2000),
  agentSpaces: z.boolean().default(true),
  refreshSteps: z.natural().min(0).max(100).default(10),
  startupMapEveryTurns: z.natural().min(0).max(100).default(5),
  searchLimit: z.natural().min(1).max(100).default(20),
  branchLimit: z.natural().min(1).max(100).default(16),
  branchDeadlineMs: z.natural().min(1).default(3000),
  branchCacheTtlMs: z.number().min(1000).max(3600000).default(300000),
})

const autoCommitShape = z.object({
  enabled: z.boolean().default(true),
  turns: z.natural().min(0).max(100).default(3),
  intervalMinutes: z.natural().min(1).default(10),
})

export const Config = z.object({
  endpoint: z.string().pattern(/^https?:\/\/\S+$/u).default('http://localhost:1933').volatile(),
  apiKey: z.string().default('').volatile(),
  account: z.string().default('').volatile(),
  user: z.string().default('').volatile(),
  agentId: z.string().default('deepseek-harness').volatile(),
  timeoutMs: z.number().min(1000).max(300000).default(30000).volatile(),
  stateFile: z.string().default('~/.dsh/openviking/state.json').volatile(),
  repoContext: repoContextShape.default({}).volatile(),
  autoRecall: autoRecallShape.default({}).volatile(),
  autoCommit: autoCommitShape.default({}).volatile(),
})

/**
 * Reject an invalid endpoint at load time: a non-empty absolute http(s) URL.
 * The schema pattern refuses the same mistake at a settings write; this check
 * also covers the URL parse a pattern cannot express.
 * @param endpoint - the configured service base URL.
 * @throws when the endpoint is not an absolute http(s) URL.
 */
export function assertValidEndpoint(endpoint: string): void {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    throw new Error(`openviking: invalid endpoint "${endpoint}": must be a non-empty absolute http(s) URL`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`openviking: invalid endpoint "${endpoint}": must be an absolute http(s) URL`)
  }
}
