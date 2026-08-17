import { expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  chartFileBase,
  loadClaimChart,
  renderChartMarkdown,
  saveClaimChart,
} from '@deepseek-ai/dsh-patent-core'
import { DRAFT_NOTICE } from '@deepseek-ai/dsh-patent-core'
import type { ClaimChart } from '@deepseek-ai/dsh-patent-core'

function makeChart(): ClaimChart {
  return {
    chartId: 't1',
    mode: 'invalidity',
    caseId: 'case-1',
    elements: [
      { id: '1a', claimNo: 1, text: '包括壳体', kind: 'limitation' },
      { id: '1b', claimNo: 1, text: '和滤芯', kind: 'limitation' },
    ],
    claimNos: [1],
    targets: [{ id: 'D1', kind: 'prior-art' }],
    rows: [
      {
        elementId: '1a',
        targetId: 'D1',
        quote: '壳体',
        pinCite: '[D1 段[0032]]',
        mapping: 'literal',
        state: 'literal',
        verified: false,
      },
      {
        elementId: '1b',
        targetId: 'D1',
        quote: '',
        pinCite: '[D1 段[0032]]',
        mapping: 'not-found',
        state: 'not-found',
        verified: false,
      },
    ],
    gaps: [
      { elementId: '1b', targetId: 'D1', mapping: 'not-found', reason: '未找到', suggestion: '补充检索或论证等同替换' },
    ],
    draftNotice: DRAFT_NOTICE,
  }
}

it('renderChartMarkdown 含免责声明/gap list/表格', () => {
  const md = renderChartMarkdown(makeChart())
  expect(md.startsWith('# 权利要求对照表')).toBeTruthy()
  expect(md.includes(DRAFT_NOTICE)).toBeTruthy()
  expect(md.includes('## Gap List')).toBeTruthy()
  expect(md.includes('1b')).toBeTruthy()
  expect(md.includes('| # |')).toBeTruthy()
  expect(md.includes('包括壳体')).toBeTruthy()
})

it('renderChartMarkdown 空 gap/特殊字符转义/verified 标记/分隔行', () => {
  const chart = makeChart()
  chart.gaps = []
  chart.elements.push({ id: '1c', claimNo: 1, text: '包括|隔板\n和滤网', kind: 'limitation' })
  chart.rows.push({
    elementId: '1c',
    targetId: 'D1',
    quote: '壳体\n外壳',
    pinCite: '[D1 段[0033]|图1]',
    mapping: 'literal',
    state: 'literal',
    verified: true,
  })
  const md = renderChartMarkdown(chart)

  // ① gap 为空分支：提示语渲染、无 checklist 项
  expect(md.includes('（无缺口：全部要素均有证据映射）')).toBeTruthy()
  expect(!md.includes('- [ ]')).toBeTruthy()

  // ④ 表格分隔行
  expect(md.includes('|---|---|---|---|---|---|')).toBeTruthy()

  // ②/③ 1c 行：| 转义为 \|、换行替换为空格、pinCite 内 | 转义、verified:true 渲染 ✓
  const row1c = md.split('\n').find(line => line.includes('| 1c |'))
  expect(row1c).toBeTruthy()
  expect(row1c!.startsWith('| 1c |')).toBeTruthy()
  expect(row1c!.includes('包括\\|隔板 和滤网')).toBeTruthy()
  expect(row1c!.includes('壳体 外壳')).toBeTruthy()
  expect(row1c!.includes('[D1 段[0033]\\|图1]')).toBeTruthy()
  expect(row1c!.endsWith('| ✓ |')).toBeTruthy()
  // 无转义列的 mapping/verified 断言不涉及 | 字符的额外列数污染
  expect(!row1c!.includes('| ☐ |')).toBeTruthy()
})

it('chartFileBase 拒绝不安全 chartId（防路径注入）', () => {
  for (const bad of ['../evil', 'a/b', '.hidden', 'a b']) {
    expect(() => chartFileBase('case-1', bad)).toThrow(RangeError)
    expect(() => chartFileBase('case-1', bad)).toThrow(/^Invalid chartId /)
  }
  expect(() => chartFileBase('case-1', 't1')).not.toThrow()
  expect(() => chartFileBase('case-1', 'a.b_c-1')).not.toThrow()
})

it('save/load 往返一致（落盘 data/cases/<caseId>/outputs/）', async () => {
  const prevCwd = process.cwd()
  const dir = mkdtempSync(join(tmpdir(), 'cc-store-'))
  process.chdir(dir)
  try {
    const chart = makeChart()
    const { jsonPath, mdPath } = await saveClaimChart(chart, chart.caseId)
    expect(jsonPath.includes(join('data', 'cases', 'case-1', 'outputs'))).toBeTruthy()
    expect(readFileSync(mdPath, 'utf8').length > 0).toBeTruthy()
    const loaded = loadClaimChart(chart.caseId, chart.chartId)
    expect(loaded?.chartId).toBe('t1')
    expect(loaded?.rows).toEqual(chart.rows)
    expect(loadClaimChart(chart.caseId, 'missing')).toBeNull()
  } finally {
    process.chdir(prevCwd)
    rmSync(dir, { recursive: true, force: true })
  }
})
