import { describe, expect, it } from 'vitest'
import type { ConstitutionalRule } from '@deepseek-ai/dsh-patent-core'
import { parseOfficeAction } from '@deepseek-ai/dsh-patent-core'
import {
  DUAL_INPUT_CHECK_TYPES,
  evaluateDualRule,
  evaluateText,
  isDualInputCheck,
  loadPatentFullRuleSet,
} from '@deepseek-ai/dsh-patent-rule'

const full = loadPatentFullRuleSet().ruleSet

/** 取随包规则（资产缺规则时立即失败，而不是静默跳过用例）。 */
function rule(id: string): ConstitutionalRule {
  const found = full.rules.find(candidate => candidate.id === id)
  if (found === undefined) throw new Error(`规则集缺少 ${id}`)
  return found
}

describe('双输入检查族', () => {
  it('族守卫只认两个双输入类型', () => {
    expect([...DUAL_INPUT_CHECK_TYPES]).toEqual(['notice_ground_coverage', 'unraised_statute_citation'])
    expect(isDualInputCheck('notice_ground_coverage')).toBe(true)
    expect(isDualInputCheck('unraised_statute_citation')).toBe(true)
    expect(isDualInputCheck('keyword_blocklist')).toBe(false)
    expect(isDualInputCheck('structural_analysis')).toBe(false)
  })

  it('规则资产声明 PR-OA-008/009，域为答复域、级别 warn', () => {
    expect(rule('PR-OA-008').check).toEqual({ type: 'notice_ground_coverage' })
    expect(rule('PR-OA-009').check).toEqual({ type: 'unraised_statute_citation' })
    for (const id of ['PR-OA-008', 'PR-OA-009']) {
      expect(rule(id).domain).toBe('patent_oa_response')
      expect(rule(id).action).toBe('warn')
    }
  })

  it('单文本评估跳过双输入族（由 evaluateDualRule 执行）', () => {
    const evaluation = evaluateText(
      '本申请符合专利法第26条第3款的规定。',
      full,
      undefined,
      { domain: ['patent_oa_response'] },
    )
    expect(evaluation.violations.some(v => v.ruleId === 'PR-OA-008' || v.ruleId === 'PR-OA-009')).toBe(false)
  })
})

describe('evaluateDualRule：驳回理由覆盖（漏答检出）', () => {
  const notice = parseOfficeAction(
    '权利要求 1-2 不具备创造性，不符合专利法第22条第3款的规定；权利要求 3 的保护范围不清楚，不符合专利法第26条第4款的规定。',
  )

  it('漏答通知书提出的理由即违规并点名缺失项', () => {
    const violation = evaluateDualRule(rule('PR-OA-008'), {
      notice,
      response: '关于创造性：对比文件 1 与 2 的结合无技术启示，权利要求 1 具备创造性。',
    })
    expect(violation?.ruleId).toBe('PR-OA-008')
    expect(violation?.message).toContain('不清楚')
    expect(violation?.evidence).toEqual(['不清楚'])
    expect(violation?.action).toBe('warn')
  })

  it('逐条覆盖时无违规', () => {
    const violation = evaluateDualRule(rule('PR-OA-008'), {
      notice,
      response: '关于创造性：三段论述。关于不清楚：修改权利要求 3 的表述以克服不清楚缺陷。',
    })
    expect(violation).toBeNull()
  })
})

describe('evaluateDualRule：未提条款引用', () => {
  const notice = parseOfficeAction('权利要求 1-2 不具备创造性，不符合专利法第22条第3款的规定。')

  it('引用通知书未提出的驳回条款即违规并给出引用原文', () => {
    const violation = evaluateDualRule(rule('PR-OA-009'), {
      notice,
      response: '本申请符合专利法第26条第3款关于充分公开的要求。',
    })
    expect(violation?.ruleId).toBe('PR-OA-009')
    expect(violation?.evidence).toEqual(['专利法第26条第3款'])
    expect(violation?.message).toContain('主动澄清')
  })

  it('同条不带款号命中族内已提条款、族外条款与非专利法引用不误报', () => {
    expect(evaluateDualRule(rule('PR-OA-009'), {
      notice,
      response: '本申请符合专利法第22条的规定。',
    })).toBeNull()
    expect(evaluateDualRule(rule('PR-OA-009'), {
      notice,
      response: '本申请不属于专利法第2条第3款所称的实用新型客体。',
    })).toBeNull()
    expect(evaluateDualRule(rule('PR-OA-009'), {
      notice,
      response: '依据专利法实施细则第57条第3款提出修改。',
    })).toBeNull()
  })

  it('规则未声明依据时不出现依据（透传规则自身）', () => {
    const bare: ConstitutionalRule = {
      id: 'T-BARE',
      name: '无依据规则',
      severity: 'major',
      action: 'warn',
      check: { type: 'notice_ground_coverage' },
    }
    const violation = evaluateDualRule(bare, {
      notice: parseOfficeAction('权利要求 1 不具备创造性，不符合专利法第22条第3款的规定。'),
      response: '答辩。',
    })
    expect(violation?.ruleId).toBe('T-BARE')
    expect(violation?.legalBasis).toBeUndefined()
  })

  it('通知书未识别到具体条款时不评估', () => {
    const empty = parseOfficeAction('本通知书随文送达，请按期答复。')
    expect(evaluateDualRule(rule('PR-OA-009'), {
      notice: empty,
      response: '本申请符合专利法第26条第3款的规定。',
    })).toBeNull()
  })
})
