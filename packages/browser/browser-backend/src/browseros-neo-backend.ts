/**
 * BrowserOS neo backend — cross-platform candidate with the strongest download
 * and screencast bits (its MCP download_file and automatic session recording
 * are supersets of ego's). Probe is a Streamable-HTTP reachability handshake:
 * any HTTP response (not a fetch throw) means a service is listening on the
 * MCP port; HTTP 404 degrades to warn because a non-BrowserOS process likely
 * occupies the port. The listening pid/name is surfaced for manual ownership
 * confirmation (the MCP endpoint has no authentication).
 * @module @deepseek-ai/dsh-browser-backend/browseros-neo
 */

import { spawnSync } from 'node:child_process'
import type { BrowserBackend, BrowserBackendProbe } from './types.ts'

/** Default BrowserOS neo MCP endpoint. */
export const BROWSEROS_NEO_DEFAULT_URL = 'http://127.0.0.1:9010/mcp'

/** BrowserOS neo backend options (test injection). */
export type BrowserOsNeoBackendOptions = {
  /** MCP endpoint; defaults to DSH_BROWSEROS_MCP_URL, then BROWSEROS_NEO_DEFAULT_URL. */
  url?: string
  /** Fetch override (tests); defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch
  /** Port-owner probe (tests); defaults to lsof/netstat. */
  portOwner?: (port: string) => string | undefined
  /** Platform override (tests); defaults to process.platform. */
  platform?: NodeJS.Platform
}

/** Read-only ownership probe: print the pid (and command) listening on a TCP port. */
function probePortOwner(port: string, platform: NodeJS.Platform): string | undefined {
  try {
    if (platform === 'win32') {
      const out = spawnSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8', timeout: 3_000, windowsHide: true })
      const line = out.stdout.split('\n').find(l => l.includes(`:${port}`) && l.includes('LISTENING'))
      if (!line) return undefined
      const pid = line.trim().split(/\s+/).pop()
      return pid && pid !== '0' ? pid : undefined
    }
    const out = spawnSync('lsof', ['-nP', '-iTCP', `:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8', timeout: 3_000 })
    const header = out.stdout.split('\n')[0]
    const first = out.stdout.split('\n').find(l => !l.includes('COMMAND'))
    if (!header || !first) return undefined
    const cols = header.split(/\s+/)
    const pidIndex = cols.indexOf('PID')
    const nameIndex = cols.indexOf('COMMAND')
    if (pidIndex < 0) return undefined
    const parts = first.split(/\s+/)
    const pid = parts[pidIndex]
    const name = nameIndex >= 0 ? parts[nameIndex] : undefined
    return name !== undefined && name !== '' ? `${name}(${pid})` : pid
  } catch {
    return undefined
  }
}

/** An HTTP 404 on the MCP port means a foreign service, not BrowserOS neo. */
function isForeign404(status: number | undefined): boolean {
  return status === 404
}

/** Default reachability probe: GET the MCP endpoint with a 2s abort timeout. */
async function defaultProbeReachable(
  url: string,
  fetchImpl: typeof fetch | undefined,
): Promise<{ reachable: boolean; httpStatus?: number }> {
  try {
    const fetchFn = fetchImpl ?? fetch
    const res = await fetchFn(url, { signal: AbortSignal.timeout(2_000) })
    return { reachable: true, httpStatus: res.status }
  } catch {
    return { reachable: false }
  }
}

/**
 * BrowserOS neo backend probing the MCP endpoint reachability and port owner.
 * @param options - endpoint/ownership overrides and test injections.
 * @returns a backend whose probe reports ok when the MCP port responds
 * (non-404), warn on HTTP 404 (likely a foreign service), missing when
 * unreachable.
 */
export function createBrowserOsNeoBackend(options: BrowserOsNeoBackendOptions = {}): BrowserBackend {
  const platform = options.platform ?? process.platform
  const ownerOf = options.portOwner ?? ((port: string) => probePortOwner(port, platform))
  return {
    id: 'browseros-neo',
    label: 'BrowserOS neo',
    capabilities: {
      downloadInterception: true,
      screencast: true,
      handoff: false,
      siteTools: false,
      loginState: true,
      antiBot: true,
    },
    async probe(): Promise<BrowserBackendProbe> {
      const url = options.url ?? process.env.DSH_BROWSEROS_MCP_URL ?? BROWSEROS_NEO_DEFAULT_URL
      const { reachable, httpStatus } = await defaultProbeReachable(url, options.fetchImpl)
      if (!reachable) {
        return {
          status: 'missing',
          detail: `${url} — not reachable (install & launch BrowserOS neo, then copy the MCP URL from its new-tab sidebar)`,
          installHint: 'https://browseros.com/agents',
        }
      }
      const owner = ownerOf(new URL(url).port || '80')
      if (isForeign404(httpStatus)) {
        return {
          status: 'warn',
          detail: `${url} — responded HTTP 404 (a service is listening on this port, but it is likely not BrowserOS neo)`,
          installHint: 'https://browseros.com/agents',
        }
      }
      return {
        status: 'ok',
        detail: `${url} — responded HTTP ${httpStatus ?? '?'}${owner !== undefined ? ` · listening ${owner}` : ''}`,
      }
    },
  }
}
