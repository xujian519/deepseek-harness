/**
 * Type declarations for the patent data seam: the nuo search-provider factory
 * options, the structured patent metadata mapping, the cache tuning options,
 * and the ego-browser session/subprocess vocabulary.
 * @module @deepseek-ai/dsh-patent-data/types
 */

import type { Citation, PatentSearchResult } from '@deepseek-ai/nuo-patent'

/** Options for the nuo search-provider factory. */
export interface CreateNuoSearchProviderOptions {
  /** Injected search function; defaults to the LRU-cached nuo `searchPatents`. */
  search?: (query: string, options?: { limit?: number }) => Promise<PatentSearchResult>
}

/** Structured patent metadata: the nuo JSON-string fields parsed into arrays. */
export interface StructuredPatentData {
  patent: string
  url: string
  title: string
  applicationNumber: string
  inventors: string[]
  assigneesOriginal: string[]
  assigneesCurrent: string[]
  pubDate: string
  filingDate: string
  priorityDate: string
  grantDate: string
  expirationDate: string
  legalStatus: string
  ifiStatus: string
  estimatedExpiration: string
  pdfUrl: string
  classifications: string[]
  backwardCites: Citation[]
  forwardCites: Citation[]
  abstractText: string
}

/** Cache tuning options for the search and scrape result caches. */
export interface PatentCacheOptions {
  /** Entry TTL in milliseconds (default 10 minutes). */
  ttlMs?: number
  /** Maximum LRU entries (default 100). */
  maxEntries?: number
}

/** One collected ego-browser run: merged/truncated output plus stream and exit facts. */
export interface EgoScriptResult {
  /** stdout+stderr merged and truncated to the session's output cap. */
  output: string
  /** Raw collected stdout. */
  stdout: string
  /** Raw collected stderr. */
  stderr: string
  exitCode: number | null
  timedOut: boolean
  durationMs: number
}

/** Ego-browser availability: ready, unavailable on this platform, or setup required. */
export type EgoAvailability = { ok: true } | { ok: false; code: 'unavailable' | 'setup_required'; reason: string }

/** Options for one ego-browser script run. */
export interface EgoRunOptions {
  cwd: string
  /** Whole-run timeout; defaults to the session's defaultTimeoutMs. */
  timeoutMs?: number
  env?: NodeJS.ProcessEnv
  signal?: AbortSignal
}

/** Options for constructing an ego-browser session. */
export interface EgoSessionOptions {
  /** CLI command name (default "ego-browser"). */
  commandName?: string
  /** Default run timeout in milliseconds (default 90_000). */
  defaultTimeoutMs?: number
  /** Hard cap for per-run timeoutMs (default 300_000). */
  maxTimeoutMs?: number
  /** Home directory used to locate `~/.local/bin` (default os.homedir()). */
  homeDir?: string
  /** Extra PATH directories (default `[<home>/.local/bin]`). */
  pathEntries?: string[]
  /** Soft cap in bytes for the merged output (default 500_000). */
  maxOutputBytes?: number
  /** Platform override (default process.platform). */
  platform?: NodeJS.Platform
  /** Environment override (default process.env). */
  env?: NodeJS.ProcessEnv
  /** Spawn runner seam (defaults to the subprocess-backed runner). */
  runner?: EgoSpawnRunner
}

/** One fully-specified ego-browser spawn request. */
export interface EgoSpawnSpec {
  /** Executable and arguments; argv[0] is the program. */
  argv: readonly string[]
  /** Script text to write to stdin (absent for argument-only invocations). */
  stdinData?: string
  cwd: string
  env?: NodeJS.ProcessEnv
  timeoutMs: number
  signal?: AbortSignal
}

/** One settled ego-browser spawn result. */
export interface EgoSpawnResult {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  durationMs: number
}

/** The spawn-capable seam the ego-session runner consumes. */
export interface EgoSpawnRunner {
  /**
   * Run one argv+stdin spawn and collect its settled result.
   * @param spec - executable, arguments, stdin, directory, environment, deadline, and cancellation.
   * @returns the settled exit, output, timeout, and duration facts.
   */
  spawn(spec: EgoSpawnSpec): Promise<EgoSpawnResult>
}
