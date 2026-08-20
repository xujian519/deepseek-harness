import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import PromptCache from '@deepseek-ai/dsh-prompt-cache'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import type { PromptCache as PromptCacheIface } from '@deepseek-ai/dsh-system-prompt/prompt-cache'
import { apply, verifyRoundTrip } from '@deepseek-ai/dsh-prompt-cache/invariant'

describe('prompt-cache round-trip invariant', () => {
  it('passes for a healthy service without touching real entries', async () => {
    const ctx = new Context()
    await ctx.plugin(PromptCache, { ttlMs: 10000 })
    // A real global-scope entry set before the probe survives the cleanup.
    const realKey = { scope: undefined, signature: 'real', configFingerprint: 'real' }
    await ctx.promptCache.set(realKey, [{ name: 'a', text: 'A' }])
    await verifyRoundTrip(ctx.promptCache, (message): never => { throw new Error(message) })
    expect(await ctx.promptCache.get(realKey)).toEqual([{ name: 'a', text: 'A' }])
  })

  it('fails when the served sections do not match the set sections', async () => {
    const corrupt: PromptCacheIface = {
      async get() { return [{ name: 'wrong', text: 'X' }] },
      async set() {},
      async invalidate() {},
    }
    await expect(verifyRoundTrip(corrupt, (message): never => { throw new Error(message) }))
      .rejects.toThrow(/round-trip/)
  })

  it('mounts as a companion and runs the probe when prompt-cache is present', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(PromptCache, { ttlMs: 10000 })
    const dispose = await apply(ctx)
    // The probe ran (the round-trip entry was set and invalidated); a second
    // registration of the same package must be rejected.
    expect(() => ctx.invariants.register('@deepseek-ai/dsh-prompt-cache', () => {})).toThrow(/already registered/)
    dispose()
  })

  it('skips the probe when no prompt-cache service is mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const dispose = await apply(ctx)
    dispose()
  })
})
