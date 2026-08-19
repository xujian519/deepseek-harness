/**
 * Unit tests for the ego-browser download adapter: script construction,
 * availability gating, tagged-JSON parsing, timeout/parse-error mapping,
 * and signal/cwd pass-through.
 */
import { describe, expect, it } from 'vitest'
import { buildDownloadScript, createEgoDownloadRunner } from '../src/tool/patent-pdf-download-ego.ts'
import type { EgoDownloadRequest } from '../src/tool/patent-pdf-download.ts'

function request(overrides: Partial<EgoDownloadRequest> = {}): EgoDownloadRequest {
  return {
    patents: ['US11452699B2', 'CN115690481A'],
    outputDir: '/tmp/patent-pdf',
    pageTimeoutSec: 20,
    downloadTimeoutMs: 60_000,
    record: false,
    timeoutMs: 180_000,
    ...overrides,
  }
}

function okSession(overrides: Partial<Parameters<typeof createEgoDownloadRunner>[0]> = {}) {
  return {
    checkAvailability: () => ({ ok: true }),
    runScript: async () => ({ output: 'EGO_DOWNLOAD:{"items":[{"patent":"US11452699B2","status":"ok","path":"/tmp/patent-pdf/US11452699B2.pdf"}]}', exitCode: 0, timedOut: false }),
    extractTaggedJson: (output: string, tag: string) => {
      const prefix = `EGO_${tag}:`
      const idx = output.indexOf(prefix)
      if (idx < 0) return null
      return JSON.parse(output.slice(idx + prefix.length)) as unknown
    },
    ...overrides,
  }
}

describe('buildDownloadScript', () => {
  it('opens the task space, each patent page, and the CDN link', () => {
    const script = buildDownloadScript(request())
    expect(script).toContain("useOrCreateTaskSpace('sati-patent-download')")
    expect(script).toContain("openOrReuseTab('https://patents.google.com/patent/' + patent + '/en'")
    expect(script).toContain('patentimages.storage.googleapis.com')
    expect(script).toContain('"US11452699B2"')
    expect(script).toContain('"CN115690481A"')
    expect(script).toContain("cdp('Page.setDownloadBehavior'")
    expect(script).toContain("cliLog('EGO_DOWNLOAD:' + JSON.stringify(payload))")
    expect(script).toContain('completeTaskSpace(task.id, { keep: false })')
  })

  it('injects the per-page and download timeouts', () => {
    const script = buildDownloadScript(request({ pageTimeoutSec: 30, downloadTimeoutMs: 90_000 }))
    expect(script).toContain('timeout: 30')
    expect(script).toContain('Date.now() + 90000')
  })

  it('emits the evidence directory when record is true', () => {
    const script = buildDownloadScript(request({ record: true }))
    expect(script).toContain('payload.recorded = outputDir + \'/evidence\'')
  })
})

describe('createEgoDownloadRunner', () => {
  it('passes cwd and timeout to runScript and maps the tagged payload', async () => {
    let seen: { cwd: string; timeoutMs?: number } | undefined
    const runner = createEgoDownloadRunner(okSession({
      runScript: async (_script, options) => {
        seen = options
        return { output: 'EGO_DOWNLOAD:{"items":[{"patent":"US11452699B2","status":"ok","path":"/tmp/patent-pdf/US11452699B2.pdf"}],"recorded":"/tmp/patent-pdf/evidence"}', exitCode: 0, timedOut: false }
      },
    }))
    const result = await runner(request())
    expect(seen).toEqual({ cwd: '/tmp/patent-pdf', timeoutMs: 180_000 })
    expect(result.items).toEqual([{ patent: 'US11452699B2', status: 'ok', path: '/tmp/patent-pdf/US11452699B2.pdf' }])
    expect(result.recorded).toBe('/tmp/patent-pdf/evidence')
  })

  it('throws setup_required when ego-browser is unavailable', async () => {
    const runner = createEgoDownloadRunner(okSession({ checkAvailability: () => ({ ok: false, reason: 'ego lite not installed' }) }))
    await expect(runner(request())).rejects.toMatchObject({ code: 'setup_required' })
  })

  it('throws tool_execution_failed when runScript rejects', async () => {
    const runner = createEgoDownloadRunner(okSession({ runScript: async () => { throw new Error('spawn boom') } }))
    await expect(runner(request())).rejects.toMatchObject({ code: 'tool_execution_failed' })
  })

  it('throws tool_execution_failed on timeout', async () => {
    const runner = createEgoDownloadRunner(okSession({ runScript: async () => ({ output: '', exitCode: null, timedOut: true }) }))
    await expect(runner(request())).rejects.toMatchObject({ code: 'tool_execution_failed' })
  })

  it('throws tool_execution_failed when no EGO_DOWNLOAD payload is present', async () => {
    const runner = createEgoDownloadRunner(okSession({ runScript: async () => ({ output: 'garbage', exitCode: 0, timedOut: false }) }))
    await expect(runner(request())).rejects.toMatchObject({ code: 'tool_execution_failed' })
  })

  it('maps fallback items with pdfUrl and keeps the error text', async () => {
    const runner = createEgoDownloadRunner(okSession({
      runScript: async () => ({ output: 'EGO_DOWNLOAD:{"items":[{"patent":"US11452699B2","status":"fallback","pdfUrl":"https://cdn/x.pdf","error":"no intercept"}]}', exitCode: 0, timedOut: false }),
    }))
    const result = await runner(request())
    expect(result.items).toEqual([{ patent: 'US11452699B2', status: 'fallback', pdfUrl: 'https://cdn/x.pdf', error: 'no intercept' }])
  })

  it('forwards the caller abort signal', async () => {
    const controller = new AbortController()
    let seenSignal: AbortSignal | undefined
    const runner = createEgoDownloadRunner(okSession({
      runScript: async (_script, options) => { seenSignal = options.signal; return { output: 'EGO_DOWNLOAD:{"items":[]}', exitCode: 0, timedOut: false } },
    }))
    await runner(request({ signal: controller.signal }))
    expect(seenSignal).toBe(controller.signal)
  })
})
