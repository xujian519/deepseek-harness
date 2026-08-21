/**
 * `dsh --profile headless browsers` — probe the local browser automation
 * backends and print the availability matrix. Probes are read-only and do not
 * start a browser (browser-use --version, BrowserOS neo HTTP handshake, and
 * the optional ego connection probe aside); the matrix shows which backend the
 * download tools would cold-decision on, and how to install the next tier.
 * @module @deepseek-ai/dsh-headless/browsers
 */

import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { internals } from '@deepseek-ai/dsh-cmdline'
import { probeAllBackends, type BackendProbeResult } from '@deepseek-ai/dsh-browser-backend'

/** Badge per probe verdict, aligned with the Sati `sati browsers` matrix. */
const BADGES = { ok: '[ok ]', warn: '[!  ]', missing: '[-- ]' } as const

/**
 * Render the probe matrix in the cascade order.
 * @param results - one probe result per candidate.
 * @returns the human-readable matrix.
 */
export function formatBrowserBackendMatrix(results: BackendProbeResult[]): string {
  const lines: string[] = [
    'Browser automation backends (cascade: ego lite → BrowserOS neo → browser-use → @playwright/mcp):',
    '',
  ]
  for (const { backend, probe } of results) {
    lines.push(`  ${BADGES[probe.status]} ${backend.label.padEnd(20)} ${probe.detail}`)
    if (probe.status !== 'ok' && probe.installHint !== undefined) {
      lines.push(`        install: ${probe.installHint}`)
    }
  }
  lines.push(
    '',
    'Notes:',
    '  - BrowserOS neo MCP endpoint (127.0.0.1:9010) has NO authentication — any process on this',
    '    machine can control the browser. Confirm the listening pid above belongs to BrowserOS.',
    '  - The backend for a task is chosen once before the task starts (cold decision); it never switches mid-task.',
  )
  return lines.join('\n') + '\n'
}

/**
 * Build the `browsers` subcommand: probe all backends, print the matrix, and exit.
 * @param ctx - plugin context carrying the exit request.
 * @returns the commander subcommand.
 */
export function createBrowsersCommand(ctx: Context): Command {
  return new Command('browsers')
    .description('Probe local browser automation backends (ego lite → BrowserOS neo → browser-use → @playwright/mcp).')
    .action(async () => {
      const results = await probeAllBackends()
      internals.stdout.write(formatBrowserBackendMatrix(results))
      ctx.get('appExit')?.(0)
    })
}
