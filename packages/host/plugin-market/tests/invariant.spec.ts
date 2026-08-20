/**
 * Tests for the plugin-market invariant companion: the package-name
 * reservation and its release on disposal (HMR safety).
 */

import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { describe, expect, it } from 'vitest'
import * as MarketInvariant from '../src/invariant.ts'

describe('plugin-market invariant companion', () => {
  it('reserves the package name and re-registers after disposal (HMR safety)', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(MarketInvariant)

    expect(() => {
      ctx.invariants.register('@deepseek-ai/dsh-host-plugin-market', () => {})
    }).toThrow(/already registered/u)

    await fiber.dispose()
    await expect(ctx.plugin(MarketInvariant).await()).resolves.toBeDefined()
    await ctx.fiber.dispose()
  })
})
