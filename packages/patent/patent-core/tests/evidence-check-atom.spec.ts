import { describe, expect, it } from 'vitest'
import {
  contentHash,
  EvidenceCheckHandler,
  evidenceCheckAtom,
  type EvidenceCheckPending,
  type EvidenceCheckViolation,
} from '@deepseek-ai/dsh-patent-core'

const handler = new EvidenceCheckHandler()

const priorArt = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  title: 'CN101234567A 阀体伴热夹套结构',
  type: '现有技术',
  sourceUri: 'patent:CN101234567A',
  publicationDate: '2023-01-01',
  submittedAt: '2024-06-01',
  grounds: ['创造性'],
  ...overrides,
})

const stateWith = (list: unknown[], overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  evidence: list,
  evidence_deadline: '2024-07-01',
  filing_date: '2024-06-01',
  ...overrides,
})

const violations = (out: Record<string, unknown>): EvidenceCheckViolation[] =>
  out.evidence_check_violations as EvidenceCheckViolation[]

const pending = (out: Record<string, unknown>): EvidenceCheckPending[] =>
  out.evidence_check_pending as EvidenceCheckPending[]

const codes = (out: Record<string, unknown>): string[] => violations(out).map(item => item.code)

describe('evidence-check atom', () => {
  it('声明的输出以报告为主输出，分类为 gate', () => {
    expect(evidenceCheckAtom.name).toBe('evidence-check')
    expect(evidenceCheckAtom.category).toBe('gate')
    expect(evidenceCheckAtom.outputSchema).toEqual([
      'evidence_check_report',
      'evidence_check_passed',
      'evidence_check_violations',
      'evidence_check_pending',
    ])
    expect(evidenceCheckAtom.inputSchema).toContain('evidence')
    expect(evidenceCheckAtom.inputSchema).toContain('evidence_deadline')
  })

  it('未提供证据清单 → 报告未执行并放行', async () => {
    const out = await handler.execute({ state: {} })
    expect(out.evidence_check_passed).toBe(true)
    expect(violations(out)).toEqual([])
    expect(out.evidence_check_report).toContain('未执行')
    expect(out.evidence_check_report).toContain('未提供证据清单')
  })

  it('证据清单为空 → 通过并说明没有可审查条目', async () => {
    const out = await handler.execute({ state: stateWith([]) })
    expect(out.evidence_check_passed).toBe(true)
    expect(out.evidence_check_report).toContain('证据 0 条')
    expect(violations(out)).toEqual([])
  })

  it('在举证期限内提交、与理由关联的现有技术证据 → 通过', async () => {
    const out = await handler.execute({ state: stateWith([priorArt()]) })
    expect(out.evidence_check_passed).toBe(true)
    expect(violations(out)).toEqual([])
    expect(pending(out).map(item => item.code)).toEqual([])
    expect(out.evidence_check_report).toContain('通过')
    expect(out.evidence_check_report).toContain('2024-07-01')
  })

  it('逾期提交且无正当理由 → 未通过（G-12 反例）', async () => {
    const out = await handler.execute({
      state: stateWith([priorArt({ submittedAt: '2024-08-01' })]),
    })
    expect(out.evidence_check_passed).toBe(false)
    expect(codes(out)).toContain('EVID-TIME-LATE')
    expect(out.evidence_check_report).toContain('未通过')
    expect(out.evidence_check_report).toContain('逾期证据可能不被采纳')
  })

  it('逾期但说明正当理由 → 提示而非阻断', async () => {
    const out = await handler.execute({
      state: stateWith([priorArt({ submittedAt: '2024-08-01', lateJustification: '补充检索到该证据' })]),
    })
    expect(out.evidence_check_passed).toBe(true)
    expect(violations(out)).toMatchObject([
      { code: 'EVID-TIME-LATE-JUSTIFIED', severity: 'warn' },
    ])
    expect(out.evidence_check_report).toContain('补充检索到该证据')
  })

  it('缺少举证期限 → 期限检查列入清单级待核', async () => {
    const out = await handler.execute({ state: stateWith([priorArt()], { evidence_deadline: '' }) })
    expect(out.evidence_check_passed).toBe(true)
    expect(pending(out).map(item => item.code)).toContain('EVID-TIME-DEADLINE')
    expect(out.evidence_check_report).toContain('期限检查未评估')
  })

  it('有举证期限但缺少提交日 → 单条待核', async () => {
    const out = await handler.execute({
      state: stateWith([priorArt({ submittedAt: undefined })]),
    })
    expect(out.evidence_check_passed).toBe(true)
    expect(pending(out)).toMatchObject([{ code: 'EVID-TIME-SUBMITTED', label: '证据1' }])
  })

  it('外文证据未附中文译本 → 阻断', async () => {
    const out = await handler.execute({
      state: stateWith([
        { title: 'US1234567A', type: '外文证据', translated: false, submittedAt: '2024-06-01', grounds: ['新颖性'] },
      ]),
    })
    expect(out.evidence_check_passed).toBe(false)
    expect(codes(out)).toContain('EVID-FORM-TRANSLATION')
  })

  it('外文证据未说明是否翻译 → 待核而非阻断', async () => {
    const out = await handler.execute({
      state: stateWith([
        { title: 'US1234567A', type: 'foreign_language', submittedAt: '2024-06-01', grounds: ['新颖性'] },
      ]),
    })
    expect(out.evidence_check_passed).toBe(true)
    expect(pending(out).map(item => item.code)).toContain('EVID-FORM-TRANSLATION')
  })

  it('域外证据未公证认证 → 提示；声明免除 → 不再提示', async () => {
    const out = await handler.execute({
      state: stateWith([
        {
          title: '域外销售合同',
          type: '域外证据',
          notarized: false,
          legalized: false,
          submittedAt: '2024-06-01',
          grounds: ['公开使用'],
        },
      ]),
    })
    expect(out.evidence_check_passed).toBe(true)
    expect(codes(out)).toEqual(['EVID-FORM-NOTARIZATION', 'EVID-FORM-LEGALIZATION'])

    const exempt = await handler.execute({
      state: stateWith([
        {
          title: '域外公开发行物',
          type: '域外证据',
          notarizedExempt: true,
          legalizedExempt: true,
          submittedAt: '2024-06-01',
          grounds: ['新颖性'],
        },
      ]),
    })
    expect(violations(exempt)).toEqual([])
    expect(pending(exempt)).toEqual([])
  })

  it('证人证言未载明证人身份 → 阻断', async () => {
    const out = await handler.execute({
      state: stateWith([
        { title: '证人证言', type: '证人证言', submittedAt: '2024-06-01', grounds: ['公开使用'] },
      ]),
    })
    expect(out.evidence_check_passed).toBe(false)
    expect(codes(out)).toContain('EVID-FORM-WITNESS')
  })

  it('证人未披露利害关系 → 提示', async () => {
    const out = await handler.execute({
      state: stateWith([
        {
          title: '证人王某证言',
          type: '证人证言',
          witness: '王某',
          witnessDisclosed: false,
          submittedAt: '2024-06-01',
          grounds: ['公开使用'],
        },
      ]),
    })
    expect(out.evidence_check_passed).toBe(true)
    expect(codes(out)).toContain('EVID-FORM-WITNESS-INTEREST')
  })

  it('现有技术公开日早于截止日 → 通过', async () => {
    const out = await handler.execute({
      state: stateWith([priorArt({ publicationDate: '2024-05-31' })]),
    })
    expect(out.evidence_check_passed).toBe(true)
    expect(violations(out)).toEqual([])
  })

  it('现有技术公开日等于截止日 → 阻断（A22.5 申请日以前）', async () => {
    const out = await handler.execute({
      state: stateWith([priorArt({ publicationDate: '2024-06-01' })]),
    })
    expect(out.evidence_check_passed).toBe(false)
    expect(codes(out)).toContain('EVID-TIME-NOT-PRIOR-ART')
  })

  it('月级公开日按月末推定后再比较', async () => {
    const before = await handler.execute({
      state: stateWith([priorArt({ publicationDate: '2024-05' })]),
    })
    expect(before.evidence_check_passed).toBe(true)
    const after = await handler.execute({
      state: stateWith([priorArt({ publicationDate: '2024-06' })]),
    })
    expect(after.evidence_check_passed).toBe(false)
    expect(codes(after)).toContain('EVID-TIME-NOT-PRIOR-ART')
  })

  it('A24 宽限期标注只提示，不在本原子判断是否适用', async () => {
    const out = await handler.execute({
      state: stateWith([priorArt({ publicationDate: '2024-06-01', a24Exception: 'A24.2' })]),
    })
    expect(out.evidence_check_passed).toBe(true)
    expect(violations(out)).toMatchObject([{ code: 'EVID-TIME-A24', severity: 'warn' }])
  })

  it('现有技术缺少公开日 → 待核', async () => {
    const out = await handler.execute({
      state: stateWith([priorArt({ publicationDate: undefined })]),
    })
    expect(out.evidence_check_passed).toBe(true)
    expect(pending(out).map(item => item.code)).toContain('EVID-TIME-PUBLICATION-DATE')
  })

  it('缺少申请日/优先权日 → 公开日检查待核', async () => {
    const out = await handler.execute({
      state: stateWith([priorArt()], { filing_date: '', priority_date: '' }),
    })
    expect(out.evidence_check_passed).toBe(true)
    expect(pending(out).map(item => item.code)).toContain('EVID-TIME-REFERENCE')
  })

  it('证据未关联理由或权项 → 提示关联性无法确认', async () => {
    const out = await handler.execute({
      state: stateWith([priorArt({ grounds: undefined })]),
    })
    expect(out.evidence_check_passed).toBe(true)
    expect(codes(out)).toContain('EVID-RELEVANCE-UNLINKED')
  })

  it('内建内容哈希与原文摘录一致 → 通过；不一致 → 阻断', async () => {
    const snippet = '证据原文摘录'
    const match = await handler.execute({
      state: stateWith([priorArt({ contentHash: contentHash(snippet), snippet })]),
    })
    expect(match.evidence_check_passed).toBe(true)
    expect(violations(match)).toEqual([])

    const mismatch = await handler.execute({
      state: stateWith([priorArt({ contentHash: 'deadbeef', snippet })]),
    })
    expect(mismatch.evidence_check_passed).toBe(false)
    expect(codes(mismatch)).toContain('EVID-FORM-INTEGRITY')
  })

  it('外部哈希格式或缺少摘录 → 待核，不误判完整性', async () => {
    const external = await handler.execute({
      state: stateWith([priorArt({ contentHash: 'a'.repeat(64), snippet: '证据原文摘录' })]),
    })
    expect(external.evidence_check_passed).toBe(true)
    expect(pending(external).map(item => item.code)).toContain('EVID-FORM-INTEGRITY')

    const noSnippet = await handler.execute({
      state: stateWith([priorArt({ contentHash: contentHash('证据原文摘录') })]),
    })
    expect(noSnippet.evidence_check_passed).toBe(true)
    expect(pending(noSnippet).map(item => item.code)).toContain('EVID-FORM-INTEGRITY')
  })

  it('无法识别名称或来源的证据 → 阻断', async () => {
    const out = await handler.execute({
      state: stateWith([{ type: '一般证据', submittedAt: '2024-06-01', grounds: ['其他'] }]),
    })
    expect(out.evidence_check_passed).toBe(false)
    expect(codes(out)).toEqual(['EVID-FORM-IDENTITY'])
  })

  it('params 可指定证据、期限与时间基准的状态键', async () => {
    const out = await handler.execute({
      state: {
        my_evidence: [priorArt({ submittedAt: '2024-06-01' })],
        my_deadline: '2024-07-01',
        my_reference: '2024-06-01',
        evidence_key: 'my_evidence',
        deadline_key: 'my_deadline',
        reference_date_key: 'my_reference',
        filing_date_key: 'unused_filing',
        priority_date_key: 'unused_priority',
      },
    })
    expect(out.evidence_check_passed).toBe(true)
    expect(violations(out)).toEqual([])
    expect(out.evidence_check_report).toContain('2024-07-01')
  })

  it('证据清单不是数组 → 降级', async () => {
    const out = await handler.execute({ state: { evidence: { title: 'not an array' } } })
    expect(String(out._error)).toContain('[evidence-check]')
    expect(String(out._error)).toContain('不是数组')
  })

  it('条目不是对象 → 降级', async () => {
    const out = await handler.execute({ state: stateWith([null]) })
    expect(String(out._error)).toContain('证据1 条目不是对象')
  })

  it('提交日或公开日不可解析 → 降级，不静默跳过', async () => {
    const submitted = await handler.execute({
      state: stateWith([priorArt({ submittedAt: '2024-13-01' })]),
    })
    expect(String(submitted._error)).toContain('submittedAt')
    const published = await handler.execute({
      state: stateWith([priorArt({ publicationDate: '2024-13-01' })]),
    })
    expect(String(published._error)).toContain('publicationDate')
  })

  it('举证期限或现有技术截止日不可解析 → 降级', async () => {
    const deadline = await handler.execute({ state: stateWith([], { evidence_deadline: '2024-13-01' }) })
    expect(String(deadline._error)).toContain('举证期限')
    const reference = await handler.execute({
      state: stateWith([], { reference_date: '2024-13-01' }),
    })
    expect(String(reference._error)).toContain('现有技术截止日')
  })

  it('状态键参数非法 → 降级', async () => {
    const out = await handler.execute({ state: { evidence_key: 123 } })
    expect(String(out._error)).toContain('evidence_key')
  })

  it('报告固定写明实质判断仍需人工复核', async () => {
    const out = await handler.execute({ state: stateWith([priorArt()]) })
    expect(out.evidence_check_report).toContain('证据真实性、证明力以及公开内容的实质比对仍需人工复核')
  })
})
