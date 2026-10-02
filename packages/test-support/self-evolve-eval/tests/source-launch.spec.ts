import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveSourceLaunchAnchors } from '../src/campaign/source-launch.ts'

const dirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'source-launch-'))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('resolveSourceLaunchAnchors', () => {
  it('fails loud when the tsx hook is not resolvable from the entry', async () => {
    const dir = await tempDir()
    const entry = join(dir, 'bin.ts')
    await writeFile(entry, '')
    expect(() => resolveSourceLaunchAnchors(entry)).toThrow(/cannot resolve the tsx ESM hook/)
  })

  it('fails loud when no workspace tsconfig sits above the entry', async () => {
    // A resolvable tsx hook with no tsconfig.base.json anywhere above it: the
    // harness sources resolve @deepseek-ai/* through that file's paths.
    const dir = await tempDir()
    const nested = join(dir, 'apps', 'cli', 'src')
    await mkdir(nested, { recursive: true })
    const entry = join(nested, 'bin.ts')
    await writeFile(entry, '')
    await writeFakeTsx(dir)
    expect(() => resolveSourceLaunchAnchors(entry)).toThrow(/no tsconfig.base.json above/)
  })

  it('resolves both anchors from the entry, not the working directory', async () => {
    const dir = await tempDir()
    const nested = join(dir, 'apps', 'cli', 'src')
    await mkdir(nested, { recursive: true })
    const entry = join(nested, 'bin.ts')
    await writeFile(entry, '')
    await writeFile(join(dir, 'tsconfig.base.json'), '{}')
    await writeFakeTsx(dir)
    const { tsxImport, tsconfigPath } = resolveSourceLaunchAnchors(entry)
    expect(tsconfigPath).toBe(join(dir, 'tsconfig.base.json'))
    expect(tsxImport).toContain('tsx')
  })

  it('uses a supplied tsxImport verbatim, so the documented override works', async () => {
    // No tsx is installed anywhere here: the override must bypass resolution
    // rather than fail on it, which is what its error message promises.
    const dir = await tempDir()
    const nested = join(dir, 'apps', 'cli', 'src')
    await mkdir(nested, { recursive: true })
    const entry = join(nested, 'bin.ts')
    await writeFile(entry, '')
    await writeFile(join(dir, 'tsconfig.base.json'), '{}')
    const anchors = resolveSourceLaunchAnchors(entry, { tsxImport: '/elsewhere/tsx/esm/index.mjs' })
    expect(anchors.tsxImport).toBe('/elsewhere/tsx/esm/index.mjs')
    expect(anchors.tsconfigPath).toBe(join(dir, 'tsconfig.base.json'))
  })
})

/** Write a minimal resolvable `tsx` package so the hook lookup succeeds. */
async function writeFakeTsx(root: string): Promise<void> {
  const pkg = join(root, 'node_modules', 'tsx')
  await mkdir(join(pkg, 'esm'), { recursive: true })
  await writeFile(join(pkg, 'package.json'), JSON.stringify({
    name: 'tsx',
    version: '0.0.0',
    type: 'module',
    exports: { '.': './index.mjs', './esm': './esm/index.mjs' },
  }))
  await writeFile(join(pkg, 'index.mjs'), '')
  await writeFile(join(pkg, 'esm', 'index.mjs'), '')
}
