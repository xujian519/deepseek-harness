/**
 * Plugin configuration: schema, validation, and the user-settings namespace.
 * @module @deepseek-ai/dsh-openviking/config
 */

import z from '@deepseek-ai/schemastery'
import { settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'

/** Namespace key under which this plugin's settings live in the settings seam. */
export const SETTINGS_NAMESPACE: SettingsNamespace = settingsNamespace('openviking')

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

/** Resolved plugin configuration (schema defaults applied). */
export interface Config {
  /** OpenViking HTTP service base URL. */
  endpoint: string
  /** `X-API-Key` value; empty omits the header. */
  apiKey: string
  /** `X-OpenViking-Account` value; empty omits the header. */
  account: string
  /** `X-OpenViking-User` value; empty omits the header. */
  user: string
  /** `X-OpenViking-Agent` value; empty omits the header. */
  agentId: string
  /** Per-request timeout in milliseconds (1000-300000). */
  timeoutMs: number
  /** Session-sync state file; `~` is expanded. */
  stateFile: string
  /** Repository-list recall: enabled flag and cache TTL (ms) for the `repositories` context. */
  repoContext: RepoContextConfig
  /** Auto-recall: pre-step memory injection budget, score gate, and refresh cadence. */
  autoRecall: AutoRecallConfig
  /** Auto-commit: periodic capture of session turns into the memory store. */
  autoCommit: AutoCommitConfig
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
})

const autoCommitShape = z.object({
  enabled: z.boolean().default(true),
  turns: z.natural().min(0).max(100).default(3),
  intervalMinutes: z.natural().min(1).default(10),
})

export const Config = z.object({
  endpoint: z.string().default('http://localhost:1933'),
  apiKey: z.string().default(''),
  account: z.string().default(''),
  user: z.string().default(''),
  agentId: z.string().default('deepseek-harness'),
  timeoutMs: z.number().min(1000).max(300000).default(30000),
  stateFile: z.string().default('~/.dsh/openviking/state.json'),
  repoContext: repoContextShape.default({} as RepoContextConfig),
  autoRecall: autoRecallShape.default({} as AutoRecallConfig),
  autoCommit: autoCommitShape.default({} as AutoCommitConfig),
})

/**
 * Reject an invalid endpoint at load time: a non-empty absolute http(s) URL.
 * Used both as the loader-time check and as the settings-seam validator.
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
