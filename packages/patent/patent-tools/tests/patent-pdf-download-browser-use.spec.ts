import { describe, expect, it, vi } from 'vitest'
import { BrowserUseExtractor, type ScriptRun } from '@deepseek-ai/dsh-browser-backend'
import { createBrowserUseDownloadRunner } from '../src/tool/patent-pdf-download-browser-use.ts'
import type { EgoDownloadRequest } from '../src/tool/patent-pdf-download.ts'

function runner(run: ScriptRun) {
  return createBrowserUseDownloadRunner(new BrowserUseExtractor({ run }))
}

const request: EgoDownloadRequest = {
  patents: ['US1A', 'CN2B'],
  outputDir: '/tmp/out',
  pageTimeoutSec: 20,
  downloadTimeoutMs: 60_000,
  record: false,
  timeoutMs: 180_000,
}

describe('createBrowserUseDownloadRunner', () => {
  it('reports extracted CDN links as fallback items', async () => {
    const extract = vi.fn(async (_script: string, _options: { timeoutMs: number; signal?: AbortSignal; maxOutputBytes: number }) => ({
      exitCode: 0,
      stdout: 'BU_EXTRACT:https://cdn/US1A.pdf\n',
      stderr: '',
      timedOut: false,
    }))
    const result = await runner(extract)(request)
    expect(result.items).toEqual([
      { patent: 'US1A', status: 'fallback', pdfUrl: 'https://cdn/US1A.pdf' },
      { patent: 'CN2B', status: 'fallback', pdfUrl: 'https://cdn/US1A.pdf' },
    ])
    const [script, options] = extract.mock.calls[0] ?? []
    expect(script).toContain('new_tab("https://patents.google.com/patent/US1A/en")')
    expect(options).toEqual({ timeoutMs: 20_000, signal: undefined, maxOutputBytes: 1_000_000 })
  })

  it('reports a missing link as a fallback error', async () => {
    const result = await runner(async () => ({
      exitCode: 0,
      stdout: 'BU_EXTRACT:\n',
      stderr: '',
      timedOut: false,
    }))(request)
    expect(result.items).toEqual([
      { patent: 'US1A', status: 'fallback', error: 'no CDN pdf link on page' },
      { patent: 'CN2B', status: 'fallback', error: 'no CDN pdf link on page' },
    ])
  })

  it('reports an extraction failure as a fallback error', async () => {
    const result = await runner(async () => ({
      exitCode: 1,
      stdout: '',
      stderr: 'boom',
      timedOut: false,
    }))(request)
    expect(result.items[0]).toEqual({ patent: 'US1A', status: 'fallback', error: 'browser-use exited 1: boom' })
  })

  it('stops extracting once the caller signal aborts', async () => {
    const controller = new AbortController()
    const extract = vi.fn(async () => ({
      exitCode: 0,
      stdout: 'BU_EXTRACT:https://cdn/x.pdf\n',
      stderr: '',
      timedOut: false,
    }))
    controller.abort()
    const result = await runner(extract)({ ...request, signal: controller.signal })
    expect(result.items).toEqual([])
    expect(extract).not.toHaveBeenCalled()
  })

  it('passes the caller signal through to the extractor', async () => {
    const controller = new AbortController()
    const extract = vi.fn(async (_script: string, _options: { signal?: AbortSignal }) => ({
      exitCode: 0,
      stdout: 'BU_EXTRACT:https://cdn/x.pdf\n',
      stderr: '',
      timedOut: false,
    }))
    await runner(extract)({ ...request, signal: controller.signal })
    expect(extract.mock.calls[0]?.[1]?.signal).toBe(controller.signal)
  })
})
