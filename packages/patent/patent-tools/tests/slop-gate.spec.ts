import { describe, expect, it } from 'vitest'
import { SlopGateHandler } from '../src/atoms/slop-gate.ts'
import { analyzeSlop, type SlopAnalysis } from '../src/internal/slop-engine.ts'
import { buildSlopRevisionHint } from '../src/internal/retry-hints.ts'

const handler = new SlopGateHandler()

const CLEAN_DRAFT = [
  '本申请解决测量误差的控制问题，核心争点是反馈补偿环节。',
  '',
  '区别特征记载于 D1¶0123，与现有技术相比，本申请在补偿环节引入闭环反馈结构。',
  '',
  '对比文件 D1 公开了基础结构，本申请在反馈路径中增设误差积分器。',
].join('\n')

const SLOP_HEAVY_DRAFT = [
  '首先分析本申请的技术方案，再分析现有技术方案。',
  '',
  '进一步地，此外，值得一提的是，本申请具有显著进步。',
  '',
  '区别特征在于采用了新型结构。',
  '',
  '综上所述，保护范围合理。',
].join('\n')

// 10 个短语命中（删除型排前，替换型被截断到第 8 条之外）+ 1 个结构性问题，
// 超出 hint 的证据条数上限——验证「截断到 8 changes + 3 issues」与 residual 统计。
const SLOP_OVERFLOW_DRAFT = [
  '进一步地，此外，值得一提的是，不难发现，毋庸置疑，综上所述，诚如前述，显而易见地，深入分析，全面论述。',
  '',
  '区别特征在于采用了新型结构。',
  '',
  '综上所述，保护范围合理。',
].join('\n')

// 替换型命中（「深入分析→分析」「全面论述→论述」）在截断窗口内——覆盖替换型渲染分支。
const SLOP_REPLACEMENT_DRAFT = [
  '深入分析，全面论述。',
  '',
  '区别特征在于采用了新型结构。',
].join('\n')

// 无套话、无证据、无争点的三段式文本：total=34 < 通过线 35，但无可引证据。
const SLOP_FAIL_WITHOUT_EVIDENCE = [
  '本申请采用闭环结构。',
  '',
  '第二段描述方案 B。',
  '',
  '第三段描述方案 C。',
].join('\n')

describe('SlopGateHandler', () => {
  it('passes a clean draft and emits no revision hint', async () => {
    const analysis = analyzeSlop(CLEAN_DRAFT)
    expect(analysis.score.passed).toBe(true)
    const out = await handler.execute({ state: { claims_draft: CLEAN_DRAFT } })
    expect(out.slop_report).toMatch(/通过/)
    expect(out.slop_score).toBe(analysis.score.total)
    expect(out.slop_revision_hint).toBeUndefined()
  })

  it('flags a slop-heavy draft with 需修订 and writes an evidence-only hint', async () => {
    const analysis = analyzeSlop(SLOP_HEAVY_DRAFT)
    expect(analysis.score.passed).toBe(false)
    const out = await handler.execute({ state: { claims_draft: SLOP_HEAVY_DRAFT } })
    expect(out.slop_report).toMatch(/需修订/)
    expect(out.slop_score).toBe(analysis.score.total)
    expect(typeof out.slop_revision_hint).toBe('string')
  })

  it('flags a failed draft that carries no actionable evidence without a hint', async () => {
    const analysis = analyzeSlop(SLOP_FAIL_WITHOUT_EVIDENCE)
    expect(analysis.score.passed).toBe(false)
    expect(buildSlopRevisionHint(analysis)).toBeUndefined()
    const out = await handler.execute({ state: { claims_draft: SLOP_FAIL_WITHOUT_EVIDENCE } })
    expect(out.slop_report).toMatch(/需修订/)
    expect(out.slop_revision_hint).toBeUndefined()
  })

  it('degrades when claims_draft is missing or blank', async () => {
    const missing = await handler.execute({ state: {} })
    expect(String(missing._error)).toMatch(/输入为空/)
    const blank = await handler.execute({ state: { claims_draft: '   ' } })
    expect(String(blank._error)).toMatch(/输入为空/)
  })
})

describe('buildSlopRevisionHint secrecy contract', () => {
  it('never leaks score numbers or the pass line', () => {
    const hint = buildSlopRevisionHint(analyzeSlop(SLOP_HEAVY_DRAFT))
    expect(hint).toBeDefined()
    expect(hint).not.toMatch(/总分|通过线|directness|evidence|rhythm|practicality|concision/)
    expect(hint).toMatch(/修订方向/)
    expect(hint).toMatch(/命中套话表述|结构性问题/)
  })

  it('returns undefined when nothing actionable is hit', () => {
    const hint = buildSlopRevisionHint(analyzeSlop(CLEAN_DRAFT))
    expect(hint).toBeUndefined()
  })

  it('truncates evidence to the caps and reports the residual count', () => {
    const hint = buildSlopRevisionHint(analyzeSlop(SLOP_OVERFLOW_DRAFT))
    expect(hint).toBeDefined()
    expect(hint).toMatch(/另有 \d+ 处同类问题/)
    expect(hint!.match(/·/g)).toHaveLength(9) // 8 条 changes 上限 + 1 条 issue
  })

  it('renders replacement-type hits with an arrow to the suggested text', () => {
    const hint = buildSlopRevisionHint(analyzeSlop(SLOP_REPLACEMENT_DRAFT))
    expect(hint).toBeDefined()
    expect(hint).toMatch(/「深入分析」" → "分析"/)
    expect(hint).toMatch(/「全面论述」" → "论述"/)
    expect(hint).not.toMatch(/建议删除或改写/)
    expect(hint).not.toMatch(/另有 \d+ 处/)
  })

  it('renders an issue without a suggestion as a bare line reference', () => {
    const blankSuggestion: SlopAnalysis = {
      cleaned: '',
      changes: [],
      issues: [{ type: 'empty_three_step', line: 3, text: '区别特征模糊', suggestion: '' }],
      score: { directness: 0, evidence: 0, rhythm: 0, practicality: 0, concision: 0, total: 0, passed: false },
      checklist: [],
    }
    const hint = buildSlopRevisionHint(blankSuggestion)
    expect(hint).toMatch(/L3 行：`区别特征模糊`/)
    expect(hint).not.toMatch(/（\s*）/)
  })
})
