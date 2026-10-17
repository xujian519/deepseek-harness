import { describe, expect, it } from 'vitest'
import * as Pkg from '@deepseek-ai/dsh-methodology'

describe('@deepseek-ai/dsh-methodology surface', () => {
  it('exports the function-plugin surface', () => {
    expect(Pkg.name).toBe('methodology')
    expect(Pkg.inject).toEqual(['tools', 'systemPrompt'])
    expect(typeof Pkg.apply).toBe('function')
    expect('default' in Pkg).toBe(false)
  })

  it('exports the TRIZ tool and data API', () => {
    expect(typeof Pkg.lookupMatrixCell).toBe('function')
    expect(typeof Pkg.loadMatrix).toBe('function')
    expect(typeof Pkg.loadPrinciples).toBe('function')
    expect(typeof Pkg.loadSeparations).toBe('function')
    expect(typeof Pkg.createTrizTool).toBe('function')
    expect(Pkg.ENGINEERING_PARAMS).toHaveLength(39)
    expect(Pkg.Config).toBeDefined()
  })

  it('no longer exports the unused methodology registry', () => {
    expect('MethodologyRegistry' in Pkg).toBe(false)
    expect('injectMethodology' in Pkg).toBe(false)
    expect('DEFAULT_METHODOLOGY_COMPONENTS' in Pkg).toBe(false)
    expect('extractMethodologyKeywords' in Pkg).toBe(false)
    expect('detectParamNumbers' in Pkg).toBe(false)
    expect('fiveWhys' in Pkg).toBe(false)
    expect('triz' in Pkg).toBe(false)
  })
})
