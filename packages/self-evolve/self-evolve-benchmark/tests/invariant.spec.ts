import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as BenchmarkInvariant from '../src/invariant.ts'

describe('self-evolve-benchmark invariant companion', () => {
  it('registers its package ownership with the invariants service', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(BenchmarkInvariant)
    // A duplicate registration fails loud, proving the first one took.
    await expect(ctx.plugin(BenchmarkInvariant)).rejects.toThrow(/already registered/)
    expect(BenchmarkInvariant.name).toBe('self-evolve-benchmark-invariant')
    expect(BenchmarkInvariant.inject).toEqual(['invariants'])
  })
})
