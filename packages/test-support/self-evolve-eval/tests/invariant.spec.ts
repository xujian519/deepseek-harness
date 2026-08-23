import { describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/invariant.ts'

describe('invariant companion', () => {
  it('registers package ownership with the invariants service and returns its disposer', async () => {
    const register = vi.fn(() => 'disposer')
    const ctx = { invariants: { register } } as never
    const disposer = await apply(ctx)
    expect(register).toHaveBeenCalledWith('@deepseek-ai/dsh-self-evolve-eval', expect.any(Function))
    expect(disposer).toBe('disposer')
  })

  it('declares the invariants service as an injection', () => {
    expect(inject).toEqual(['invariants'])
  })
})
