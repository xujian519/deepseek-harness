/** 金标语料：A22.5 现有技术时间边界与 A24 宽限期过滤。 */
export type PriorArtFilterCase = {
  engine: 'prior-art-filter'
  id: string
  title: string
  /** 送入 prior-art-filter 原子的状态。 */
  state: Record<string, unknown>
  /** 过滤后保留文献的标题（按顺序）。 */
  expectedKeptTitles: readonly string[]
  /** 排除项的原因（按顺序）。 */
  expectedExcludedReasons: readonly string[]
  /** 报告必须包含的说明。 */
  expectedReportText: readonly string[]
}

/**
 * 构造带申请日与截止日的检索结果状态。
 * @param documents - 检索结果条目。
 * @param overrides - 覆盖默认日期的状态键。
 * @returns prior-art-filter 的输入状态。
 */
function stateWith(
  documents: readonly Record<string, unknown>[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    prior_art: documents,
    reference_date: '2024-06-01',
    reference_basis: 'filing-date',
    filing_date: '2024-06-01',
    ...overrides,
  }
}

/** A24 金标语料（当前行为已符合预期的情形）。 */
export const PRIOR_ART_FILTER_CASES: readonly PriorArtFilterCase[] = [
  {
    engine: 'prior-art-filter',
    id: 'A24-001',
    title: '申请日前六个月内属于 A24.2 的公开不破坏新颖性',
    state: stateWith([
      {
        title: '宽限期内公开',
        publicationDate: '2024-03-01',
        a24Exception: 'A24.2',
        a24DisclosureSource: 'derived-from-applicant',
      },
    ]),
    expectedKeptTitles: [],
    expectedExcludedReasons: ['a24-grace-period'],
    expectedReportText: ['A24.2'],
  },
  {
    engine: 'prior-art-filter',
    id: 'A24-002',
    title: '宽限期起点按对应日计算，边界日仍在宽限期内',
    state: stateWith(
      [
        {
          title: '边界日公开',
          publicationDate: '2024-02-29',
          a24Exception: 'A24.3',
          a24DisclosureSource: 'applicant',
        },
      ],
      { filing_date: '2024-08-31', reference_date: '2024-08-31' },
    ),
    expectedKeptTitles: [],
    expectedExcludedReasons: ['a24-grace-period'],
    expectedReportText: ['2024-08-31'],
  },
  {
    engine: 'prior-art-filter',
    id: 'A24-003',
    title: '宽限期外的 A24 标注不适用，该公开仍作为现有技术',
    state: stateWith([
      {
        title: '宽限期外公开',
        publicationDate: '2023-01-01',
        a24Exception: 'A24.2',
        a24DisclosureSource: 'applicant',
      },
    ]),
    expectedKeptTitles: ['宽限期外公开'],
    expectedExcludedReasons: [],
    expectedReportText: ['宽限期外', 'A24.2'],
  },
  {
    engine: 'prior-art-filter',
    id: 'A24-004',
    title: '缺少申请日时 A24 标注无法判定，保留并写明原因',
    state: stateWith(
      [
        {
          title: '优先权日前公开',
          publicationDate: '2023-05-01',
          a24Exception: 'A24.4',
          a24DisclosureSource: 'unauthorized-disclosure',
        },
      ],
      { reference_basis: 'priority-date', reference_date: '2023-06-01', filing_date: '' },
    ),
    expectedKeptTitles: ['优先权日前公开'],
    expectedExcludedReasons: [],
    expectedReportText: ['缺少申请日', 'A24 未判定'],
  },
  {
    engine: 'prior-art-filter',
    id: 'A24-005',
    title: '优先权日早于申请日时以优先权日为宽限期基准',
    state: stateWith(
      [
        {
          title: '优先权日宽限期内',
          publicationDate: '2021-12-01',
          a24Exception: 'A24.2',
          a24DisclosureSource: 'applicant',
        },
      ],
      { priority_date: '2022-01-01', reference_date: '2022-01-01', reference_basis: 'priority-date' },
    ),
    expectedKeptTitles: [],
    expectedExcludedReasons: ['a24-grace-period'],
    expectedReportText: ['A24 宽限期基准：2022-01-01（优先权日）'],
  },
  {
    engine: 'prior-art-filter',
    id: 'A24-006',
    title: '多个优先权日取最早的一日作为宽限期基准',
    state: stateWith(
      [
        {
          title: '仅落在最早优先权宽限期内',
          publicationDate: '2021-12-01',
          a24Exception: 'A24.2',
          a24DisclosureSource: 'applicant',
        },
      ],
      { priority_date: ['2022-01-01', '2022-08-01'], reference_date: '2022-01-01', reference_basis: 'priority-date' },
    ),
    expectedKeptTitles: [],
    expectedExcludedReasons: ['a24-grace-period'],
    expectedReportText: ['A24 宽限期基准：2022-01-01'],
  },
  {
    engine: 'prior-art-filter',
    id: 'A24-007',
    title: '优先权日不可解析时标为未判定，不回退到申请日',
    state: stateWith(
      [
        {
          title: '看似在申请日宽限期内',
          publicationDate: '2024-03-01',
          a24Exception: 'A24.2',
          a24DisclosureSource: 'applicant',
        },
      ],
      { priority_date: '2022-13-01' },
    ),
    expectedKeptTitles: ['看似在申请日宽限期内'],
    expectedExcludedReasons: [],
    expectedReportText: ['优先权日', 'A24 未判定'],
  },
  {
    engine: 'prior-art-filter',
    id: 'A24-008',
    title: '公开来源未知时不认定宽限期',
    state: stateWith([
      { title: '来源未知', publicationDate: '2024-03-01', a24Exception: 'A24.2' },
    ]),
    expectedKeptTitles: ['来源未知'],
    expectedExcludedReasons: [],
    expectedReportText: ['公开来源 unknown', 'A24 未判定'],
  },
  {
    engine: 'prior-art-filter',
    id: 'A24-009',
    title: '宽限期起点前一日不适用 A24',
    state: stateWith(
      [
        {
          title: '起点前一日',
          publicationDate: '2024-02-28',
          a24Exception: 'A24.3',
          a24DisclosureSource: 'applicant',
        },
      ],
      { filing_date: '2024-08-31', reference_date: '2024-08-31' },
    ),
    expectedKeptTitles: ['起点前一日'],
    expectedExcludedReasons: [],
    expectedReportText: ['宽限期外'],
  },
]
