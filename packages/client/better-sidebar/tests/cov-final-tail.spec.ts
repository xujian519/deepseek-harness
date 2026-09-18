/**
 * Final coverage round for the sidebar client's dependency-free tail: the
 * turn walk's error skip (a FAILED tool result before the closing assistant,
 * which the earlier round only reached after the walk had already returned)
 * and its turn-less nodes, the locale fallbacks (a key no dictionary
 * defines, a navigator without a language, and every relative-time bucket),
 * and the image rewriter's sentinel restore for a sequence no mask produced.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { producedForClosing } from '../src/client/produced-files.ts'
import { attachLocale, relativeTime, t, type CopyKey } from '../src/client/locales.ts'
import { rewriteLocalImageUrls } from '../src/client/markdown-images.ts'

/** A diff-card tool result reporting one produced path. */
const diffResult = (path: string, isError = false): unknown => ({
  kind: 'tool-result',
  isError,
  callView: { card: 'diff', locations: [{ path }] },
})

/** Point the browser-language fallback at a language (or a navigator without one). */
function stubNavigator(language: unknown): void {
  Object.defineProperty(globalThis, 'navigator', {
    value: language === undefined ? {} : { language },
    configurable: true,
  })
}

beforeEach(() => {
  attachLocale(undefined)
  stubNavigator('en-US')
})

afterEach(() => {
  attachLocale(undefined)
})

describe('producedForClosing tool-result errors', () => {
  it('skips a failed tool result before the closing assistant and keeps the earlier paths', () => {
    const nodes = [
      diffResult('kept.ts'),
      diffResult('failed.ts', true),
      { kind: 'assistant', seq: 7, turn: 1 },
    ]
    expect(producedForClosing(nodes, 7)).toEqual(['kept.ts'])
  })

  it('a failed result at the tail of the turn contributes nothing', () => {
    const nodes = [
      { kind: 'assistant', seq: 1, turn: 1 },
      diffResult('only.ts', true),
      { kind: 'assistant', seq: 2, turn: 1 },
    ]
    expect(producedForClosing(nodes, 2)).toEqual([])
  })

  it('a node without a turn number neither resets the pending list nor advances the turn', () => {
    const nodes = [
      diffResult('a.ts'),
      { kind: 'notice', seq: 4 },
      { kind: 'assistant', seq: 5 },
    ]
    expect(producedForClosing(nodes, 5)).toEqual(['a.ts'])
  })
})

describe('locale fallbacks', () => {
  it('returns the key itself when no dictionary defines it', () => {
    const missing = 'definitely-not-a-copy-key' as unknown as CopyKey
    expect(t(missing)).toBe('definitely-not-a-copy-key')
    expect(t(missing, { n: 1 })).toBe('definitely-not-a-copy-key')
  })

  it('a navigator without a language falls back to English', () => {
    stubNavigator(undefined)
    expect(t('explorer')).toBe('Explorer')
  })

  it('interpolates the given placeholders and leaves unlisted ones literal', () => {
    expect(t('uploadProgress', { done: 2, total: 5, name: 'a.ts' })).toBe('Uploading 2/5: a.ts')
    expect(t('uploadProgress', { done: 2, total: 5 })).toBe('Uploading 2/5: {name}')
  })
})

describe('markdown image masking', () => {
  const SCOPE = { sessionId: 's1', cwd: '/ws' }
  const ORIGIN = 'http://127.0.0.1:3080'

  it('drops a literal NUL-sentinel sequence that no code mask produced', () => {
    const text = 'a\u00009\u0000b'
    expect(rewriteLocalImageUrls(text, SCOPE, '/ws/README.md', ORIGIN)).toBe('ab')
  })
})

describe('relativeTime buckets', () => {
  const agoMs = (ms: number): string => new Date(Date.now() - ms).toISOString()

  it('returns an unparsable input unchanged', () => {
    expect(relativeTime('not a date')).toBe('not a date')
    expect(relativeTime('')).toBe('')
  })

  it('labels just-now, minutes, hours and yesterday by elapsed time', () => {
    expect(relativeTime(agoMs(5_000))).toBe('just now')
    expect(relativeTime(agoMs(5 * 60_000))).toBe('5 min ago')
    expect(relativeTime(agoMs(3 * 3_600_000))).toBe('3 h ago')
    expect(relativeTime(agoMs(30 * 3_600_000))).toBe('yesterday')
  })

  it('dates anything older than two days', () => {
    const stamp = new Date(Date.now() - 5 * 86_400_000)
    const pad = (value: number): string => String(value).padStart(2, '0')
    expect(relativeTime(stamp.toISOString()))
      .toBe(`${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())}`)
  })
})
