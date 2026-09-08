import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createExecFileRunner } from '../src/runner.ts'
import { createMacosTools, createStatPathCheck, type MacosLimits } from '../src/tools.ts'

const signal = new AbortController().signal
const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

const LIMITS: MacosLimits = {
  commandTimeoutMs: 10_000,
  clipboardReadMaxChars: 20_000,
  clipboardWriteMaxChars: 1_000_000,
  speakMaxChars: 4_000,
  notifyMaxChars: 4_000,
}

describe.skipIf(process.platform !== 'darwin')('macOS system CLIs', () => {
  it('round-trips clipboard text through pbcopy and pbpaste', async () => {
    const run = createExecFileRunner()
    const sent = `dsh-macos-tools round-trip ${Date.now()}`
    await run('/usr/bin/pbcopy', [], { timeoutMs: 10_000, signal, input: sent })
    const { stdout } = await run('/usr/bin/pbpaste', [], { timeoutMs: 10_000, signal })
    expect(stdout).toBe(sent)
  })

  it('exercises the say argv path through its voice listing (no audio)', async () => {
    // `say -v ?` lists installed voices and exits; it is the command's
    // speech-free invocation, keeping dev machines quiet.
    const run = createExecFileRunner()
    const { stdout } = await run('/usr/bin/say', ['-v', '?'], { timeoutMs: 10_000, signal })
    expect(stdout).toContain('en')
  })

  it('keeps leading-dash text positional through the -- separator (no audio)', async () => {
    const run = createExecFileRunner()
    const dir = await mkdtemp(join(tmpdir(), 'dsh-macos-say-'))
    tempDirs.push(dir)
    const out = join(dir, 'probe.aiff')
    // Without '--', say parses '-v probe' as the voice option and renders
    // near-silence; with it the text renders as spoken audio.
    await expect(run('/usr/bin/say', ['-o', out, '--', '-v probe'], { timeoutMs: 10_000, signal }))
      .resolves.toMatchObject({ stdout: '' })
    const { size } = await stat(out)
    expect(size).toBeGreaterThan(10_000)
  })

  it('resolves the stat precheck against a real directory', async () => {
    await expect(createStatPathCheck()('/tmp')).resolves.toBeUndefined()
  })

  it('registers the seven tools through the factory', () => {
    expect(createMacosTools({ run: createExecFileRunner(), approver: undefined, stat: createStatPathCheck(), limits: LIMITS })
      .map(tool => tool.name))
      .toEqual(['macos_open_path', 'macos_open_url', 'macos_clipboard_get', 'macos_clipboard_set', 'macos_notify', 'macos_speak', 'macos_app'])
  })
})
