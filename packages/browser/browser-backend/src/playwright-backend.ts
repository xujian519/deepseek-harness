/**
 * @playwright/mcp backend — cross-platform fallback with no login state and no
 * download interception (a download requires browser_run_code_unsafe, an RCE
 * equivalent behind unsafe caps, so the bit stays false). Probe checks for a
 * global `playwright` or `@playwright/mcp` CLI; the harness has no built-in
 * plugin registry for Sati's equivalent probe.
 * @module @deepseek-ai/dsh-browser-backend/playwright
 */

import { spawnSync } from 'node:child_process'
import type { BrowserBackend, BrowserBackendProbe } from './types.ts'

/** Commands whose presence means the @playwright/mcp tooling is installed. */
const PLAYWRIGHT_COMMANDS = ['playwright', '@playwright/mcp']

/** playwright backend options (test injection). */
export type PlaywrightBackendOptions = {
  /** Command presence check; defaults to spawnSync `which`. */
  isCommandExecutable?: (command: string) => boolean
}

/** Default `which` check via spawnSync. */
function which(command: string): boolean {
  try {
    return spawnSync('which', [command], { timeout: 3_000 }).status === 0
  } catch {
    return false
  }
}

/**
 * Playwright MCP backend probing global CLI presence.
 * @param options - command-check override (tests).
 * @returns a backend whose probe reports ok when either CLI is present.
 */
export function createPlaywrightBackend(options: PlaywrightBackendOptions = {}): BrowserBackend {
  const commandCheck = options.isCommandExecutable ?? which
  return {
    id: 'playwright',
    label: '@playwright/mcp',
    capabilities: {
      downloadInterception: false,
      screencast: true,
      handoff: false,
      siteTools: false,
      loginState: false,
      antiBot: false,
    },
    probe(): BrowserBackendProbe {
      const present = PLAYWRIGHT_COMMANDS.some(commandCheck)
      return {
        status: present ? 'ok' : 'warn',
        detail: present
          ? 'playwright / @playwright/mcp CLI available'
          : 'playwright / @playwright/mcp CLI not found',
        installHint: 'https://playwright.dev/mcp/introduction',
      }
    },
  }
}
