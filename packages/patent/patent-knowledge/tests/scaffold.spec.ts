import { describe, expect, it } from 'vitest'
import * as Pkg from '@deepseek-ai/dsh-patent-knowledge'

describe('@deepseek-ai/dsh-patent-knowledge surface', () => {
  it('default-exports its service class', () => {
    expect(typeof Pkg.default).toBe('function')
  })

  it('exports the query-layer API surface for consumers', () => {
    expect(typeof Pkg.openKnowledgeDb).toBe('function')
    expect(typeof Pkg.KnowledgeDbVersionError).toBe('function')
    expect(typeof Pkg.CaseLawSearchEngine).toBe('function')
    expect(typeof Pkg.KnowledgeLawSearch).toBe('function')
    expect(typeof Pkg.WikiCardLoader).toBe('function')
    expect(typeof Pkg.KgStore).toBe('function')
    expect(typeof Pkg.PatentKgAdapter).toBe('function')
    expect(typeof Pkg.classifyIpc).toBe('function')
    expect(typeof Pkg.classifyIpcTop).toBe('function')
    expect(typeof Pkg.extractLawKeywords).toBe('function')
    expect(typeof Pkg.installKnowledgeDb).toBe('function')
    expect(typeof Pkg.loadIpcStandards).toBe('function')
    expect(typeof Pkg.compressChunk).toBe('function')
    expect(typeof Pkg.decompressChunk).toBe('function')
  })
})
