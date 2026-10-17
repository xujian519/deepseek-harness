// Real-service test: mounts the patent-data plugin on a real Context and checks
// the nuo request-channel choice it writes into the process environment.
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import PatentData, { NUO_EGO_BROWSER_ENV, applyNuoRequestChannel } from '@deepseek-ai/dsh-patent-data'

const saved = process.env[NUO_EGO_BROWSER_ENV]

/** Unset the channel variable without a computed `delete`. */
function clearChannelEnv(): void {
  Reflect.deleteProperty(process.env, NUO_EGO_BROWSER_ENV)
}

afterEach(() => {
  if (saved === undefined) clearChannelEnv()
  else process.env[NUO_EGO_BROWSER_ENV] = saved
})

describe('nuo request channel', () => {
  it('leaves the environment untouched for auto', () => {
    clearChannelEnv()
    expect(applyNuoRequestChannel('auto')).toBeUndefined()
    expect(process.env[NUO_EGO_BROWSER_ENV]).toBeUndefined()
  })

  it('forces the plain fetch for native and restores the previous value', () => {
    clearChannelEnv()
    const restore = applyNuoRequestChannel('native')
    expect(process.env[NUO_EGO_BROWSER_ENV]).toBe('0')
    restore?.()
    expect(process.env[NUO_EGO_BROWSER_ENV]).toBeUndefined()
  })

  it('restores a previously set value after the browser path', () => {
    process.env[NUO_EGO_BROWSER_ENV] = '0'
    const restore = applyNuoRequestChannel('browser')
    expect(process.env[NUO_EGO_BROWSER_ENV]).toBe('1')
    restore?.()
    expect(process.env[NUO_EGO_BROWSER_ENV]).toBe('0')
  })

  it('does not overwrite a value that changed after this mount wrote it', () => {
    clearChannelEnv()
    const restore = applyNuoRequestChannel('native')
    process.env[NUO_EGO_BROWSER_ENV] = '1'
    restore?.()
    expect(process.env[NUO_EGO_BROWSER_ENV]).toBe('1')
  })

  it('applies the configured channel when the service is mounted and restores it on disposal', async () => {
    clearChannelEnv()
    const ctx = new Context()
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(PatentData, { nuoRequestChannel: 'native' })
    try {
      expect(process.env[NUO_EGO_BROWSER_ENV]).toBe('0')
    } finally {
      await ctx.fiber.dispose()
    }
    expect(process.env[NUO_EGO_BROWSER_ENV]).toBeUndefined()
  })

  it('leaves an explicit choice from another mount in place when mounting auto', async () => {
    clearChannelEnv()
    const nativeCtx = new Context()
    const autoCtx = new Context()
    let autoDisposed = false
    try {
      await nativeCtx.plugin(LocalSubprocessRuntime)
      await nativeCtx.plugin(PatentData, { nuoRequestChannel: 'native' })
      await autoCtx.plugin(LocalSubprocessRuntime)
      await autoCtx.plugin(PatentData)
      expect(process.env[NUO_EGO_BROWSER_ENV]).toBe('0')

      await autoCtx.fiber.dispose()
      autoDisposed = true
      expect(process.env[NUO_EGO_BROWSER_ENV]).toBe('0')
    } finally {
      await nativeCtx.fiber.dispose()
      if (!autoDisposed) await autoCtx.fiber.dispose()
    }
    expect(process.env[NUO_EGO_BROWSER_ENV]).toBeUndefined()
  })

  it('defaults the field to auto', () => {
    expect(PatentData.Config({}).nuoRequestChannel).toBe('auto')
  })
})
