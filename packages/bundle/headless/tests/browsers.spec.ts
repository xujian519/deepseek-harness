import { describe, expect, it } from 'vitest'
import type { BrowserBackend, BrowserBackendId, BrowserBackendProbe } from '@deepseek-ai/dsh-browser-backend'
import { formatBrowserBackendMatrix } from '../src/browsers.ts'

function fake(id: BrowserBackendId, label: string, probe: BrowserBackendProbe): { backend: BrowserBackend; probe: BrowserBackendProbe } {
  return {
    backend: {
      id,
      label,
      capabilities: {
        downloadInterception: false,
        screencast: false,
        handoff: false,
        siteTools: false,
        loginState: false,
        antiBot: false,
      },
      probe: () => probe,
    },
    probe,
  }
}

describe('formatBrowserBackendMatrix', () => {
  it('renders badges, details, install hints, and notes in cascade order', () => {
    const text = formatBrowserBackendMatrix([
      fake('ego', 'ego lite', { status: 'ok', detail: 'macOS · CLI available' }),
      fake('browseros-neo', 'BrowserOS neo', {
        status: 'missing',
        detail: 'not reachable',
        installHint: 'https://browseros.com/agents',
      }),
      fake('browser-use', 'browser-use', { status: 'ok', detail: '0.1.8' }),
      fake('playwright', '@playwright/mcp', { status: 'warn', detail: 'CLI not found', installHint: 'https://playwright.dev/mcp/introduction' }),
    ])
    expect(text).toContain('cascade: ego lite → BrowserOS neo → browser-use → @playwright/mcp')
    expect(text).toContain('[ok ] ego lite')
    expect(text).toContain('macOS · CLI available')
    expect(text).toContain('[-- ] BrowserOS neo')
    expect(text).toContain('not reachable')
    expect(text).toContain('install: https://browseros.com/agents')
    expect(text).toContain('[ok ] browser-use')
    expect(text).toContain('[!  ] @playwright/mcp')
    expect(text).toContain('install: https://playwright.dev/mcp/introduction')
    expect(text).toContain('cold decision')
  })

  it('ends with a single trailing newline', () => {
    const text = formatBrowserBackendMatrix([fake('ego', 'ego lite', { status: 'ok', detail: 'x' })])
    expect(text.endsWith('\n')).toBe(true)
    expect(text.endsWith('\n\n')).toBe(false)
  })
})
