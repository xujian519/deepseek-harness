import { describe, expect, it } from 'vitest'
import { parseLawRefsCount, toNode } from '@deepseek-ai/dsh-patent-knowledge'

describe('kg row-mapper', () => {
  it('parses unified-schema law_refs JSON into lawRefsCount', () => {
    const node = toNode({
      id: 'n1',
      node_type: 'article',
      name: '专利法',
      title: null,
      content: null,
      law_refs: '["ref-a","ref-b","ref-c"]',
      source: null,
      full_ref: null,
      chapter: null,
      article_number: null,
    })
    expect(node.lawRefsCount).toBe(3)
    expect(node.id).toBe('n1')
    expect(node.nodeType).toBe('article')
    expect(node.name).toBe('专利法')
  })

  it('prefers legacy law_refs_count over JSON parsing', () => {
    const node = toNode({
      id: 'n2',
      node_type: 'node',
      name: null,
      title: null,
      content: '正文',
      law_refs_count: 7,
      source: 'src',
      full_ref: null,
      chapter: null,
      article_number: '22',
      version: '2020',
    })
    expect(node.lawRefsCount).toBe(7)
    expect(node.version).toBe('2020')
    expect(node.articleNumber).toBe('22')
  })

  it('maps empty columns to undefined', () => {
    const node = toNode({
      id: 'n3',
      node_type: null,
      name: null,
      title: null,
      content: null,
      source: null,
      full_ref: null,
      chapter: null,
      article_number: null,
    })
    expect(node.name).toBeUndefined()
    expect(node.title).toBeUndefined()
    expect(node.lawRefsCount).toBeUndefined()
    expect(node.nodeType).toBe('')
  })

  it('parseLawRefsCount returns undefined for invalid/non-array/empty', () => {
    expect(parseLawRefsCount('not-json')).toBeUndefined()
    expect(parseLawRefsCount('{}')).toBeUndefined()
    expect(parseLawRefsCount(null)).toBeUndefined()
    expect(parseLawRefsCount('')).toBeUndefined()
  })
})
