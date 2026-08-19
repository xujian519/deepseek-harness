import { describe, expect, it } from 'vitest'
import { ConnectorRegistry } from '../../src/runtime/connector-registry.ts'
import { createLiteratureRegistry } from '../../src/runtime/create-literature-registry.ts'
import type { Connector } from '../../src/protocol/types.ts'

const STUB: Connector = {
  id: 'stub',
  name: 'Stub',
  domain: 'literature',
  description: 'stub source',
  search: async () => [],
}

describe('ConnectorRegistry', () => {
  it('registers once and rejects duplicate ids', () => {
    const registry = new ConnectorRegistry()
    registry.register(STUB)
    expect(() => { registry.register(STUB) }).toThrow('Connector "stub" is already registered')
    expect(registry.get('stub')).toBe(STUB)
    expect(registry.get('missing')).toBeUndefined()
    expect(registry.all()).toEqual([STUB])
    expect(registry.catalog()).toEqual([{ id: 'stub', name: 'Stub', domain: 'literature', description: 'stub source' }])
  })
})

describe('createLiteratureRegistry', () => {
  it('assembles all four sources by default', () => {
    const registry = createLiteratureRegistry()
    expect(registry.catalog().map(e => e.id).sort()).toEqual(['arxiv', 'crossref', 'openalex', 'semantic-scholar'])
  })

  it('skips sources disabled in the options', () => {
    const registry = createLiteratureRegistry({ arxiv: false, openalex: false, semanticScholar: false })
    expect(registry.catalog().map(e => e.id)).toEqual(['crossref'])
  })
})
