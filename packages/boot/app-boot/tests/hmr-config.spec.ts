import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Hmr from '@deepseek-ai/cordis-plugin-hmr'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import { describe, expect, it, vi } from 'vitest'

async function bootHmr(dir: string, root: string[] = [], usePolling?: boolean): Promise<Context> {
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(dir).href + '/'
  await ctx.plugin(Loader)
  await ctx.plugin(Timer)
  await ctx.plugin(Hmr, {
    root,
    ignored: [],
    debounce: 0,
    ...usePolling === undefined ? {} : { usePolling },
  })
  return ctx
}

async function eventually(test: () => boolean, message: string, budgetMs = 10_000): Promise<void> {
  const deadline = Date.now() + budgetMs
  while (!test()) {
    if (Date.now() >= deadline) throw new Error(message)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

describe('HMR exact config paths', () => {
  it('observes module changes when its watch base is a filesystem alias', { timeout: 30_000 }, async () => {
    const target = mkdtempSync(join(tmpdir(), 'dsh-hmr-module-canonical-'))
    const alias = `${target}-alias`
    const aliasFilename = join(alias, 'module.ts')
    symlinkSync(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
    writeFileSync(aliasFilename, 'export const generation = 0\n')
    // This acceptance owns alias-to-cache identity. Other cases below exercise
    // native events; polling keeps Windows fs.watch queue pressure out of it.
    const ctx = await bootHmr(alias, ['.'], true)
    const filename = join(await realpath(target), 'module.ts')
    const expected = pathToFileURL(filename).href
    const cacheHas = vi.spyOn(ctx.loader.internal!.loadCache, 'has').mockReturnValue(false)
    const observed: string[] = []
    ctx.on('hmr/change', (url) => { observed.push(url) })
    try {
      const deadline = Date.now() + 20_000
      for (let generation = 1; !observed.includes(expected); generation += 1) {
        if (Date.now() >= deadline) {
          throw new Error(`HMR did not observe ${expected} through the alias; observed ${JSON.stringify(observed)}`)
        }
        // The watch base, not the writer spelling, is the alias under test.
        // Grow the file on every write: polling must not depend on timestamp
        // precision when several generations land inside one filesystem tick.
        writeFileSync(filename, `export const generation = ${generation}\n${' '.repeat(generation)}\n`)
        // Leave Chokidar's atomic-write window idle so one coalesced change can publish.
        await new Promise(resolve => setTimeout(resolve, 250))
      }
      expect(cacheHas).toHaveBeenCalledWith(expected)
    } finally {
      await ctx.fiber.dispose()
      unlinkSync(alias)
      rmSync(target, { recursive: true, force: true })
    }
  })

  it('collapses filesystem aliases before registering an exact watch', async () => {
    const target = mkdtempSync(join(tmpdir(), 'dsh-hmr-canonical-'))
    const alias = `${target}-alias`
    symlinkSync(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const ctx = await bootHmr(alias)
    try {
      await ctx.hmr.registerConfig('plugins.yml', () => {})
      await expect(ctx.hmr.registerConfig(join(await realpath(target), 'plugins.yml'), () => {}))
        .rejects.toThrow('config path already registered')
    } finally {
      await ctx.fiber.dispose()
      unlinkSync(alias)
      rmSync(target, { recursive: true, force: true })
    }
  })

  it('observes add, change, and unlink outside its module roots', { timeout: 90_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-hmr-config-'))
    const filename = join(dir, 'plugins.yml')
    const ctx = await bootHmr(dir)
    const observed: string[] = []
    try {
      await ctx.hmr.registerConfig(filename, () => {
        try {
          observed.push(readFileSync(filename, 'utf8'))
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          observed.push('missing')
        }
      })

      // Each wait bounds filesystem-event delivery, which can lag under the
      // forks pool's aggregate contention. Give each the lane the CI run grants
      // instead of the 10 s default, so a contended host delays the event rather
      // than failing on a budget below the lane.
      writeFileSync(filename, 'one', { flag: 'wx' })
      await eventually(() => observed.includes('one'), 'HMR did not observe config creation', 20_000)
      writeFileSync(filename, 'two')
      await eventually(() => observed.includes('two'), 'HMR did not observe config change', 20_000)
      unlinkSync(filename)
      await eventually(() => observed.includes('missing'), 'HMR did not observe config removal', 20_000)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('observes creation when the config parent did not exist at registration', { timeout: 30_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-hmr-config-'))
    const dir = join(root, 'later')
    const filename = join(dir, 'plugins.yml')
    const ctx = await bootHmr(root)
    const observed: string[] = []
    try {
      await ctx.hmr.registerConfig(filename, () => {
        observed.push(readFileSync(filename, 'utf8'))
      })
      mkdirSync(dir)
      writeFileSync(filename, 'created')
      // The watcher applies sub-second when unloaded; FSEvents delivery can lag
      // the full suite's parallel workers, so the budget tracks the test timeout.
      await eventually(() => observed.includes('created'), 'HMR did not observe config creation under a new parent', 20_000)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('serializes refreshes and waits for them during disposal', { timeout: 20_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-hmr-config-'))
    const filename = join(dir, 'plugins.yml')
    writeFileSync(filename, 'one')
    const ctx = await bootHmr(dir)
    const started = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const secondStarted = Promise.withResolvers<undefined>()
    const release2 = Promise.withResolvers<undefined>()
    const observed: string[] = []
    let active = 0
    let maxActive = 0
    let secondHeld = false
    try {
      const dispose = await ctx.hmr.registerConfig(filename, async () => {
        active += 1
        maxActive = Math.max(maxActive, active)
        observed.push(readFileSync(filename, 'utf8'))
        if (observed.length === 1) {
          // Hold the initial-scan refresh so disposal proves it waits on it.
          started.resolve(undefined)
          await release.promise
        } else if (!secondHeld) {
          // Hold the first change refresh so the queued edit is provably
          // serialized behind the held refresh and disposal waits on it too.
          secondHeld = true
          secondStarted.resolve(undefined)
          await release2.promise
        }
        active -= 1
      })
      await started.promise
      // Queue a second change while the initial refresh is held: the serializer
      // marks it dirty and the same running task re-runs it, never in parallel.
      // Wait for the second refresh to actually start (an observable state
      // transition) before disposing, so a slow filesystem event cannot be
      // delivered after the watcher closes and lose the edit — the old fixed
      // 250 ms sleep left that race.
      writeFileSync(filename, 'two')
      release.resolve(undefined)
      await secondStarted.promise
      expect(maxActive).toBe(1)

      let disposed = false
      const disposal = dispose().then(() => { disposed = true })
      await Promise.resolve()
      expect(disposed).toBe(false)
      release2.resolve(undefined)
      await disposal
      expect(disposed).toBe(true)
      expect(observed).toEqual(['one', 'two'])
    } finally {
      release.resolve(undefined)
      release2.resolve(undefined)
      await ctx.fiber.dispose()
    }
  })

  it('normalizes refresh failures and broadcasts them without escaping the watcher', { timeout: 20_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-hmr-config-'))
    const filename = join(dir, 'plugins.yml')
    const ctx = await bootHmr(dir)
    const failure = Promise.withResolvers<{ filename: string; error: Error }>()
    let failureCount = 0
    try {
      ctx.on('hmr/config-update-failed', () => {
        throw new Error('observer failed')
      })
      ctx.on('hmr/config-update-failed', (failedFilename, error) => {
        failureCount += 1
        failure.resolve({ filename: failedFilename, error })
      })
      await ctx.hmr.registerConfig(filename, () => { throw 42 })
      writeFileSync(filename, 'invalid')

      const observed = await failure.promise
      expect(observed.filename).toBe(filename)
      expect(observed.error).toBeInstanceOf(Error)
      expect(observed.error.message).toBe('42')

      // Let Chokidar's atomic-write window close before requiring a distinct
      // second notification from the same path.
      await new Promise(resolve => setTimeout(resolve, 250))
      writeFileSync(filename, 'invalid again')
      await eventually(() => failureCount === 2, 'HMR stopped broadcasting after an observer rejected')
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
