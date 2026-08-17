import { describe, expect, it } from 'vitest'
import * as Pkg from '@deepseek-ai/dsh-tool-literature'

describe('@deepseek-ai/dsh-tool-literature surface', () => {
  it('exports the function-plugin surface', () => {
    expect(Pkg.name).toBe('tool-literature')
    expect(Pkg.inject).toEqual(['tools'])
    expect(typeof Pkg.apply).toBe('function')
    expect('default' in Pkg).toBe(false)
  })

  it('exports the public API surface for consumers', () => {
    expect(typeof Pkg.ConnectorRegistry).toBe('function')
    expect(typeof Pkg.createLiteratureRegistry).toBe('function')
    expect(typeof Pkg.LiteratureToolError).toBe('function')
    expect(typeof Pkg.createPaperSearchTool).toBe('function')
    expect(typeof Pkg.createPaperListSourcesTool).toBe('function')
    expect(Pkg.Config).toBeDefined()
  })
})
