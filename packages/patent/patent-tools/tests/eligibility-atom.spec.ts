import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type {
  ConstitutionalRule,
  PipelineState,
} from '@deepseek-ai/dsh-patent-core'
import {
  DEFAULT_ELIGIBILITY_CLAIMS_KEYS,
  DEFAULT_ELIGIBILITY_TEXT_KEYS,
  EligibilityHandler,
  eligibilityAtom,
  loadEligibilityRules,
  type EligibilityCategory,
  type EligibilityCheckLoader,
  type EligibilityPending,
  type EligibilityUnit,
  type EligibilityVerdict,
  type EligibilityViolation,
} from '../src/atoms/eligibility.ts'

const A5_RULE: ConstitutionalRule = {
  id: 'EX-SEL-004',
  name: '不授权—违反法律与公序良俗',
  severity: 'critical',
  action: 'warn',
  legalBasis: '专利法第5条；审查指南第二部分第一章3.1.1',
  check: { type: 'keyword_blocklist', keywords: ['赌博', '克隆人'] },
}

const fakeLoader: EligibilityCheckLoader = () => ({
  rule: A5_RULE,
  missingIds: [],
  warnings: [],
})

type EligibilityOutput = {
  eligibility_report: string
  eligibility_passed: boolean
  eligibility_verdict: EligibilityVerdict
  eligibility_violations: EligibilityViolation[]
  eligibility_units: EligibilityUnit[]
  eligibility_pending: EligibilityPending[]
}

/**
 * 读取并校验原子输出。
 * @param output - 阶段输出。
 * @returns 收窄后的输出。
 */
function readOutput(output: PipelineState): EligibilityOutput {
  const report = output.eligibility_report
  const passed = output.eligibility_passed
  const verdict = output.eligibility_verdict
  const violations = output.eligibility_violations
  const units = output.eligibility_units
  const pending = output.eligibility_pending
  if (
    typeof report !== 'string'
    || typeof passed !== 'boolean'
    || (verdict !== 'eligible' && verdict !== 'needs-review' && verdict !== 'excluded')
    || !Array.isArray(violations)
    || !Array.isArray(units)
    || !Array.isArray(pending)
  ) {
    throw new Error('eligibility 输出缺少约定的键')
  }
  return {
    eligibility_report: report,
    eligibility_passed: passed,
    eligibility_verdict: verdict,
    eligibility_violations: violations as EligibilityViolation[],
    eligibility_units: units as EligibilityUnit[],
    eligibility_pending: pending as EligibilityPending[],
  }
}

/**
 * 读取降级原因。
 * @param output - 阶段输出。
 * @returns 错误文本。
 */
function degradedReason(output: PipelineState): string {
  const error = output._error
  if (typeof error !== 'string') throw new Error('expected degraded output')
  return error
}

const codes = (output: EligibilityOutput): string[] =>
  output.eligibility_violations.map(violation => violation.code)

const categories = (output: EligibilityOutput): EligibilityCategory[] =>
  output.eligibility_units.map(unit => unit.category)

describe('eligibility atom', () => {
  const handler = new EligibilityHandler(fakeLoader)

  it('声明的输出以报告为主输出，输入覆盖权利要求与技术方案键', () => {
    expect(eligibilityAtom.name).toBe('eligibility')
    expect(eligibilityAtom.category).toBe('gate')
    expect(eligibilityAtom.outputSchema[0]).toBe('eligibility_report')
    expect(eligibilityAtom.inputSchema).toEqual(expect.arrayContaining([
      ...DEFAULT_ELIGIBILITY_CLAIMS_KEYS,
      ...DEFAULT_ELIGIBILITY_TEXT_KEYS,
    ]))
  })

  it('技术方案落入 A2 客体 → 通过（G-4 正例）', async () => {
    const output = readOutput(await handler.execute({
      state: {
        claims: '1. 一种阀体，包括阀座、阀芯和弹簧，所述阀芯可滑动地安装在所述阀座内。',
      },
    }))
    expect(output.eligibility_passed).toBe(true)
    expect(output.eligibility_verdict).toBe('eligible')
    expect(output.eligibility_violations).toEqual([])
    expect(output.eligibility_report).toContain('通过（未发现 A25 排除事由）')
    expect(categories(output)).toEqual(['technical-solution'])
  })

  it('纯智力活动规则 → A25.1(2) 阻断（G-4 反例）', async () => {
    const output = readOutput(await handler.execute({
      state: {
        claims: '1. 一种游戏规则，包括：玩家依次抽取卡牌；比较点数大小；点数大者获胜。',
      },
    }))
    expect(output.eligibility_passed).toBe(false)
    expect(output.eligibility_verdict).toBe('excluded')
    expect(codes(output)).toEqual(['ELIG-A25-MENTAL'])
    expect(output.eligibility_violations[0]?.severity).toBe('block')
    expect(output.eligibility_report).toContain('A25.1(2)')
  })

  it('疾病治疗方法 → A25.1(3) 阻断（G-4 反例）', async () => {
    const output = readOutput(await handler.execute({
      state: {
        claims: '1. 一种治疗糖尿病的方法，包括：向患者给予二甲双胍。',
      },
    }))
    expect(output.eligibility_passed).toBe(false)
    expect(codes(output)).toEqual(['ELIG-A25-MEDICAL'])
    expect(output.eligibility_report).toContain('A25.1(3)')
  })

  it('治疗药物、诊断试剂等产品权利要求不按治疗方法排除', async () => {
    for (const claim of [
      '1. 一种用于治疗糖尿病的药物组合物，包含二甲双胍和药学上可接受的载体。',
      '1. 一种诊断试剂盒，包含抗体和显色底物。',
    ]) {
      const output = readOutput(await handler.execute({ state: { claims: claim } }))
      expect(output.eligibility_passed).toBe(true)
      expect(codes(output)).not.toContain('ELIG-A25-MEDICAL')
    }
  })

  it('“在制备药物中的应用”按用途权利要求处理，不按治疗方法排除', async () => {
    const output = readOutput(await handler.execute({
      state: { claims: '1. 化合物A在制备治疗糖尿病药物中的应用。' },
    }))
    expect(output.eligibility_passed).toBe(true)
    expect(categories(output)).toEqual(['medical-use'])
  })

  it('药物制备方法按制造方法处理，不按治疗方法排除', async () => {
    const output = readOutput(await handler.execute({
      state: { claims: '1. 一种化疗药物组合物的制备方法，包括：混合活性成分与辅料。' },
    }))
    expect(output.eligibility_passed).toBe(true)
    expect(codes(output)).not.toContain('ELIG-A25-MEDICAL')
  })

  it('手术机器人控制方法不按诊疗方法排除', async () => {
    const output = readOutput(await handler.execute({
      state: {
        claims: '1. 一种手术机器人控制方法，包括：获取机械臂位姿；调节关节角度。',
      },
    }))
    expect(output.eligibility_passed).toBe(true)
    expect(codes(output)).not.toContain('ELIG-A25-MEDICAL')
  })

  it('动植物品种本身 → A25.1(4) 阻断', async () => {
    const output = readOutput(await handler.execute({
      state: { claims: '1. 一种水稻品种，其特征在于具有抗倒伏性状。' },
    }))
    expect(output.eligibility_passed).toBe(false)
    expect(codes(output)).toEqual(['ELIG-A25-VARIETY'])
  })

  it('动植物品种生产方法 → 提示人的技术介入程度（A25.2）', async () => {
    const output = readOutput(await handler.execute({
      state: {
        claims: '1. 一种培育水稻品种的方法，包括：选择亲本；杂交；筛选抗倒伏植株。',
      },
    }))
    expect(output.eligibility_passed).toBe(true)
    expect(codes(output)).toEqual(['ELIG-A25-VARIETY-METHOD'])
    expect(output.eligibility_report).toContain('A25.2')
  })

  it('微生物菌株不属于动植物品种', async () => {
    const output = readOutput(await handler.execute({
      state: { claims: '1. 一种微生物菌株，保藏编号为 CGMCC No.12345。' },
    }))
    expect(output.eligibility_passed).toBe(true)
    expect(codes(output)).not.toContain('ELIG-A25-VARIETY')
  })

  it('原子核变换方法与所得物质阻断，核反应堆不阻断', async () => {
    const method = readOutput(await handler.execute({
      state: { claims: '1. 一种原子核变换方法，包括：用中子轰击靶核。' },
    }))
    expect(method.eligibility_passed).toBe(false)
    expect(codes(method)).toEqual(['ELIG-A25-NUCLEAR'])

    const reactor = readOutput(await handler.execute({
      state: { claims: '1. 一种核聚变反应堆，包括真空室和磁约束线圈。' },
    }))
    expect(reactor.eligibility_passed).toBe(true)
    expect(codes(reactor)).not.toContain('ELIG-A25-NUCLEAR')
  })

  it('智力活动主题含技术特征 → 不按 A25 阻断，但提示 A2.2 判断', async () => {
    const output = readOutput(await handler.execute({
      state: {
        claims: '1. 一种游戏方法，包括：通过终端显示游戏界面；接收用户操作并更新积分。',
      },
    }))
    expect(output.eligibility_passed).toBe(true)
    expect(output.eligibility_verdict).toBe('needs-review')
    expect(codes(output)).toEqual(['ELIG-A25-MENTAL'])
    expect(output.eligibility_violations[0]?.severity).toBe('warn')
    expect(output.eligibility_report).toContain('A2.2')
  })

  it('商业方法含技术特征 → 提示商业问题与技术问题的区分', async () => {
    const output = readOutput(await handler.execute({
      state: {
        claims: '1. 一种商业方法，包括：由处理器获取订单数据；计算折扣并生成结算单。',
      },
    }))
    expect(output.eligibility_passed).toBe(true)
    expect(codes(output)).toEqual(['ELIG-A2-BUSINESS'])
    expect(output.eligibility_report).toContain('商业问题')
  })

  it('边界主题未识别到技术特征 → 提示人工复核，不直接阻断', async () => {
    const output = readOutput(await handler.execute({
      state: { claims: '1. 一种分类方法，包括：按照规则将对象归入类别。' },
    }))
    expect(output.eligibility_passed).toBe(true)
    expect(output.eligibility_verdict).toBe('needs-review')
    expect(codes(output)).toEqual(['ELIG-A25-MENTAL'])
    expect(output.eligibility_violations[0]?.severity).toBe('warn')
  })

  it('未识别到任何技术特征 → 提示核实 A2.2 技术方案', async () => {
    const output = readOutput(await handler.execute({
      state: { claims: '1. 一种方法，包括步骤S1和S2。' },
    }))
    expect(output.eligibility_passed).toBe(true)
    expect(codes(output)).toEqual(['ELIG-A2-TECHNICAL-SIGNAL'])
  })

  it('复用 A5 规则：违反公序良俗的客体给提示而非阻断', async () => {
    const output = readOutput(await handler.execute({
      state: { claims: '1. 一种赌博设备，包括壳体和骰子。' },
    }))
    expect(output.eligibility_passed).toBe(true)
    expect(codes(output)).toContain('ELIG-A5-PUBLIC-ORDER')
    expect(output.eligibility_report).toContain('EX-SEL-004')
  })

  it('A5 规则资产缺失时列入待核，不静默跳过', async () => {
    const missing: EligibilityCheckLoader = () => ({ missingIds: ['EX-SEL-004'], warnings: [] })
    const output = readOutput(await new EligibilityHandler(missing).execute({
      state: { claims: '1. 一种阀体，包括阀座和阀芯。' },
    }))
    expect(output.eligibility_passed).toBe(true)
    expect(output.eligibility_verdict).toBe('needs-review')
    expect(output.eligibility_pending).toEqual([
      expect.objectContaining({ code: 'ELIG-A5-UNCHECKED' }),
    ])
  })

  it('A5 规则资产加载失败时列入待核', async () => {
    const loader: EligibilityCheckLoader = () => {
      throw new Error('asset broken')
    }
    const output = readOutput(await new EligibilityHandler(loader).execute({
      state: { claims: '1. 一种阀体，包括阀座和阀芯。' },
    }))
    expect(output.eligibility_pending).toHaveLength(1)
    expect(output.eligibility_pending[0]?.message).toContain('asset broken')
  })

  it('A5 规则资产警告列入待核，不静默丢弃', async () => {
    const loader: EligibilityCheckLoader = () => ({
      rule: A5_RULE,
      missingIds: [],
      warnings: ['rule EX-SEL-004: 示例警告'],
    })
    const output = readOutput(await new EligibilityHandler(loader).execute({
      state: { claims: '1. 一种阀体，包括阀座和阀芯。' },
    }))
    expect(output.eligibility_verdict).toBe('needs-review')
    expect(output.eligibility_pending).toEqual([
      expect.objectContaining({ code: 'ELIG-A5-ASSET-WARNING' }),
    ])
  })

  it('真实规则资产：EX-SEL-004 命中赌博设备', async () => {
    const output = readOutput(await new EligibilityHandler().execute({
      state: { claims: '1. 一种赌博设备，包括壳体和骰子。' },
    }))
    expect(codes(output)).toContain('ELIG-A5-PUBLIC-ORDER')
  })

  it('多权项逐一筛查，阻断项带权项号', async () => {
    const output = readOutput(await handler.execute({
      state: {
        claims: [
          '1. 一种阀体，包括阀座和阀芯。',
          '2. 一种治疗糖尿病的方法，包括：向患者给予二甲双胍。',
        ].join('\n'),
      },
    }))
    expect(output.eligibility_units).toHaveLength(2)
    expect(output.eligibility_passed).toBe(false)
    expect(output.eligibility_violations[0]?.claimNo).toBe(2)
    expect(output.eligibility_report).toContain('权利要求 2')
    expect(output.eligibility_report).toContain('共 2 项')
  })

  it('无权利要求时按技术交底书整体筛查', async () => {
    const output = readOutput(await handler.execute({
      state: { source_text: '本发明涉及一种游戏规则，玩家依次抽牌并比较点数。' },
    }))
    expect(output.eligibility_passed).toBe(false)
    expect(output.eligibility_report).toContain('技术交底书/技术方案')
    expect(output.eligibility_units).toHaveLength(1)
    expect(output.eligibility_units[0]?.claimNo).toBeUndefined()
  })

  it('阶段参数可覆盖权利要求键', async () => {
    const output = readOutput(await handler.execute({
      state: {
        draft: '1. 一种治疗糖尿病的方法，包括：向患者给予二甲双胍。',
        claims_key: 'draft',
      },
    }))
    expect(codes(output)).toEqual(['ELIG-A25-MEDICAL'])
  })

  it('阶段参数非法时降级', async () => {
    const invalidClaims = await handler.execute({
      state: { claims: '1. 一种阀体。', claims_key: ' ' },
    })
    expect(degradedReason(invalidClaims)).toContain('claims_key')
    const invalidText = await handler.execute({
      state: { claims: '1. 一种阀体。', text_key: 1 },
    })
    expect(degradedReason(invalidText)).toContain('text_key')
  })

  it('缺少文本时降级', async () => {
    const output = await handler.execute({ state: {} })
    expect(degradedReason(output)).toContain('未提供权利要求或技术方案文本')
  })

  it('文本类型错误时降级', async () => {
    const output = await handler.execute({ state: { claims: 1 } })
    expect(degradedReason(output)).toContain('state.claims 不是字符串')
  })

  it('报告固定写出限制说明与总体结论', async () => {
    const output = readOutput(await handler.execute({
      state: { claims: '1. 一种阀体，包括阀座和阀芯。' },
    }))
    expect(output.eligibility_report).toContain('限制说明')
    expect(output.eligibility_report).toContain('结论为 eligible')
    expect(output.eligibility_report).toContain('最终客体结论需人工复核')
  })

  it('技术方案键类型错误时降级', async () => {
    const output = await handler.execute({ state: { source_text: 1 } })
    expect(degradedReason(output)).toContain('state.source_text 不是字符串')
  })

  it('技术方案里出现权利要求标记时按权项切分', async () => {
    const output = readOutput(await handler.execute({
      state: {
        source_text: ['1. 一种阀体，其特征在于，包括阀座。', '2. 一种治疗糖尿病的方法，包括：向患者给予二甲双胍。'].join('\n'),
      },
    }))
    expect(output.eligibility_report).toContain('审查对象：权利要求（共 2 项）')
    expect(output.eligibility_passed).toBe(false)
  })

  it('声明为权利要求但没有任何编号权项时按整体文本筛查', async () => {
    const output = readOutput(await handler.execute({
      state: { claims: '权利要求书：一种阀体，包括阀座和阀芯。' },
    }))
    expect(output.eligibility_units).toHaveLength(1)
    expect(output.eligibility_units[0]?.claimNo).toBeUndefined()
  })

  it('科学发现与印刷品图案设计各给提示', async () => {
    const discovery = readOutput(await handler.execute({
      state: { claims: '1. 一种科学发现，涉及自然规律。' },
    }))
    expect(categories(discovery)).toEqual(['discovery'])
    expect(codes(discovery)).toEqual(['ELIG-A25-DISCOVERY'])
    expect(discovery.eligibility_report).toContain('A25.1(1)')

    const printed = readOutput(await handler.execute({
      state: { claims: '1. 一种印刷品的图案设计。' },
    }))
    expect(categories(printed)).toEqual(['printed-matter'])
    expect(codes(printed)).toEqual(['ELIG-A25-PRINTED'])
    expect(printed.eligibility_report).toContain('A25.1(6)')
  })

  it('计算机程序本身即使命中强标记仍按智力活动排除', async () => {
    const output = readOutput(await handler.execute({
      state: { claims: '1. 一种计算机程序本身，运行于处理器。' },
    }))
    expect(categories(output)).toEqual(['mental-activity'])
    expect(output.eligibility_passed).toBe(false)
  })

  it('商业主题只命中弱技术标记时提示商业问题', async () => {
    const output = readOutput(await handler.execute({
      state: { claims: '1. 一种商业方法，包括：处理数据。' },
    }))
    expect(categories(output)).toEqual(['business-method'])
    expect(output.eligibility_verdict).toBe('needs-review')
  })

  it('边界主题命中强技术标记时按技术方案处理', async () => {
    const output = readOutput(await handler.execute({
      state: { claims: '1. 一种分类方法，包括：由处理器对图像进行分类。' },
    }))
    expect(categories(output)).toEqual(['technical-solution'])
    expect(output.eligibility_passed).toBe(true)
  })

  it('规则资产缺失且没有编号清单时报告默认规则编号', async () => {
    const loader: EligibilityCheckLoader = () => ({ missingIds: [], warnings: [] })
    const output = readOutput(await new EligibilityHandler(loader).execute({
      state: { claims: '1. 一种阀体，包括阀座和阀芯。' },
    }))
    expect(output.eligibility_pending[0]?.message).toContain('EX-SEL-004')
  })

  it('规则资产警告超过三条时注明总数', async () => {
    const loader: EligibilityCheckLoader = () => ({
      rule: A5_RULE,
      missingIds: [],
      warnings: ['w1', 'w2', 'w3', 'w4'],
    })
    const output = readOutput(await new EligibilityHandler(loader).execute({
      state: { claims: '1. 一种阀体，包括阀座和阀芯。' },
    }))
    expect(output.eligibility_pending[0]?.message).toContain('等 4 条')
  })

  it('规则命中但证据为空且没有法律依据时省略两个字段', async () => {
    const rule: ConstitutionalRule = {
      id: 'EX-SEL-004',
      name: '无依据规则',
      severity: 'critical',
      action: 'warn',
      check: { type: 'pattern_analysis', patterns: ['z*'], minMatches: 1 },
    }
    const loader: EligibilityCheckLoader = () => ({ rule, missingIds: [], warnings: [] })
    const output = readOutput(await new EligibilityHandler(loader).execute({
      state: { claims: '1. 一种阀体，包括阀座和阀芯。' },
    }))
    const finding = output.eligibility_violations.find(item => item.code === 'ELIG-A5-PUBLIC-ORDER')
    expect(finding?.legalBasis).toBeUndefined()
    expect(finding?.evidence).toBeUndefined()
    expect(output.eligibility_report).not.toContain('依据：')
  })

  it('规则加载抛出非 Error 时仍列入待核', async () => {
    const loader: EligibilityCheckLoader = () => {
      throw 'asset broken'
    }
    const output = readOutput(await new EligibilityHandler(loader).execute({
      state: { claims: '1. 一种阀体，包括阀座和阀芯。' },
    }))
    expect(output.eligibility_pending[0]?.message).toContain('asset broken')
  })
})

describe('loadEligibilityRules', () => {
  it('资产缺少 EX-SEL-004 时报告规则缺失', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-elig-rules-'))
    try {
      const patentDir = join(root, 'patent')
      mkdirSync(patentDir)
      writeFileSync(
        join(patentDir, 'compliance.yaml'),
        'rules:\n  - id: C1\n    name: 其它规则\n    severity: minor\n    action: warn\n    check: { type: keyword_blocklist, keywords: ["x"] }\n',
        'utf8',
      )
      const loaded = loadEligibilityRules(root)
      expect(loaded.rule).toBeUndefined()
      expect(loaded.missingIds).toEqual(['EX-SEL-004'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
