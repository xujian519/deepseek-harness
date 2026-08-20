import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as ToolInvariant from '../src/invariant.ts'

describe('tool-self-evolve invariant companion', () => {
  it('registers its package ownership with the invariants service', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(ToolInvariant)
    // A duplicate registration fails loud, proving the first one took.
    await expect(ctx.plugin(ToolInvariant)).rejects.toThrow(/already registered/)
    expect(ToolInvariant.name).toBe('tool-self-evolve-invariant')
    expect(ToolInvariant.inject).toEqual(['invariants'])
  })
})
