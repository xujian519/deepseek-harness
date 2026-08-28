// @vitest-environment jsdom
/**
 * Mermaid sanitizer coverage round for the failure paths the XML parser
 * cannot express in source text: a parser that throws (the try/catch around
 * parseFromString), and the `@*` attribute branch — XML forbids `@` in
 * attribute names, so a source string can never carry one past a real XML
 * parser; the strip list exists for lenient parsers, which the stubbed
 * DOMParser stands in for by injecting the attribute after the parse.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sanitizeSvg } from '../src/client/mermaid-sanitize.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('sanitizeSvg parser failure paths', () => {
  it('returns empty when the parser throws instead of producing a document', () => {
    const real = globalThis.DOMParser
    vi.stubGlobal('DOMParser', class {
      parseFromString(): Document {
        throw new Error('parser exploded')
      }
    })
    expect(sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"/>')).toBe('')
    expect(real).toBeDefined()
  })

  it('strips a Vue-style `@` directive attribute injected by a lenient parser', () => {
    const RealDOMParser = globalThis.DOMParser
    vi.stubGlobal('DOMParser', class {
      parseFromString(source: string, type: DOMParserSupportedType): Document {
        const doc = new RealDOMParser().parseFromString(source, type)
        // Stand-in for a lenient parse: the XML parser rejects `@attr` at
        // parse time (and setAttribute validates names), so the attribute
        // arrives the only way a lenient parser could deliver it — re-parsed
        // as HTML, where `@click` is a legal attribute name, and imported
        // into the XML document wholesale.
        const lenient = new RealDOMParser().parseFromString(
          '<svg><text @click="evil()">hi</text></svg>',
          'text/html',
        )
        const svg = doc.importNode(lenient.querySelector('svg')!, true)
        doc.replaceChild(svg, doc.documentElement)
        return doc
      }
    })
    const out = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><text>hi</text></svg>')
    expect(out).not.toContain('@click')
    expect(out).not.toContain('evil')
    expect(out).toContain('<text>hi</text>')
  })

  it('removes href and xlink:href from links (parsable XML form)', () => {
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">',
      '<a href="https://example.com/nav" xlink:href="https://example.com/x">x</a>',
      '</svg>',
    ].join('')
    const out = sanitizeSvg(svg)
    expect(out).not.toContain('href')
    expect(out).toContain('<a>x</a>')
  })
})
