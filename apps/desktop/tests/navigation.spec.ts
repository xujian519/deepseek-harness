/**
 * Navigation policy tests: the window must only navigate within the exact
 * backend origin, never a prefix look-alike.
 */

import { describe, expect, it } from 'vitest'
import { isWithinBackendOrigin } from '../src/navigation.ts'

const ORIGIN = 'http://127.0.0.1:8080'

describe('isWithinBackendOrigin', () => {
  it('accepts URLs inside the backend origin', () => {
    expect(isWithinBackendOrigin(ORIGIN, ORIGIN)).toBe(true)
    expect(isWithinBackendOrigin(`${ORIGIN}/app`, ORIGIN)).toBe(true)
  })

  it('rejects a look-alike host that shares the prefix', () => {
    expect(isWithinBackendOrigin('http://127.0.0.1.evil.com', ORIGIN)).toBe(false)
    expect(isWithinBackendOrigin('http://127.0.0.1.evil.com/x', ORIGIN)).toBe(false)
  })

  it('rejects a different scheme, host, or port', () => {
    expect(isWithinBackendOrigin('https://127.0.0.1:8080', ORIGIN)).toBe(false)
    expect(isWithinBackendOrigin('http://127.0.0.1:8081', ORIGIN)).toBe(false)
    expect(isWithinBackendOrigin('http://localhost:8080', ORIGIN)).toBe(false)
  })

  it('rejects unparseable URLs', () => {
    expect(isWithinBackendOrigin('not a url', ORIGIN)).toBe(false)
    expect(isWithinBackendOrigin('', ORIGIN)).toBe(false)
  })
})
