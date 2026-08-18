/**
 * Desktop-surface bundle glue: the runtime plugin mounts without throwing and
 * the invariant companion registers a disposer.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/index.ts'
import { apply as applyInvariant, inject, name } from '../src/invariant.ts'

describe('dsh-desktop-app glue', () => {
  it('apply mounts without throwing', () => {
    expect(() => { apply(new Context()) }).not.toThrow()
  })

  it('invariant companion registers a disposer', async () => {
    const ctx = {
      invariants: { register: () => () => {} },
    } as unknown as Context
    const disposer = await applyInvariant(ctx)
    expect(disposer).toBeTypeOf('function')
    expect(name).toBe('desktop-app-invariant')
    expect(inject).toEqual(['invariants'])
  })
})
