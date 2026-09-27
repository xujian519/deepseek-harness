import { describe, expect, it } from 'vitest'
import { causeDiagnostic } from '../src/cause-diagnostic.ts'

/** Wrap `leaf` in `depth` plain cause links. */
function chained(depth: number, leaf: unknown): unknown {
  let current = leaf
  for (let index = 0; index < depth; index += 1) current = new Error(`wrapper ${String(index)}`, { cause: current })
  return current
}

/** Platform-shaped error carrying its stable code as an own data property. */
function coded(code: string, message: string, cause?: unknown): Error {
  return Object.assign(new Error(message, cause === undefined ? {} : { cause }), { code })
}

describe('cause diagnostics', () => {
  it('names the coded error behind a wrapper', () => {
    expect(causeDiagnostic(coded('UND_ERR_SOCKET', 'other side closed')))
      .toBe('UND_ERR_SOCKET: other side closed')
  })

  it('walks fetch-style wrappers to the coded platform error', () => {
    expect(causeDiagnostic(new TypeError('fetch failed', { cause: coded('ECONNRESET', 'socket hang up') })))
      .toBe('ECONNRESET: socket hang up')
    expect(causeDiagnostic(chained(3, new TypeError('fetch failed', { cause: coded('ETIMEDOUT', 'connect ETIMEDOUT') }))))
      .toBe('ETIMEDOUT: connect ETIMEDOUT')
  })

  it('collapses whitespace and reports a code with no message', () => {
    expect(causeDiagnostic(coded('ETIMEDOUT', 'connect ETIMEDOUT\n  127.0.0.1:1')))
      .toBe('ETIMEDOUT: connect ETIMEDOUT 127.0.0.1:1')
    expect(causeDiagnostic(coded('ENOTFOUND', '   '))).toBe('ENOTFOUND')
    expect(causeDiagnostic({ code: 'E_NOMSG' })).toBe('E_NOMSG')
  })

  it('stops at the first coded error', () => {
    expect(causeDiagnostic(coded('E_OUTER', 'outer', coded('E_INNER', 'inner')))).toBe('E_OUTER: outer')
  })

  it('bounds the retained diagnostic to one line', () => {
    const diagnostic = causeDiagnostic(coded('UND_ERR_SOCKET', 'x'.repeat(400))) ?? ''
    expect(diagnostic).toHaveLength(200)
    expect(diagnostic.endsWith('…')).toBe(true)
  })

  it('reports nothing without a coded cause', () => {
    expect(causeDiagnostic(undefined)).toBeUndefined()
    expect(causeDiagnostic('ECONNRESET')).toBeUndefined()
    expect(causeDiagnostic(new Error('plain'))).toBeUndefined()
    expect(causeDiagnostic(new Error('outer', { cause: new Error('inner') }))).toBeUndefined()
    expect(causeDiagnostic(new Error('primitive cause', { cause: 'ECONNRESET' }))).toBeUndefined()
    expect(causeDiagnostic(coded('', 'unusable code'))).toBeUndefined()
    expect(causeDiagnostic(Object.assign(new Error('numeric code'), { code: 42 }))).toBeUndefined()
  })

  it('stops at a cause chain deeper than its bound', () => {
    expect(causeDiagnostic(chained(7, coded('E_DEEP', 'deep')))).toBe('E_DEEP: deep')
    expect(causeDiagnostic(chained(8, coded('E_TOO_DEEP', 'deep')))).toBeUndefined()
  })

  it('treats accessor-backed and hostile reflection as absent', () => {
    const accessorCode = Object.defineProperty(new Error('provider failed'), 'code', { get: () => 'E_GATED' })
    expect(causeDiagnostic(accessorCode)).toBeUndefined()
    const accessorCause = Object.defineProperty(new Error('provider failed'), 'cause', {
      get: () => coded('E_GATED', 'gated'),
    })
    expect(causeDiagnostic(accessorCause)).toBeUndefined()
    expect(causeDiagnostic(new Proxy(new Error('provider failed'), {
      getOwnPropertyDescriptor() { throw new Error('reflection failed') },
    }))).toBeUndefined()
  })
})
