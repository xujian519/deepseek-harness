import { describe, expect, it, vi } from 'vitest'
import type { BrowserBackend } from '@deepseek-ai/dsh-browser-backend'
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
  it('always runs the ego runner (only backend in the download channel)', async () => {
    const runEgo: RunEgo = vi.fn(async () => ({ items: [] }))
    const resolve = vi.fn(async () => fakeBackend('ego'))
    const resolver = createDownloadRunnerResolver({ runEgo, resolve })
    const runner = await resolver()
    expect(runner).toBe(runEgo)
    expect(resolve).toHaveBeenCalledWith({ exclude: ['browseros-neo', 'playwright', 'browser-use'] })
  })

  it('falls back to the ego runner when backend resolution throws', async () => {
    // A host with no detectable backend must still honor the explicitly wired
    // ego channel instead of failing the download with install guidance.
    const runEgo: RunEgo = vi.fn(async () => ({ items: [] }))
    const resolve = vi.fn(async () => { throw new Error('no backend') })
    const resolver = createDownloadRunnerResolver({ runEgo, resolve })
    const runner = await resolver()
    expect(runner).toBe(runEgo)
  })
})
