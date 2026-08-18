import { describe, expect, it } from 'vitest'
import { xmlAttr, xmlBlocks, xmlSelfClosing, xmlText } from '../../../src/runtime/shared/xml.ts'

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/1706.03762v7</id>
    <title>Attention Is All You Need</title>
    <summary>   The dominant sequence transduction models &amp; are based on complex recurrent networks.   </summary>
    <author><name>Ashish Vaswani</name></author>
    <author><name>Noam Shazeer</name></author>
    <published>2017-06-12T00:00:00Z</published>
    <arxiv:primary_category term="cs.CL"/>
    <link title="pdf" href="http://arxiv.org/pdf/1706.03762v7" rel="related" type="application/pdf"/>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2001.00001</id>
    <title>Second Paper</title>
    <link title="pdf" href="http://arxiv.org/pdf/2001.00001"/>
  </entry>
</feed>`

describe('xml helpers', () => {
  it('xmlBlocks extracts every entry block', () => {
    const blocks = xmlBlocks(FEED, 'entry')
    expect(blocks.length).toBe(2)
    expect(blocks[0]!.includes('Attention Is All You Need')).toBe(true)
  })

  it('xmlText returns first inner text, entity-decoded and whitespace-collapsed', () => {
    expect(xmlText(FEED, 'title')).toBe('Attention Is All You Need')
    expect(xmlText(FEED, 'summary')).toBe('The dominant sequence transduction models & are based on complex recurrent networks.')
    expect(xmlText(FEED, 'missing')).toBeUndefined()
    expect(xmlText('<title>   </title>', 'title')).toBeUndefined()
  })

  it('xmlAttr reads attribute on namespaced self-closing tag', () => {
    expect(xmlAttr(FEED, 'arxiv:primary_category', 'term')).toBe('cs.CL')
    expect(xmlAttr(FEED, 'arxiv:primary_category', 'nope')).toBeUndefined()
  })

  it('xmlSelfClosing finds self-closing links with attribute maps', () => {
    const links = xmlSelfClosing(FEED, 'link')
    expect(links.length).toBe(2)
    const pdf = links.find(l => (l.attrs.title ?? '').toLowerCase() === 'pdf')
    expect(pdf?.attrs.href).toBe('http://arxiv.org/pdf/1706.03762v7')
  })

  it('xmlSelfClosing handles attribute order independence', () => {
    const xml = '<feed><link href="http://x.test/1" title="pdf" rel="related"/></feed>'
    const links = xmlSelfClosing(xml, 'link')
    expect(links[0]!.attrs.href).toBe('http://x.test/1')
    expect(links[0]!.attrs.title).toBe('pdf')
  })

  it('xmlSelfClosing ignores paired elements', () => {
    const xml = '<feed><link href="http://x.test">text</link></feed>'
    expect(xmlSelfClosing(xml, 'link').length).toBe(0)
  })

  it('xml helpers are defensive on malformed input', () => {
    expect(xmlText('<entry>no close', 'entry')).toBeUndefined()
    expect(xmlBlocks('garbage', 'entry')).toEqual([])
    expect(xmlSelfClosing('garbage', 'link')).toEqual([])
    expect(xmlAttr('garbage', 'link', 'href')).toBeUndefined()
  })
})
