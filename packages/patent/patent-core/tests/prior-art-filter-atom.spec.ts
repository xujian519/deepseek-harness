import { describe, expect, it } from 'vitest'
import { priorArtFilterAtom, PriorArtFilterHandler } from '@deepseek-ai/dsh-patent-core'

const handler = new PriorArtFilterHandler()

const doc = (title: string, publicationDate?: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  title,
  ...(publicationDate !== undefined ? { publicationDate } : {}),
  ...extra,
})

const stateWith = (docs: unknown[], overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  prior_art: docs,
  reference_date: '2024-06-01',
  reference_basis: 'filing-date',
  filing_date: '2024-06-01',
  ...overrides,
})

describe('prior-art-filter atom', () => {
  it('声明报告为主输出，过滤后的 prior_art 为第二输出键', () => {
    expect(priorArtFilterAtom.name).toBe('prior-art-filter')
    expect(priorArtFilterAtom.category).toBe('search')
    expect(priorArtFilterAtom.outputSchema.slice(0, 2)).toEqual(['prior_art_filter_report', 'prior_art'])
  })

  it('保留截止日前的文献，排除截止日当天及之后的文献（A22.5 现有技术）', async () => {
    const out = await handler.execute({
      state: stateWith([
        doc('D1 早于截止日', '2023-01-01'),
        doc('D2 等于截止日', '2024-06-01'),
        doc('D3 晚于截止日', '2024-07-01'),
      ]),
    })
    expect(out.prior_art).toHaveLength(1)
    expect(out.prior_art).toMatchObject([{ title: 'D1 早于截止日', dLabel: 'D1' }])
    expect(out.prior_art_excluded).toHaveLength(2)
    expect(out.prior_art_excluded).toMatchObject([
      { label: 'D2', reason: 'not-prior-art', publicationDate: '2024-06-01' },
      { label: 'D3', reason: 'not-prior-art', publicationDate: '2024-07-01' },
    ])
    const report = String(out.prior_art_filter_report)
    expect(report).toContain('保留 1 篇，排除 2 篇')
    expect(report).toContain('2024-06-01')
  })

  it.each(['A24.1', 'A24.2', 'A24.3', 'A24.4'])(
    '申请日前六个月内且属于 %s 的首次公开不破坏新颖性（G-2 正例）',
    async (exception) => {
      const out = await handler.execute({
        state: stateWith([doc('宽限期内公开', '2024-03-01', { a24Exception: exception })]),
      })
      expect(out.prior_art).toEqual([])
      expect(out.prior_art_excluded).toMatchObject([
        { reason: 'a24-grace-period', a24Exception: exception },
      ])
      expect(String(out.prior_art_filter_report)).toContain(exception)
    },
  )

  it('宽限期外的 A24 标注不适用，该公开仍作为现有技术（G-2 反例）', async () => {
    const out = await handler.execute({
      state: stateWith([doc('宽限期外公开', '2023-01-01', { a24Exception: 'A24.2' })]),
    })
    expect(out.prior_art).toHaveLength(1)
    expect(out.prior_art_excluded).toEqual([])
    const report = String(out.prior_art_filter_report)
    expect(report).toContain('宽限期外')
    expect(report).toContain('A24.2')
  })

  it('六个月的起点按对应日计算，边界日仍在宽限期内', async () => {
    const out = await handler.execute({
      state: stateWith([doc('边界日公开', '2024-02-29', { a24Exception: 'A24.3' })], {
        filing_date: '2024-08-31',
        reference_date: '2024-08-31',
      }),
    })
    expect(out.prior_art).toEqual([])
    expect(out.prior_art_excluded).toMatchObject([{ reason: 'a24-grace-period' }])
  })

  it('缺少申请日时 A24 标注无法判定，按截止日保留并写明原因', async () => {
    const out = await handler.execute({
      state: stateWith([doc('优先权日前公开', '2023-05-01', { a24Exception: 'A24.4' })], {
        reference_basis: 'priority-date',
        reference_date: '2023-06-01',
        filing_date: '',
      }),
    })
    expect(out.prior_art).toHaveLength(1)
    expect(String(out.prior_art_filter_report)).toContain('缺少申请日')
    expect(String(out.prior_art_filter_report)).toContain('A24 未判定')
  })

  it('缺少公开日的文献保留并列入待核实，避免把未知日期当作非现有技术', async () => {
    const out = await handler.execute({ state: stateWith([{ title: '无日期' }]) })
    expect(out.prior_art).toHaveLength(1)
    expect(out.prior_art_excluded).toEqual([])
    expect(out.prior_art_undated).toMatchObject([{ label: 'D1' }])
    expect(String(out.prior_art_filter_report)).toContain('缺少公开日')
    expect(String(out.prior_art_filter_report)).toContain('保留待人工核实')
  })

  it('不可解析的公开日保留并列入待核实', async () => {
    const out = await handler.execute({ state: stateWith([doc('坏日期', '2024-13-01')]) })
    expect(out.prior_art).toHaveLength(1)
    expect(out.prior_art_undated).toMatchObject([{ label: 'D1' }])
    expect(String(out.prior_art_filter_report)).toContain('2024-13-01')
  })

  it('从 Wayback Machine 存档 URL 推定公开日', async () => {
    const out = await handler.execute({
      state: stateWith([
        { title: '存档页', url: 'https://web.archive.org/web/20230501000000/https://example.com/a' },
      ]),
    })
    expect(out.prior_art).toHaveLength(1)
    expect(out.prior_art_undated).toEqual([])
  })

  it('月级公开日推定到月末后再与截止日比较', async () => {
    const before = await handler.execute({ state: stateWith([doc('五月', '2024-05')]) })
    expect(before.prior_art).toHaveLength(1)
    const after = await handler.execute({ state: stateWith([doc('六月', '2024-06')]) })
    expect(after.prior_art).toEqual([])
    expect(after.prior_art_excluded).toMatchObject([{ publicationDate: '2024-06-30' }])
  })

  it('输出保留原始 D 标号，过滤后不影响引用接地', async () => {
    const out = await handler.execute({
      state: stateWith([doc('被排除', '2024-07-01'), doc('被保留', '2023-01-01')]),
    })
    expect(out.prior_art).toMatchObject([{ title: '被保留', dLabel: 'D2' }])
  })

  it('params 可指定检索结果、截止日与申请日的状态键', async () => {
    const out = await handler.execute({
      state: {
        hits: [doc('自定义状态键', '2023-01-01')],
        cutoff: '2024-06-01',
        filed: '2024-06-01',
        prior_art_key: 'hits',
        reference_date_key: 'cutoff',
        filing_date_key: 'filed',
      },
    })
    expect(out.prior_art).toMatchObject([{ title: '自定义状态键', dLabel: 'D1' }])
  })

  it('params 可指定公开日与 A24 标注字段', async () => {
    const out = await handler.execute({
      state: stateWith(
        [{ title: '自定义字段', publishedAt: '2024-02-01', grace: 'A24.1' }],
        { publication_date_key: 'publishedAt', a24_exception_key: 'grace' },
      ),
    })
    expect(out.prior_art_excluded).toMatchObject([{ reason: 'a24-grace-period' }])
  })

  it('非法 A24 标注使阶段降级，避免静默按现有技术处理', async () => {
    const out = await handler.execute({
      state: stateWith([doc('坏标注', '2024-03-01', { a24Exception: 'A24.9' })]),
    })
    expect(String(out._error)).toContain('[prior-art-filter]')
    expect(String(out._error)).toContain('a24Exception')
    expect(out.prior_art).toBeUndefined()
  })

  it('检索结果为空时通过，并说明无需过滤', async () => {
    const out = await handler.execute({ state: stateWith([]) })
    expect(out.prior_art).toEqual([])
    expect(out.prior_art_excluded).toEqual([])
    expect(String(out.prior_art_filter_report)).toContain('检索结果为空')
  })

  it('检索阶段未产出 prior_art 时降级', async () => {
    const out = await handler.execute({
      state: { reference_date: '2024-06-01', filing_date: '2024-06-01' },
    })
    expect(String(out._error)).toContain('prior_art')
  })

  it('缺少或不可解析截止日时降级', async () => {
    const missing = await handler.execute({ state: { prior_art: [], filing_date: '2024-06-01' } })
    expect(String(missing._error)).toContain('reference_date')
    const invalid = await handler.execute({
      state: { prior_art: [], reference_date: '2024-13-01', filing_date: '2024-06-01' },
    })
    expect(String(invalid._error)).toContain('reference_date')
  })

  it('已提供的申请日不可解析时降级', async () => {
    const out = await handler.execute({
      state: { prior_art: [], reference_date: '2024-06-01', filing_date: '2024-13-01' },
    })
    expect(String(out._error)).toContain('filing_date')
  })

  it('字段配置参数非法时降级', async () => {
    const out = await handler.execute({
      state: stateWith([], { publication_date_key: 3 }),
    })
    expect(String(out._error)).toContain('publication_date_key')
  })
})
