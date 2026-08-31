import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as PluginMarketControllerInvariant from '../src/invariant.ts'

describe('api-plugin-market-controller invariant companion', () => {
  it('reserves the package name against duplicate registration', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(PluginMarketControllerInvariant)

    expect(() => {
      ctx.invariants.register('@deepseek-ai/dsh-api-plugin-market-controller', () => {})
    }).toThrow(/already registered/)
  })
})
