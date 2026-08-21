import { describe, expect, it, vi } from 'vitest'
import type { BrowserBackend } from '@deepseek-ai/dsh-browser-backend'
import { BrowserUseExtractor } from '@deepseek-ai/dsh-browser-backend'
import { createDownloadRunnerResolver } from '../src/index.ts'
import type { RunEgo } from '../src/tool/patent-pdf-download.ts'

function fakeBackend(id: BrowserBackend['id']): BrowserBackend {
  return {
    id,
    label: id,
    capabilities: {
      downloadInterception: false,
      screencast: false,
      handoff: false,
      siteTools: false,
      loginState: false,
      antiBot: false,
    },
    probe: () => ({ status: 'ok', detail: 'fake' }),
  }
}

describe('createDownloadRunnerResolver', () => {
  it('returns the ego runner when the backend decision lands on ego', async () => {
    const runEgo: RunEgo = vi.fn(async () => ({ items: [] }))
    const resolve = vi.fn(async () => fakeBackend('ego'))
    const resolver = createDownloadRunnerResolver({ runEgo, extractor: new BrowserUseExtractor(), resolve })
    const runner = await resolver()
    expect(runner).toBe(runEgo)
    expect(resolve).toHaveBeenCalledWith({ exclude: ['browseros-neo', 'playwright'] })
  })

  it('returns a browser-use runner when the backend decision lands on browser-use', async () => {
    const runEgo: RunEgo = vi.fn(async () => { throw new Error('ego must not run') })
    const resolve = vi.fn(async () => fakeBackend('browser-use'))
    const extractor = new BrowserUseExtractor({
      run: async () => ({ exitCode: 0, stdout: 'BU_EXTRACT:https://cdn/US1A.pdf\n', stderr: '', timedOut: false }),
    })
    const resolver = createDownloadRunnerResolver({ runEgo, extractor, resolve })
    const runner = await resolver()
    const result = await runner({
      patents: ['US1A'],
      outputDir: '/tmp/out',
      pageTimeoutSec: 20,
      downloadTimeoutMs: 60_000,
      record: false,
      timeoutMs: 180_000,
    })
    expect(result.items).toEqual([{ patent: 'US1A', status: 'fallback', pdfUrl: 'https://cdn/US1A.pdf' }])
  })
})
