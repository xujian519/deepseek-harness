/**
 * Mermaid sanitizer coverage round for the guards the jsdom lane cannot
 * reach: the node test lane has no DOMParser/XMLSerializer at all, so the
 * sanitizer must keep returning '' there instead of throwing.
 */
import { describe, expect, it } from 'vitest'
import { sanitizeSvg } from '../src/client/mermaid-sanitize.ts'

describe('sanitizeSvg without DOM globals', () => {
  it('returns empty when the platform lacks DOMParser or XMLSerializer', () => {
    expect(typeof (globalThis as Record<string, unknown>).DOMParser).toBe('undefined')
    expect(sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"/>')).toBe('')
  })
})
