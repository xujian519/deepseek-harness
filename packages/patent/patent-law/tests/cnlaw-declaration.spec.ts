import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CNLAW_GRAPH_URL,
  DEFAULT_CNLAW_SEARCH_URL,
  renderCnlawDeclaration,
} from '../src/cnlaw-declaration.ts'

const DECLARED = { enabled: true, searchUrl: 'http://cnlaw.internal:9100', graphUrl: 'http://cnlaw.internal:9101' }

describe('cnlaw declaration section text', () => {
  it('names the declared endpoints and the routes each one serves', () => {
    const text = renderCnlawDeclaration(DECLARED)
    expect(text).toContain('http://cnlaw.internal:9100')
    expect(text).toContain('http://cnlaw.internal:9101')
    expect(text).toContain('/search/decisions')
    expect(text).toContain('/api/cnlaw/graph/*')
    expect(text).toContain('mcp__cnlaw__*')
    expect(text).toContain('law_verify')
  })

  it('carries the shipped defaults when the deployment declares nothing else', () => {
    const text = renderCnlawDeclaration({
      enabled: true,
      searchUrl: DEFAULT_CNLAW_SEARCH_URL,
      graphUrl: DEFAULT_CNLAW_GRAPH_URL,
    })
    expect(text).toContain(DEFAULT_CNLAW_SEARCH_URL)
    expect(text).toContain(DEFAULT_CNLAW_GRAPH_URL)
  })

  it('names the fallback channels instead of an endpoint when the base is disabled', () => {
    const text = renderCnlawDeclaration({ ...DECLARED, enabled: false })
    expect(text).toContain('cnlawEnabled=false')
    expect(text).toContain('patent_case_search')
    expect(text).toContain('web_fetch')
    expect(text).not.toContain(DEFAULT_CNLAW_SEARCH_URL)
    expect(text).not.toContain(DEFAULT_CNLAW_GRAPH_URL)
  })

  it('states that guideline chapters are not in the index and names the retrieval channel', () => {
    const text = renderCnlawDeclaration(DECLARED)
    expect(text).toContain('not in the cnlaw index')
    expect(text).toContain('not the examination guidelines')
    // 规则取自外接 IP 知识库：声明段点名取原文的工具，未核验的节号才有落点。
    expect(text).toContain('law_search')
    expect(text).toContain('scope=guideline')
    expect(text).toContain('patent_kg_query')
    expect(text).toContain('GuidelineRule')
    expect(text).toContain('未核验')
  })

  it('keeps the guideline channel in both enabled and disabled base texts', () => {
    for (const enabled of [true, false]) {
      const text = renderCnlawDeclaration({ ...DECLARED, enabled })
      expect(text).toContain('law_search')
      expect(text).toContain('未核验')
    }
  })
})
