import { describe, expect, it } from 'vitest'
import * as Pkg from '@deepseek-ai/dsh-browser-backend'

describe('@deepseek-ai/dsh-browser-backend surface', () => {
  it('exports the routing and backend factories', () => {
    expect(typeof Pkg.buildBackendCandidates).toBe('function')
    expect(typeof Pkg.resolveBrowserBackend).toBe('function')
    expect(typeof Pkg.probeAllBackends).toBe('function')
    expect(typeof Pkg.createEgoBackend).toBe('function')
    expect(typeof Pkg.createBrowserOsNeoBackend).toBe('function')
    expect(typeof Pkg.createBrowserUseBackend).toBe('function')
    expect(typeof Pkg.createPlaywrightBackend).toBe('function')
    expect(typeof Pkg.BrowserUseExtractor).toBe('function')
    expect(typeof Pkg.EgoExtractor).toBe('function')
    expect(Pkg.BROWSEROS_NEO_DEFAULT_URL).toBe('http://127.0.0.1:9010/mcp')
  })
})
