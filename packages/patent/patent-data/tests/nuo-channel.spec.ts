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
    applyNuoRequestChannel('auto')
    expect(process.env[NUO_EGO_BROWSER_ENV]).toBeUndefined()
  })

  it('forces the plain fetch for native and the browser path for browser', () => {
    applyNuoRequestChannel('native')
    expect(process.env[NUO_EGO_BROWSER_ENV]).toBe('0')
    applyNuoRequestChannel('browser')
    expect(process.env[NUO_EGO_BROWSER_ENV]).toBe('1')
  })

  it('applies the configured channel when the service is mounted', async () => {
    clearChannelEnv()
    const ctx = new Context()
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(PatentData, { nuoRequestChannel: 'native' })
    try {
      expect(process.env[NUO_EGO_BROWSER_ENV]).toBe('0')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('defaults the field to auto', () => {
    expect(PatentData.Config({}).nuoRequestChannel).toBe('auto')
  })
})
