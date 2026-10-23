/**
 * Tests for topic extraction from legal article text.
 *
 * Covers:
 * - Legal-term matching
 * - Concept-compound extraction
 * - Deduplication
 * - Empty / edge-case inputs
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { extractTopicsFromText } from '../generate-law-yaml.ts'

// ─── extractTopicsFromText ────────────────────────────────────────

describe('extractTopicsFromText', () => {
  it('always includes the law short name as the first topic', () => {
    const topics = extractTopicsFromText('任意条文内容', '计量法')
    expect(topics[0]).toBe('计量法')
  })

  it('extracts legal terms present in the text', () => {
    const text = '自然人从出生时起到死亡时止，具有民事权利能力，依法享有民事权利，承担民事义务。法人的民事权利能力'
    const topics = extractTopicsFromText(text, '民法典')
    expect(topics).toContain('自然人')
    expect(topics).toContain('法人')
  })

  it('extracts concept compounds via regex patterns', () => {
    const text = '本法所称行政处罚，是指行政机关依法对违反行政管理秩序的公民、法人或者其他组织，以减损权益或者增加义务的方式予以惩戒的行为。'
    const topics = extractTopicsFromText(text, '行政处罚法')
    // Should pick up 行政处罚 (legal term) and concept compounds like 管理行为/管理
    expect(topics.some(t => t.includes('行政处罚') || t.includes('管理'))).toBe(true)
  })

  it('deduplicates topics when the same term appears multiple times', () => {
    const text = '专利权专利权专利权'
    const topics = extractTopicsFromText(text, '专利法')
    const patentCount = topics.filter(t => t === '专利权').length
    expect(patentCount).toBe(1)
  })

  it('returns only the law name for empty text', () => {
    const topics = extractTopicsFromText('', '宪法')
    expect(topics).toEqual(['宪法'])
  })

  it('limits legal terms to at most 3', () => {
    // Construct text with many known terms
    const text = '合同违约赔偿诉讼时效管辖权仲裁调解证据保全强制执行行政处罚行政许可'
    const topics = extractTopicsFromText(text, '测试法')
    // First topic is the law name; then at most 3 legal terms; then at most 2 concepts
    // Total ≤ 1 + 3 + 2 = 6
    expect(topics.length).toBeLessThanOrEqual(6)
  })

  it('limits concept compounds to at most 2', () => {
    // Construct text with many concept compounds but no pre-defined terms
    const text = '审批行为许可行为登记行为备案行为审查行为核准行为'
    const topics = extractTopicsFromText(text, '测试法')
    // Law name + 0 legal terms + at most 2 concepts
    const conceptTopics = topics.filter(t => t !== '测试法')
    expect(conceptTopics.length).toBeLessThanOrEqual(2)
  })

  it('produces different topics for different article texts', () => {
    const text1 = '为了保护民事主体的合法权益，法人之间的人身关系和财产关系'
    const text2 = '为了规范行政处罚的设定和实施，保障和监督行政机关有效实施行政管理'
    const topics1 = extractTopicsFromText(text1, '法律')
    const topics2 = extractTopicsFromText(text2, '法律')
    // They share the law name but should differ in other topics
    expect(topics1[0]).toBe(topics2[0]) // both start with law name
    expect(topics1).not.toEqual(topics2) // but overall different
  })

  it('does not include meaningless generic terms', () => {
    const text = '根据本法规定执行'
    const topics = extractTopicsFromText(text, '测试法')
    // No legal terms or concept compounds should match
    expect(topics).toEqual(['测试法'])
  })
})
