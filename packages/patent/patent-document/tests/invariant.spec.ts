import { describe, expect, it } from 'vitest'
import * as Inv from '@deepseek-ai/dsh-patent-document/invariant'

describe('invariant companion', () => {
  it('exports the companion surface', () => {
    expect(Inv.name).toBe('patent-document-invariant')
    expect(Inv.inject).toEqual(['invariants'])
    expect(typeof Inv.apply).toBe('function')
  })
})
