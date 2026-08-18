import { describe, expect, it } from 'vitest'
import { analyzeSlop } from '../src/internal/slop-engine.ts'

describe('analyzeSlop structure-issue detection', () => {
  it('detects all six structure-issue categories and scores the document', () => {
    const text = [
      '本申请解决的技术问题是精度问题。',
      '区别特征在于采用了新型结构。该区别特征使得本申请具有显著的进步。',
      '区别特征：采用新型结构，长度足够长超过三十个字符用于触发冒号分支。',
      '|区别特征|对比文件¶0123|',
      '|区别特征|对比文件[2020]|',
      '|区别特征|对比方案|',
      '这不是精度问题，而是成本问题。',
      '权利要求被驳回。',
      '审查员认定为非显而易见。',
      '审查员认定有误，请复核。',
      '第1条 第2条 第3条 第4条',
      '检索数据库命中 D1¶0123。',
      '进一步地，本发明对现有方案进行了深入分析。',
    ].join('\n\n')

    const analysis = analyzeSlop(text)
    const types = analysis.issues.map(i => i.type)
    expect(types).toContain('empty_three_step')
    expect(types).toContain('fake_comparison')
    expect(types).toContain('binary_turn')
    expect(types).toContain('passive_voice')
    expect(types).toContain('oa_formula')
    expect(types).toContain('reason_pile')
    // 10+ issues → rhythm 4; D1 + ¶0123 present → evidence 9 (both +2, no +1)
    expect(analysis.score.rhythm).toBe(4)
    expect(analysis.score.evidence).toBe(9)
    expect(analysis.score.directness).toBe(8)
    // 进一步地 (deleted) + 深入分析→分析 (replaced)
    expect(analysis.changes).toHaveLength(2)
    expect(analysis.changes[0]?.replacement).toBe('（删除）')
    expect(analysis.changes[1]?.replacement).toBe('分析')
    // Checklist detail counts the present passive-voice category.
    expect(analysis.checklist[1]?.detail).toBe('1 处被动句')
  })

  it('renders rhythm 6 for two issues and 无 for absent categories', () => {
    const analysis = analyzeSlop('区别特征：冒号后无编号。\n这不是精度问题，而是成本问题。')
    expect(analysis.issues).toHaveLength(2)
    expect(analysis.score.rhythm).toBe(6)
    expect(analysis.checklist[1]?.detail).toBe('无')
  })

  it('scores practicality from the phrase-cleanup count', () => {
    const heavy = analyzeSlop('进一步地，此外，值得一提的是，不难发现，毋庸置疑，综上所述，本申请具有显著进步。')
    expect(heavy.changes.length).toBe(7)
    expect(heavy.score.practicality).toBe(5)

    const medium = analyzeSlop('进一步地，此外，综上所述。')
    expect(medium.changes.length).toBe(3)
    expect(medium.score.practicality).toBe(7)
  })

  it('scores concision 5 beyond 15 paragraphs', () => {
    const text = Array.from({ length: 18 }, (_, i) => `段落${i + 1}`).join('\n\n')
    const analysis = analyzeSlop(text)
    expect(analysis.score.concision).toBe(5)
  })

  it('checks evidence-marker flags on a feature snippet without claim refs', () => {
    const analysis = analyzeSlop('本发明的区别特征记载于 D1¶0100。')
    const feature = analysis.checklist[0]
    expect(feature?.passed).toBe(true)
    expect(feature?.detail).toContain('检查前500字')
  })
})
