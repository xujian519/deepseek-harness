import { describe, expect, it } from 'vitest'
import { EGO_EXTRACT_MARKER, EgoExtractor, buildEgoExtractScript } from '../src/ego-extractor.ts'
import type { ScriptRun } from '../src/browser-use-extractor.ts'

function fakeRun(result: { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }): ScriptRun {
  return async () => result
}

describe('buildEgoExtractScript', () => {
  it('opens the tab and cliLogs the js expression behind the extract marker', () => {
    const script = buildEgoExtractScript('https://example.com/rec', 'pdfLink()', 30_000)
    expect(script).toContain('sati-page-extract')
    expect(script).toContain('openOrReuseTab("https://example.com/rec", { wait: true, timeout: 30000 })')
    expect(script).toContain(`cliLog('${EGO_EXTRACT_MARKER}'`)
    expect(script).toContain('completeTaskSpace(task.id, { keep: false })')
  })
})

describe('EgoExtractor.extract', () => {
  it('returns the marker value', async () => {
    const extractor = new EgoExtractor({
      run: fakeRun({ exitCode: 0, stdout: `${EGO_EXTRACT_MARKER}https://cdn.example/w123.pdf\n`, stderr: '', timedOut: false }),
    })
    const result = await extractor.extract('https://example.com/rec', 'pdfLink()')
    expect(result).toEqual({ ok: true, value: 'https://cdn.example/w123.pdf' })
  })

  it('reports ok with a null value when the marker is empty', async () => {
    const extractor = new EgoExtractor({
      run: fakeRun({ exitCode: 0, stdout: `${EGO_EXTRACT_MARKER}\n`, stderr: '', timedOut: false }),
    })
    const result = await extractor.extract('https://example.com/rec', 'pdfLink()')
    expect(result).toEqual({ ok: true, value: null })
  })

  it('reports a timeout failure', async () => {
    const extractor = new EgoExtractor({
      run: fakeRun({ exitCode: null, stdout: '', stderr: '', timedOut: true }),
    })
    const result = await extractor.extract('https://example.com/rec', 'pdfLink()')
    expect(result).toMatchObject({ ok: false, timedOut: true })
  })

  it('reports a non-zero exit with stderr detail', async () => {
    const extractor = new EgoExtractor({
      run: fakeRun({ exitCode: 1, stdout: '', stderr: 'boom', timedOut: false }),
    })
    const result = await extractor.extract('https://example.com/rec', 'pdfLink()')
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.error).toContain('boom')
  })

  it('forwards timeout, cancel, and output cap to the runner', async () => {
    const capture: Array<{ timeoutMs: number; signal?: AbortSignal; maxOutputBytes: number }> = []
    const run: ScriptRun = async (_script, options) => {
      capture.push(options)
      return { exitCode: 0, stdout: `${EGO_EXTRACT_MARKER}x\n`, stderr: '', timedOut: false }
    }
    const extractor = new EgoExtractor({ run })
    const signal = new AbortController().signal
    await extractor.extract('https://example.com/rec', 'pdfLink()', { timeoutMs: 12_000, signal, maxOutputBytes: 20_000 })
    expect(capture[0]?.timeoutMs).toBe(12_000)
    expect(capture[0]?.signal).toBe(signal)
    expect(capture[0]?.maxOutputBytes).toBe(20_000)
  })
})
