import { describe, expect, it, vi } from 'vitest'
import type { BrowserBackend, BrowserBackendId, BrowserBackendProbe } from '../src/types.ts'
import { buildBackendCandidates, probeAllBackends, resolveBrowserBackend } from '../src/index.ts'

function fakeBackend(id: BrowserBackendId, probe: () => BrowserBackendProbe): BrowserBackend {
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
    probe,
  }
}

describe('buildBackendCandidates', () => {
  it('orders the built-in cascade ego → browseros-neo → browser-use → playwright', () => {
    const ids = buildBackendCandidates().map(b => b.id)
    expect(ids).toEqual(['ego', 'browseros-neo', 'browser-use', 'playwright'])
  })

  it('uses the injected backends when provided', () => {
    const backends = [fakeBackend('ego', () => ({ status: 'ok', detail: '' }))]
    expect(buildBackendCandidates({ backends }).map(b => b.id)).toEqual(['ego'])
  })

  it('excludes candidates', () => {
    const ids = buildBackendCandidates({ exclude: ['playwright', 'browseros-neo'] }).map(b => b.id)
    expect(ids).toEqual(['ego', 'browser-use'])
  })

  it('moves the preferred backend to the front', () => {
    const ids = buildBackendCandidates({ prefer: 'browser-use' }).map(b => b.id)
    expect(ids).toEqual(['browser-use', 'ego', 'browseros-neo', 'playwright'])
  })

  it('warns and ignores a preferred backend that is excluded', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      const ids = buildBackendCandidates({ prefer: 'browser-use', exclude: ['browser-use'] }).map(b => b.id)
      expect(ids).toEqual(['ego', 'browseros-neo', 'playwright'])
      expect(write).toHaveBeenCalledWith(expect.stringContaining('ignoring prefer'))
    } finally {
      write.mockRestore()
    }
  })

  it('forwards platform, doctor, and endpoint options to the built-in backends', () => {
    const ids = buildBackendCandidates({ platform: 'darwin', doctorCheck: true, browserosUrl: 'http://x/mcp' }).map(b => b.id)
    expect(ids).toHaveLength(4)
  })

  it('does not warn when prefer is absent or honored', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      buildBackendCandidates()
      buildBackendCandidates({ prefer: 'ego' })
      expect(write).not.toHaveBeenCalled()
    } finally {
      write.mockRestore()
    }
  })
})

describe('resolveBrowserBackend', () => {
  it('returns the first candidate whose probe reports ok', async () => {
    const backends = [
      fakeBackend('ego', () => ({ status: 'missing', detail: 'no ego' })),
      fakeBackend('browseros-neo', () => ({ status: 'ok', detail: 'neo up' })),
      fakeBackend('browser-use', () => ({ status: 'ok', detail: 'bu up' })),
    ]
    const backend = await resolveBrowserBackend({ backends })
    expect(backend.id).toBe('browseros-neo')
  })

  it('skips a candidate whose probe throws', async () => {
    const backends = [
      fakeBackend('ego', () => { throw new Error('boom') }),
      fakeBackend('browser-use', () => ({ status: 'ok', detail: 'bu up' })),
    ]
    const backend = await resolveBrowserBackend({ backends })
    expect(backend.id).toBe('browser-use')
  })

  it('throws with the diagnostic command guidance when nothing is available', async () => {
    const backends = [
      fakeBackend('ego', () => ({ status: 'missing', detail: 'no' })),
      fakeBackend('playwright', () => ({ status: 'warn', detail: 'no' })),
    ]
    await expect(resolveBrowserBackend({ backends })).rejects.toThrow('dsh --profile headless browsers')
  })
})

describe('probeAllBackends', () => {
  it('probes every candidate without short-circuiting', async () => {
    const backends = [
      fakeBackend('ego', () => ({ status: 'ok', detail: 'a' })),
      fakeBackend('browser-use', () => ({ status: 'missing', detail: 'b' })),
    ]
    const results = await probeAllBackends({ backends })
    expect(results.map(r => [r.backend.id, r.probe.status])).toEqual([
      ['ego', 'ok'],
      ['browser-use', 'missing'],
    ])
  })

  it('degrades a throwing probe to warn', async () => {
    const backends = [fakeBackend('ego', () => { throw new Error('boom') })]
    const results = await probeAllBackends({ backends })
    expect(results[0]?.probe).toEqual({ status: 'warn', detail: 'probe error: boom' })
  })

  it('degrades a non-Error throwing probe to warn', async () => {
    const backends = [fakeBackend('ego', () => { throw 'boom' })]
    const results = await probeAllBackends({ backends })
    expect(results[0]?.probe).toEqual({ status: 'warn', detail: 'probe error: boom' })
  })
})
