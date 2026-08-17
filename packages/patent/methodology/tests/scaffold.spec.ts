import { describe, expect, it } from 'vitest'
import * as Pkg from '@deepseek-ai/dsh-methodology'

describe('@deepseek-ai/dsh-methodology surface', () => {
  it('exports the function-plugin surface', () => {
    expect(Pkg.name).toBe('methodology')
    expect(Pkg.inject).toEqual(['tools', 'systemPrompt'])
    expect(typeof Pkg.apply).toBe('function')
    expect('default' in Pkg).toBe(false)
  })

  it('exports the public API surface for consumers', () => {
    expect(typeof Pkg.MethodologyRegistry).toBe('function')
    expect(typeof Pkg.injectMethodology).toBe('function')
    expect(typeof Pkg.extractMethodologyKeywords).toBe('function')
    expect(typeof Pkg.lookupMatrixCell).toBe('function')
    expect(typeof Pkg.loadMatrix).toBe('function')
    expect(typeof Pkg.loadPrinciples).toBe('function')
    expect(typeof Pkg.createTrizTool).toBe('function')
    expect(Pkg.fiveWhys).toBeDefined()
    expect(Pkg.mece).toBeDefined()
    expect(Pkg.swot).toBeDefined()
    expect(Pkg.pdca).toBeDefined()
    expect(Pkg.fishbone).toBeDefined()
    expect(Pkg.firstPrinciples).toBeDefined()
    expect(Pkg.sixHats).toBeDefined()
    expect(Pkg.triz).toBeDefined()
    expect(Pkg.Config).toBeDefined()
  })
})
