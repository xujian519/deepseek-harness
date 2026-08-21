import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { spawn } from 'node:child_process'
import { BrowserUseExtractor, buildBrowserUseExtractScript } from '../src/browser-use-extractor.ts'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))

type FakeChild = {
  stdout: EventEmitter
  stderr: EventEmitter
  stdin: EventEmitter & { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }
  on: EventEmitter['on']
  emit: EventEmitter['emit']
}

function fakeChild(): FakeChild {
  const child = new EventEmitter() as unknown as FakeChild
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.stdin = Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn() })
  return child
}

describe('buildBrowserUseExtractScript', () => {
  it('embeds the url, the js expression, and the marker print', () => {
    const script = buildBrowserUseExtractScript('https://arxiv.org/abs/2401.00001', 'document.querySelector("a.pdf")?.href ?? null')
    expect(script).toContain('ensure_real_tab()')
    expect(script).toContain('new_tab("https://arxiv.org/abs/2401.00001")')
    expect(script).toContain('wait_for_load()')
    expect(script).toContain('js("document.querySelector(\\"a.pdf\\")?.href ?? null")')
    expect(script).toContain("print('BU_EXTRACT:' + (str(v) if v is not None else ''))")
  })
})

describe('BrowserUseExtractor.extract', () => {
  it('returns the marker value on success', async () => {
    const extractor = new BrowserUseExtractor({
      run: async () => ({ exitCode: 0, stdout: 'log\nBU_EXTRACT:https://cdn/x.pdf\n', stderr: '', timedOut: false }),
    })
    await expect(extractor.extract('u', 'e')).resolves.toEqual({ ok: true, value: 'https://cdn/x.pdf' })
  })

  it('returns null when the marker is empty (page had no match)', async () => {
    const extractor = new BrowserUseExtractor({
      run: async () => ({ exitCode: 0, stdout: 'BU_EXTRACT:\n', stderr: '', timedOut: false }),
    })
    await expect(extractor.extract('u', 'e')).resolves.toEqual({ ok: true, value: null })
  })

  it('reports a failure when the marker is absent and the run exited', async () => {
    const extractor = new BrowserUseExtractor({
      run: async () => ({ exitCode: 0, stdout: 'nothing', stderr: '', timedOut: false }),
    })
    await expect(extractor.extract('u', 'e')).resolves.toEqual({ ok: false, error: 'browser-use exited 0' })
  })

  it('reports the timeout when the run timed out', async () => {
    const extractor = new BrowserUseExtractor({
      run: async () => ({ exitCode: null, stdout: '', stderr: '', timedOut: true }),
    })
    await expect(extractor.extract('u', 'e')).resolves.toEqual({
      ok: false,
      error: 'browser-use timed out',
      timedOut: true,
    })
  })

  it('reports the exit with the stderr detail when the spawn failed', async () => {
    const extractor = new BrowserUseExtractor({
      run: async () => ({ exitCode: null, stdout: '', stderr: 'ENOENT: no such file', timedOut: false }),
    })
    await expect(extractor.extract('u', 'e')).resolves.toEqual({
      ok: false,
      error: 'browser-use exited null: ENOENT: no such file',
    })
  })
})

describe('default script runner', () => {
  it('collects stdout and resolves on close', async () => {
    const child = fakeChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    const extractor = new BrowserUseExtractor()
    const promise = extractor.extract('u', 'e')
    child.stdout.emit('data', Buffer.from('BU_EXTRACT:https://cdn/x.pdf'))
    child.emit('close', 0)
    await expect(promise).resolves.toEqual({ ok: true, value: 'https://cdn/x.pdf' })
  })

  it('resolves with the error message when spawn fails', async () => {
    const child = fakeChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    const extractor = new BrowserUseExtractor()
    const promise = extractor.extract('u', 'e')
    child.emit('error', new Error('ENOENT'))
    await expect(promise).resolves.toEqual({ ok: false, error: 'browser-use exited null: ENOENT' })
  })

  it('resolves timed out after the internal timer aborts', async () => {
    const child = fakeChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    const extractor = new BrowserUseExtractor()
    const promise = extractor.extract('u', 'e', { timeoutMs: 5 })
    await new Promise(resolve => setTimeout(resolve, 30))
    child.emit('error', new Error('The operation was aborted'))
    await expect(promise).resolves.toEqual({ ok: false, error: 'browser-use timed out', timedOut: true })
  })

  it('propagates a pre-aborted caller signal', async () => {
    const controller = new AbortController()
    controller.abort()
    const child = fakeChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    const extractor = new BrowserUseExtractor()
    const promise = extractor.extract('u', 'e', { signal: controller.signal, timeoutMs: 10_000 })
    child.emit('error', new Error('aborted'))
    await expect(promise).resolves.toEqual({ ok: false, error: 'browser-use exited null: aborted' })
  })

  it('listens to and cleans up a caller signal on close', async () => {
    const controller = new AbortController()
    const child = fakeChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    const extractor = new BrowserUseExtractor()
    const promise = extractor.extract('u', 'e', { signal: controller.signal })
    child.emit('close', 0)
    await expect(promise).resolves.toEqual({ ok: false, error: 'browser-use exited 0' })
    controller.abort()
  })

  it('aborts through the caller-signal listener', async () => {
    const controller = new AbortController()
    const child = fakeChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    const extractor = new BrowserUseExtractor()
    const promise = extractor.extract('u', 'e', { signal: controller.signal, timeoutMs: 10_000 })
    controller.abort()
    child.emit('error', new Error('aborted'))
    await expect(promise).resolves.toEqual({ ok: false, error: 'browser-use exited null: aborted' })
  })

  it('caps collected output per stream', async () => {
    const child = fakeChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    const extractor = new BrowserUseExtractor()
    const promise = extractor.extract('u', 'e', { maxOutputBytes: 100 })
    child.stdout.emit('data', Buffer.from('x'.repeat(200)))
    child.stdout.emit('data', Buffer.from('x'.repeat(200)))
    child.stderr.emit('data', Buffer.from('y'.repeat(200)))
    child.stderr.emit('data', Buffer.from('y'.repeat(200)))
    child.emit('close', 1)
    await expect(promise).resolves.toEqual({ ok: false, error: `browser-use exited 1: ${'y'.repeat(100)}` })
  })

  it('ignores stdin write errors after the child exited', async () => {
    const child = fakeChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    const extractor = new BrowserUseExtractor()
    const promise = extractor.extract('u', 'e')
    expect(() => child.stdin.emit('error', new Error('EPIPE'))).not.toThrow()
    child.emit('close', 0)
    await promise
  })
})
