import { describe, expect, it } from 'vitest'
import type { PipelineState } from '@deepseek-ai/dsh-patent-core'
import {
  CONSUME_PROJECTION_KEYS,
  CONSUME_PROJECTORS,
  projectConsumedOutput,
} from '../src/tool/internal/consume-projections.ts'

type Json = Record<string, unknown>

/** 一张与真实产出同形的对照表：8 要素、1 篇对比文件、全 needs-evidence。 */
function chart(overrides: Json = {}): Json {
  const elements = [
    { id: '1a', claimNo: 1, text: '一种阀体伴热夹套结构', kind: 'preamble' },
    { id: '1b', claimNo: 1, text: '其特征在于', kind: 'transitional' },
    { id: '1c', claimNo: 1, text: '包括阀体', kind: 'limitation' },
    { id: '1d', claimNo: 1, text: '设置在阀体外侧的伴热夹套', kind: 'limitation' },
    { id: '1e', claimNo: 1, text: '所述伴热夹套内设有螺旋形加热介质通道', kind: 'limitation' },
  ]
  return {
    chartId: 'chart-oa-response',
    mode: 'oa-response',
    caseId: '',
    elements,
    claimNos: [1],
    claims: [{ claimNo: 1, claimType: 'independent', refersTo: [] }],
    targets: [{ id: 'CN101234567A', kind: 'prior-art' }],
    rows: elements.map(element => ({
      elementId: element.id,
      targetId: 'CN101234567A',
      quote: '',
      pinCite: '',
      mapping: 'needs-evidence',
      state: 'needs-evidence',
      verified: false,
    })),
    gaps: elements.map(element => ({
      elementId: element.id,
      targetId: 'CN101234567A',
      kind: 'needs-evidence',
      reason: `要素 ${element.id} 在 CN101234567A 上证据不足`,
      suggestion: '证据固化（全文引用/附图标记）',
    })),
    draftNotice: '本表为分析草稿。',
    ...overrides,
  }
}

/** 阶段产出与 run 记录一致：两空格缩进的格式化 JSON。 */
const textOf = (value: unknown): string => JSON.stringify(value, null, 2)

describe('claim-chart#rows', () => {
  it('把格式化 JSON 压成结论表，剔掉下游不用的字段', () => {
    const raw = textOf(chart())
    const out = projectConsumedOutput('claim-chart#rows', raw, {})
    expect(out).toContain('要素映射结论（5 项要素 / 1 篇对比文件')
    expect(out).toContain('| 1d | 1 | 设置在阀体外侧的伴热夹套 | CN101234567A | needs-evidence | — |')
    // 结论表里没有逐行字段：引用、核验标记、草稿免责声明都留在对照表里。
    expect(out).not.toContain('"verified"')
    expect(out).not.toContain('draftNotice')
    expect(out).not.toContain('分析草稿')
  })

  it('投影后显著短于原文（本用例取 60% 为下限）', () => {
    const raw = textOf(chart())
    const out = projectConsumedOutput('claim-chart#rows', raw, {})
    expect(out.length).toBeLessThan(raw.length * 0.6)
  })

  it('缺口按结论分组，不逐条复述建议动作', () => {
    const out = projectConsumedOutput('claim-chart#rows', textOf(chart()), {})
    expect(out).toContain('缺口（第一优先，按结论分组）：needs-evidence 5 项（1a、1b、1c、1d、1e）')
    expect(out).not.toContain('证据固化（全文引用/附图标记）')
  })

  it('有 pin-cite 时进表格，供正文回指段落号', () => {
    const out = projectConsumedOutput('claim-chart#rows', textOf(chart({
      rows: [
        {
          elementId: '1a',
          targetId: 'CN101234567A',
          quote: '阀体',
          pinCite: 'D1 段[0042]',
          mapping: 'literal',
          state: 'literal',
          verified: true,
        },
      ],
    })), {})
    expect(out).toContain('| 1a | 1 | 一种阀体伴热夹套结构 | CN101234567A | literal | D1 段[0042] |')
  })

  it('要素原文超长时截断，竖线抹平以免截断表格行', () => {
    const out = projectConsumedOutput('claim-chart#rows', textOf(chart({
      elements: [{ id: '1a', claimNo: 1, text: `${'特'.repeat(60)}|尾`, kind: 'limitation' }],
      rows: [{ elementId: '1a', targetId: 'D1', quote: '', pinCite: '', mapping: 'partial', state: 'partial', verified: false }],
    })), {})
    expect(out).toContain(`| ${'特'.repeat(40)}… |`)
    expect(out).not.toContain('|尾')
  })

  it('不是 JSON 时按原文交出并注明，不抛错', () => {
    const out = projectConsumedOutput('claim-chart#rows', '对照表构建失败：权利要求书为空', {})
    expect(out).toBe('（claim-chart 产出不是可解析的对照表 JSON，以下为原文）\n对照表构建失败：权利要求书为空')
  })

  it('是 JSON 但不是对象时同样退回原文', () => {
    const out = projectConsumedOutput('claim-chart#rows', '[]', {})
    expect(out).toContain('不是对照表对象')
    expect(out).toContain('[]')
  })

  it('没有任何要素或映射行时明示，不给出空表', () => {
    const out = projectConsumedOutput('claim-chart#rows', textOf(chart({ elements: [], rows: [] })), {})
    expect(out).toBe('（claim-chart 未产出任何要素或映射行）')
  })

  it('有要素但没有映射行时表格给出空缺标记', () => {
    const out = projectConsumedOutput('claim-chart#rows', textOf(chart({ rows: [] })), {})
    expect(out).toContain('| — | — | （图表未产出映射行） | — | — | — |')
  })

  it('没有对比文件目标时提示不得据此认定已公开', () => {
    const out = projectConsumedOutput('claim-chart#rows', textOf(chart({ targets: [] })), {})
    expect(out).toContain('未声明对比文件目标')
  })
})

describe('parse#oa-summary', () => {
  const parsed = textOf({ rejectionTypes: ['inventiveness'], affectedClaims: [1, 2] })

  it('优先取解析阶段自己写出的中文摘要', () => {
    const state: PipelineState = { office_action_summary: '驳回类型：创造性（A22.3）；涉及权项：1、2' }
    const out = projectConsumedOutput('parse#oa-summary', parsed, state)
    expect(out).toBe('驳回类型：创造性（A22.3）；涉及权项：1、2')
    expect(out).not.toContain('rejectionTypes')
  })

  it('摘要缺席（重放路径不跑原子）时退回原文并注明', () => {
    const out = projectConsumedOutput('parse#oa-summary', parsed, {})
    expect(out).toBe(`（该阶段未产出中文摘要，以下为解析结果原文）\n${parsed}`)
  })
})

describe('projectConsumedOutput', () => {
  it('条目不带投影时原样交出（向后兼容）', () => {
    expect(projectConsumedOutput('claim-chart', '{}', {})).toBe('{}')
  })

  it('未注册的投影 fail-loud，不静默退回全文', () => {
    expect(() => projectConsumedOutput('claim-chart#rows-x', '{}', {})).toThrow(/未注册的投影/)
  })

  it('注册表与键集合一一对应（键集合是校验用的投影名册）', () => {
    expect([...CONSUME_PROJECTION_KEYS].sort()).toEqual(Object.keys(CONSUME_PROJECTORS).sort())
    expect(CONSUME_PROJECTION_KEYS.has('claim-chart#rows')).toBe(true)
    expect(CONSUME_PROJECTION_KEYS.has('parse#oa-summary')).toBe(true)
  })
})
