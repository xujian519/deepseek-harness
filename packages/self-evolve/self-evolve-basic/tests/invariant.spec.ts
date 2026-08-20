import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as BasicInvariant from '../src/invariant.ts'

describe('self-evolve-basic invariant companion', () => {
  it('registers its package ownership with the invariants service', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(BasicInvariant)
    // A duplicate registration fails loud, proving the first one took.
    await expect(ctx.plugin(BasicInvariant)).rejects.toThrow(/already registered/)
    expect(BasicInvariant.name).toBe('self-evolve-basic-invariant')
    expect(BasicInvariant.inject).toEqual(['invariants'])
  })
})
