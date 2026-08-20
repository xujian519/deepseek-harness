import { describe, expect, it } from 'vitest'
import { EvolveProposalId, FailurePatternId, SelfEvolveRunId } from '../src/brand.ts'

describe('self-evolve identity brands', () => {
  it('SelfEvolveRunId brands an opaque run identity', () => {
    const id = SelfEvolveRunId('run-abc')
    expect(id).toBe('run-abc')
  })

  it('FailurePatternId brands an opaque pattern identity', () => {
    const id = FailurePatternId('L1-skill:abc12345')
    expect(id).toBe('L1-skill:abc12345')
  })

  it('EvolveProposalId brands an opaque proposal identity', () => {
    const id = EvolveProposalId('prop-1')
    expect(id).toBe('prop-1')
  })
})
