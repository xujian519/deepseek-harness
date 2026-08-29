/**
 * Theme access without a DOM (SSR / workers): the guarded reads must resolve
 * to their conservative defaults instead of crashing — dark scheme, empty
 * token values, and a no-op subscription disposer.
 */
import { describe, expect, it } from 'vitest'
import { isDarkScheme, subscribeColorScheme, tokenValue } from '../src/client/theme.ts'

describe('theme access without a document', () => {
  it('isDarkScheme reports true without a document (no palette to read)', () => {
    expect(typeof document).toBe('undefined')
    expect(isDarkScheme()).toBe(true)
  })

  it('tokenValue returns the empty fallback', () => {
    expect(tokenValue('--dsw-any')).toBe('')
  })

  it('subscribeColorScheme degrades to a no-op disposer', () => {
    const dispose = subscribeColorScheme(() => {})
    expect(() => { dispose() }).not.toThrow()
  })
})
