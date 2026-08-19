/**
 * Tests for the desktop-shell invariant companion: the package-name
 * reservation and its release on disposal (HMR safety).
 */

import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { describe, expect, it } from 'vitest'
import * as DesktopShellInvariant from '../src/invariant.ts'

describe('desktop-shell invariant companion', () => {
  it('reserves the package name and re-registers after disposal (HMR safety)', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(DesktopShellInvariant)

    expect(() => {
      ctx.invariants.register('@deepseek-ai/dsh-desktop-shell', () => {})
    }).toThrow(/already registered/u)

    await fiber.dispose()
    await expect(ctx.plugin(DesktopShellInvariant).await()).resolves.toBeDefined()
    await ctx.fiber.dispose()
  })
})
