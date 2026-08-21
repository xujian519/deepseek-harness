/**
 * Browser backend cascade routing: ordered candidate construction, cold-decision
 * resolution, and whole-set probing. Backend selection is a cold decision —
 * resolve once before a task starts; switching mid-task is forbidden.
 *
 * Default cascade order: ego lite → BrowserOS neo → browser-use →
 * @playwright/mcp. Platform fit is each backend's own probe concern (ego probes
 * missing off-darwin), so the router does not repeat platform checks.
 * @module @deepseek-ai/dsh-browser-backend
 */

import type { BrowserBackend, BrowserBackendId, BrowserBackendProbe } from './types.ts'
import { createBrowserOsNeoBackend } from './browseros-neo-backend.ts'
import { createBrowserUseBackend } from './browser-use-backend.ts'
import { createEgoBackend } from './ego-backend.ts'
import { createPlaywrightBackend } from './playwright-backend.ts'

export * from './types.ts'
export { createEgoBackend } from './ego-backend.ts'
export type { EgoBackendOptions, EgoConnectionProbe } from './ego-backend.ts'
export { createBrowserOsNeoBackend, BROWSEROS_NEO_DEFAULT_URL } from './browseros-neo-backend.ts'
export type { BrowserOsNeoBackendOptions } from './browseros-neo-backend.ts'
export { createBrowserUseBackend } from './browser-use-backend.ts'
export type { BrowserUseBackendOptions, VersionProbeResult } from './browser-use-backend.ts'
export { createPlaywrightBackend } from './playwright-backend.ts'
export type { PlaywrightBackendOptions } from './playwright-backend.ts'
export { BrowserUseExtractor } from './browser-use-extractor.ts'
export type { BrowserUseExtractorOptions, ExtractResult, ScriptRun } from './browser-use-extractor.ts'

/** Routing options shared by the candidate builders and resolvers. */
export type BackendRouteOptions = {
  /** Platform override (tests); defaults to process.platform. */
  platform?: NodeJS.Platform
  /** Run the ego connection probe after the CLI check (slower but more accurate). */
  doctorCheck?: boolean
  /** BrowserOS neo MCP endpoint (default DSH_BROWSEROS_MCP_URL, then BROWSEROS_NEO_DEFAULT_URL). */
  browserosUrl?: string
  /** User-preferred backend id (moved to the front of the candidate order). */
  prefer?: BrowserBackendId
  /** Candidates to exclude (configuration/tests). */
  exclude?: BrowserBackendId[]
  /** Explicit candidate list (tests/customization); defaults to the built-in cascade. */
  backends?: BrowserBackend[]
}

/**
 * Build the ordered candidate list (cold-decision input). `prefer` moves one
 * backend to the front — the only allowed ordering adjustment; `exclude` drops
 * candidates. A preferred-but-excluded backend is a configuration conflict and
 * warns on stderr, then ignores the prefer.
 * @param options - platform, probes, preference, and exclusion.
 * @returns the ordered candidate list.
 */
export function buildBackendCandidates(options: BackendRouteOptions = {}): BrowserBackend[] {
  const backends: BrowserBackend[] = options.backends ?? [
    createEgoBackend({
      ...(options.platform === undefined ? {} : { platform: options.platform }),
      ...(options.doctorCheck === undefined ? {} : { doctorCheck: options.doctorCheck }),
    }),
    createBrowserOsNeoBackend({
      ...(options.browserosUrl === undefined ? {} : { url: options.browserosUrl }),
      ...(options.platform === undefined ? {} : { platform: options.platform }),
    }),
    createBrowserUseBackend(),
    createPlaywrightBackend(),
  ]
  const exclude = options.exclude ?? []
  const filtered = exclude.length > 0 ? backends.filter(b => !exclude.includes(b.id)) : backends
  if (options.prefer === undefined) return filtered
  const preferred = filtered.find(b => b.id === options.prefer)
  if (preferred === undefined) {
    process.stderr.write(
      `dsh-browser-backend: preferred backend "${options.prefer}" is excluded by the exclude list — ignoring prefer.\n`,
    )
    return filtered
  }
  return [preferred, ...filtered.filter(b => b.id !== options.prefer)]
}

/**
 * Cold-decision resolution: the first candidate whose probe reports ok. Call
 * once before a task starts; never call mid-task. When every candidate is
 * unavailable, throws with install guidance.
 * @param options - the routing options.
 * @returns the first available backend.
 */
export async function resolveBrowserBackend(options: BackendRouteOptions = {}): Promise<BrowserBackend> {
  for (const backend of buildBackendCandidates(options)) {
    let probe: BrowserBackendProbe
    try {
      probe = await backend.probe()
    } catch {
      continue // a throwing probe counts as unavailable and does not block the cascade
    }
    if (probe.status === 'ok') return backend
  }
  throw new Error(
    'No browser backend available on this machine. Run `dsh --profile headless browsers` for the per-backend install guide.',
  )
}

/** One backend with its probe result (probeAllBackends output). */
export type BackendProbeResult = {
  backend: BrowserBackend
  probe: BrowserBackendProbe
}

/**
 * Probe every candidate without short-circuiting (the `browsers` diagnostic
 * command consumes this). A throwing probe degrades to a warn result so one
 * broken backend does not hide the rest.
 * @param options - the routing options.
 * @returns one result per candidate, in candidate order.
 */
export async function probeAllBackends(options: BackendRouteOptions = {}): Promise<BackendProbeResult[]> {
  const results: BackendProbeResult[] = []
  for (const backend of buildBackendCandidates(options)) {
    let probe: BrowserBackendProbe
    try {
      probe = await backend.probe()
    } catch (error) {
      probe = { status: 'warn', detail: `probe error: ${error instanceof Error ? error.message : String(error)}` }
    }
    results.push({ backend, probe })
  }
  return results
}
