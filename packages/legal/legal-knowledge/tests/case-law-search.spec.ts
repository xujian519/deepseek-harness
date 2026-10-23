import { describe, expect, it } from 'vitest'
import { CaseLawSearchEngine } from '@deepseek-ai/dsh-legal-knowledge'
import type { CaseLawRecord } from '@deepseek-ai/dsh-legal-knowledge'

const SAMPLE_RECORDS: CaseLawRecord[] = [
  {
    caseId: 'case-001',
    docType: 'judgment',
    caseName: '张三诉李四合同纠纷案',
    court: '北京市朝阳区人民法院',
    decisionDate: '2023-06-15',
    caseNumber: '(2023)京0105民初1234号',
    caseType: '民事',
    fullText: '本案涉及合同违约责任的认定问题。原告张三主张被告李四未按合同约定履行义务，要求被告承担违约责任并赔偿损失。',
    summary: '合同违约责任认定，未按约定履行义务应承担赔偿责任',
  },
  {
    caseId: 'case-002',
    docType: 'judgment',
    caseName: '王五知识产权侵权案',
    court: '上海知识产权法院',
    decisionDate: '2023-08-20',
    caseNumber: '(2023)沪73民初5678号',
    caseType: '知识产权',
    fullText: '本案涉及专利侵权纠纷。原告王五主张被告未经授权使用其发明专利，要求被告停止侵权并赔偿经济损失。',
    summary: '专利侵权纠纷，未经授权使用发明专利应停止侵权并赔偿',
  },
  {
    caseId: 'case-003',
    docType: 'guiding',
    caseName: '指导案例1号：买卖合同违约损害赔偿',
    court: '最高人民法院',
    decisionDate: '2022-12-01',
    caseNumber: '指导案例1号',
    caseType: '民事',
    fullText: '买卖合同一方违约给对方造成损失的，应当赔偿对方因此所受到的损失，包括合同履行后可以获得的利益。',
    summary: '违约损害赔偿范围包括可得利益损失',
  },
]

describe('CaseLawSearchEngine', () => {
  it('空库检索返回空数组', () => {
    const engine = new CaseLawSearchEngine()
    expect(engine.search('合同')).toEqual([])
    expect(engine.count()).toBe(0)
  })

  it('关键词匹配返回按相关性排序的结果', () => {
    const engine = new CaseLawSearchEngine(SAMPLE_RECORDS)
    const results = engine.search('合同')
    expect(results.length).toBeGreaterThan(0)
    // case-001 and case-003 both contain "合同"
    const ids = results.map(r => r.caseId)
    expect(ids).toContain('case-001')
    expect(ids).toContain('case-003')
  })

  it('docType 过滤只返回指定类型的案例', () => {
    const engine = new CaseLawSearchEngine(SAMPLE_RECORDS)
    const results = engine.search('合同', { docType: 'guiding' })
    expect(results.every(r => r.docType === 'guiding')).toBe(true)
  })

  it('court 过滤按法院名称匹配', () => {
    const engine = new CaseLawSearchEngine(SAMPLE_RECORDS)
    const results = engine.search('侵权', { court: '上海' })
    expect(results.length).toBe(1)
    expect(results[0]!.caseId).toBe('case-002')
  })

  it('caseType 过滤按案件类型匹配', () => {
    const engine = new CaseLawSearchEngine(SAMPLE_RECORDS)
    const results = engine.search('合同', { caseType: '民事' })
    expect(results.every(r => r.caseType === '民事')).toBe(true)
  })

  it('limit 限制返回结果数量', () => {
    const engine = new CaseLawSearchEngine(SAMPLE_RECORDS)
    const results = engine.search('合同', { limit: 1 })
    expect(results.length).toBeLessThanOrEqual(1)
  })

  it('getById 按 ID 查找记录', () => {
    const engine = new CaseLawSearchEngine(SAMPLE_RECORDS)
    const record = engine.getById('case-001')
    expect(record).toBeDefined()
    expect(record?.caseName).toBe('张三诉李四合同纠纷案')
  })

  it('getById 不存在的 ID 返回 undefined', () => {
    const engine = new CaseLawSearchEngine(SAMPLE_RECORDS)
    expect(engine.getById('nonexistent')).toBeUndefined()
  })

  it('addRecords 动态添加记录', () => {
    const engine = new CaseLawSearchEngine()
    expect(engine.count()).toBe(0)
    engine.addRecords(SAMPLE_RECORDS)
    expect(engine.count()).toBe(3)
    const results = engine.search('合同')
    expect(results.length).toBeGreaterThan(0)
  })

  it('空查询返回空数组', () => {
    const engine = new CaseLawSearchEngine(SAMPLE_RECORDS)
    expect(engine.search('')).toEqual([])
    expect(engine.search('   ')).toEqual([])
  })

  it('结果包含 via 标记为 memory', () => {
    const engine = new CaseLawSearchEngine(SAMPLE_RECORDS)
    const results = engine.search('合同')
    expect(results.every(r => r.via === 'memory')).toBe(true)
  })
})
