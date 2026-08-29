/**
 * Coverage round for the markdown-preview HTML splitter: the empty-input
 * guard, the invalid-fence info-string escape (a backtick fence whose info
 * contains a backtick is plain text, not a fence), and the single-line HTML
 * comment that opens and closes on the same line.
 */
import { describe, expect, it } from 'vitest'
import { analyzeMarkdownHtml, splitHtmlBlocks } from '../src/client/markdown-html.ts'

describe('splitHtmlBlocks degenerate inputs', () => {
  it('splits nothing for empty input', () => {
    expect(splitHtmlBlocks('')).toEqual([])
    expect(analyzeMarkdownHtml('')).toEqual({
      segments: [],
      hasBlockHtml: false,
      hasInlineHtml: false,
      referenceDefinitions: '',
    })
  })

  it('treats a backtick-fence line with backticks in its info as plain text', () => {
    // CommonMark: such a line opens no fence, so the HTML-looking line below
    // it is a real HTML run, not code content.
    const segments = splitHtmlBlocks(['```a`b', 'c', '<div>x</div>', '', 'tail'].join('\n'))
    expect(segments.map(segment => segment.kind)).toEqual(['markdown', 'html', 'markdown'])
    expect(segments[0]?.text).toBe('```a`b\nc')
    expect(segments[1]?.text).toBe('<div>x</div>')
    expect(segments[2]?.text).toBe('tail')
  })

  it('a comment that closes on its opening line forms a one-line run', () => {
    const segments = splitHtmlBlocks(['before', '<!-- note -->', 'after'].join('\n'))
    expect(segments.map(segment => segment.kind)).toEqual(['markdown', 'html', 'markdown'])
    expect(segments[1]?.text).toBe('<!-- note -->')
  })
})
