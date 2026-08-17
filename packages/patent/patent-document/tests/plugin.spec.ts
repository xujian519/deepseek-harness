import { describe, expect, it } from 'vitest'
import * as Pkg from '@deepseek-ai/dsh-patent-document'

describe('@deepseek-ai/dsh-patent-document plugin surface', () => {
  it('exports the function-plugin surface', () => {
    expect(Pkg.name).toBe('patent-document')
    expect(Pkg.inject).toEqual(['tools', 'subprocess'])
    expect(typeof Pkg.apply).toBe('function')
    expect(typeof Pkg.Config).toBe('function')
  })

  it('exports the document engine and tool factory', () => {
    expect(typeof Pkg.renderPatentDocument).toBe('function')
    expect(typeof Pkg.renderPdf).toBe('function')
    expect(typeof Pkg.findChrome).toBe('function')
    expect(typeof Pkg.buildBrandStyle).toBe('function')
    expect(typeof Pkg.mergeBrand).toBe('function')
    expect(typeof Pkg.loadBrandFromPath).toBe('function')
    expect(typeof Pkg.DocumentRenderError).toBe('function')
    expect(typeof Pkg.createRenderPatentDocumentTool).toBe('function')
    expect(typeof Pkg.renderDocumentResult).toBe('function')
    expect(Pkg.DEFAULT_OUTPUT_DIR).toBe('.dsh/documents')
  })
})
