import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { EGO_EXTRACT_MARKER, EgoExtractor, buildEgoExtractScript } from '../src/ego-extractor.ts'
import type { EgoExtractorOptions } from '../src/ego-extractor.ts'
import type { ScriptRun } from '../src/browser-use-extractor.ts'
import { pathDelimiter } from '../src/run-script.ts'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))

type FakeChild = EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  stdin: EventEmitter & { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }
}

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.stdin = Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn() })
  return child
}

function fakeRun(result: { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }): ScriptRun {
  return async () => result
}

const homeDir = '/tmp/ego-extractor-home'
const localBin = join(homeDir, '.local', 'bin')
const delimiter = pathDelimiter(process.platform)

/** Command, arguments, and child environment of the last spawn call. */
function lastSpawn(): { command: string; args: string[]; env: NodeJS.ProcessEnv } {
  const call = vi.mocked(spawn).mock.calls.at(-1) as unknown as [string, string[], { env: NodeJS.ProcessEnv }]
  return { command: call[0], args: call[1], env: call[2].env }
}

/** Run one default-runner extract with `PATH` as given (undefined removes it) and return the spawned child environment. */
async function spawnEnvironment(path: string | undefined, options: EgoExtractorOptions): Promise<NodeJS.ProcessEnv> {
  const child = fakeChild()
  vi.mocked(spawn).mockReturnValue(child as never)
  const original = process.env.PATH
  if (path === undefined) delete process.env.PATH
  else process.env.PATH = path
  try {
    const extracted = new EgoExtractor(options).extract('https://example.com/rec', 'pdfLink()')
    child.emit('close', 0)
    await extracted
  } finally {
    if (original === undefined) delete process.env.PATH
    else process.env.PATH = original
  }
  return lastSpawn().env
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

  it('reports a failure without an exit code or stderr detail', async () => {
    const extractor = new EgoExtractor({
      run: fakeRun({ exitCode: null, stdout: '', stderr: '', timedOut: false }),
    })
    await expect(extractor.extract('https://example.com/rec', 'pdfLink()')).resolves.toEqual({
      ok: false,
      error: 'ego-browser exited null',
    })
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

describe('default script runner', () => {
  it('pipes the script to ego-browser nodejs and reads the marker from stdout', async () => {
    const child = fakeChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    const extracted = new EgoExtractor({ commandName: 'ego-browser', homeDir }).extract('https://example.com/rec', 'pdfLink()')
    child.stdout.emit('data', Buffer.from(`${EGO_EXTRACT_MARKER}https://cdn.example/w123.pdf\n`))
    child.emit('close', 0)
    await expect(extracted).resolves.toEqual({ ok: true, value: 'https://cdn.example/w123.pdf' })
    const spawnCall = lastSpawn()
    expect(spawnCall.command).toBe('ego-browser')
    expect(spawnCall.args).toEqual(['nodejs'])
    expect(spawnCall.env.PATH).toContain(localBin)
    expect(child.stdin.write).toHaveBeenCalledWith(expect.stringContaining('sati-page-extract'))
  })

  it('appends the ego local bin to the child PATH when it is missing', async () => {
    const env = await spawnEnvironment(['/usr/bin', '/bin'].join(delimiter), { commandName: 'ego-browser', homeDir })
    expect(env.PATH).toBe(['/usr/bin', '/bin', localBin].join(delimiter))
  })

  it('keeps the child PATH unchanged when it already contains the ego local bin', async () => {
    const path = ['/usr/bin', localBin].join(delimiter)
    expect((await spawnEnvironment(path, { homeDir })).PATH).toBe(path)
  })

  it('uses only the ego local bin when PATH is empty or absent', async () => {
    expect((await spawnEnvironment('', { homeDir })).PATH).toBe(localBin)
    expect((await spawnEnvironment(undefined, { homeDir })).PATH).toBe(localBin)
  })

  it('defaults the CLI name and the home directory', async () => {
    const child = fakeChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    const extracted = new EgoExtractor().extract('https://example.com/rec', 'pdfLink()')
    child.emit('close', 0)
    await extracted
    const spawnCall = lastSpawn()
    expect(spawnCall.command).toBe('ego-browser')
    expect(spawnCall.env.PATH).toContain(join(homedir(), '.local', 'bin'))
  })
})
