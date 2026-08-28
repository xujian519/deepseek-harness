/**
 * Terminal font coverage round for the quoted-family escape handling in the
 * stack splitter: a backslash escape inside a quoted family keeps the quote
 * open (`\"` is not a closing quote), and a trailing backslash inside an
 * unterminated quote degrades to a literal character instead of throwing.
 */
import { describe, expect, it } from 'vitest'
import { withIconFontFallbacks } from '../src/client/terminal-font.ts'

describe('splitFamilies escape handling', () => {
  it('an escaped quote inside a quoted family does not close the quote', () => {
    // The stack entry `"Foo\"Bar"` survives as ONE family: the `\"` is copied
    // verbatim and the real closing quote comes after `Bar`.
    const stack = withIconFontFallbacks('"Foo\\"Bar", monospace')
    expect(stack).toContain('"Foo\\"Bar"')
    // The generic still trails the icon fonts (splice-before-generic held).
    expect(stack.split(',').map(part => part.trim()).pop()).toBe('monospace')
  })

  it('a trailing backslash inside an unterminated quote stays a literal character', () => {
    const stack = withIconFontFallbacks('"Foo\\')
    expect(stack).toContain('"Foo\\')
    // The degenerate entry still keeps its slot ahead of the icon fallbacks.
    expect(stack.startsWith('"Foo\\')).toBe(true)
  })
})
