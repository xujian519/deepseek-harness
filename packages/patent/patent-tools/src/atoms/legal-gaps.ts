/**
 * 法条缺口聚合原子：把各确定性检查阶段的产出映射回法条，汇总“未通过 / 未评估”项。
 *
 * 只做覆盖汇总，不判断实体结论：某条法条对应检查通过，表示该检查已运行且未报违规，
 * 不表示权利要求或答复在实体上必然成立。没有对应检查产出的法条列为“未评估”，由人工
 * 复核；这样既不会把缺输入误当成合规，也不会因为一项检查缺失就让整个工作流失败。
 *
 * 每个案件类型（manifest）通过 `params.profile` 选定检查清单；未提供或取值未知时降级，
 * 不猜测案件类型。
 */

import {
  degraded,
  type Atom,
  type PipelineState,
  type StageExecuteInput,
  type StageHandler,
} from '@deepseek-ai/dsh-patent-core'

/** 支持的法条缺口清单类型（与内置 manifest 一一对应）。 */
export const LEGAL_GAP_PROFILES = [
  'novelty',
  'disclosure',
  'inventiveness',
  'patentability',
  'oa-response',
  'invalidation',
  'reexamination',
  'infringement',
] as const

/** 法条缺口清单类型。 */
export type LegalGapProfile = (typeof LEGAL_GAP_PROFILES)[number]

/** 单条法条检查的状态：通过、未通过、未评估、本程序不适用。 */
export type LegalGapStatus = 'passed' | 'failed' | 'not-assessed' | 'not-applicable'

/** 缺口严重度：阻断只用于确定性检查已明示失败的项，未评估项一律提示。 */
export type LegalGapSeverity = 'block' | 'warn'

/** 单条法条检查的汇总结果。 */
export type LegalGapItem = {
  /** 稳定检查编号（如 `response-compliance`）。 */
  id: string
  /** 法条或指南节号（可复核依据）。 */
  provision: string
  /** 检查项名称。 */
  label: string
  /** 汇总状态。 */
  status: LegalGapStatus
  /** 失败时的处置等级；未评估与通过项保留声明的等级供调用方排序。 */
  severity: LegalGapSeverity
  /** 状态依据（读取了哪个状态键、失败或待核数量）。 */
  evidence: string
}

/**
 * 一条法条检查的声明：哪些状态键证明检查已运行，哪个键表示失败或待核，
 * 以及本程序是否根本不适用该法条。
 */
export type LegalGapCheckpoint = {
  id: string
  provision: string
  label: string
  severity: LegalGapSeverity
  /** 任一键有值即视为该检查已运行。 */
  assessKeys: readonly string[]
  /** 该键为 `false` 时判定检查失败。 */
  failureKey?: string
  /** 该键为非空数组时判定存在待核项。 */
  pendingKey?: string
  /** 返回 true 时检查虽产出报告但没有实际执行（如缺证据清单），记为未评估而非通过。 */
  notAssessed?: (state: PipelineState) => boolean
  /** 返回 true 时该法条在本程序中不适用。 */
  notApplicable?: (state: PipelineState) => boolean
}

/** 时间基准检查：新颖性、披露、创造性与可专利性共用。 */
const TIME_BASELINE_CHECK: LegalGapCheckpoint = {
  id: 'time-baseline',
  provision: '专利法第22条第5款',
  label: '现有技术时间基准',
  severity: 'warn',
  assessKeys: ['reference_date'],
}

/** 宽限期检查：新颖性、披露、创造性与可专利性共用。 */
const GRACE_PERIOD_CHECK: LegalGapCheckpoint = {
  id: 'grace-period',
  provision: '专利法第24条',
  label: '宽限期公开',
  severity: 'warn',
  assessKeys: ['prior_art_filter_report'],
}

/** 可专利客体检查：披露与可专利性共用。 */
const ELIGIBILITY_CHECK: LegalGapCheckpoint = {
  id: 'eligibility',
  provision: '专利法第2条第2款、第5条、第25条',
  label: '可专利客体',
  severity: 'block',
  assessKeys: ['eligibility_report'],
  failureKey: 'eligibility_passed',
  pendingKey: 'eligibility_pending',
}

/** 权利要求支持与单一性检查：披露与可专利性共用。 */
const CLAIM_SUPPORT_CHECK: LegalGapCheckpoint = {
  id: 'claim-support',
  provision: '专利法第26条第4款、第31条第1款',
  label: '权利要求支持与单一性',
  severity: 'block',
  assessKeys: ['spec_check_report'],
  failureKey: 'spec_check_passed',
}

/** 充分公开检查：只在 spec-check 的 spec 模式运行后视为已评估，与权项检查分开。 */
const ENABLEMENT_CHECK: LegalGapCheckpoint = {
  id: 'enablement',
  provision: '专利法第26条第3款',
  label: '充分公开',
  severity: 'warn',
  assessKeys: ['specification_check_report'],
  failureKey: 'specification_check_passed',
}

/** 证据审查：无效与复审共用。 */
const EVIDENCE_CHECK: LegalGapCheckpoint = {
  id: 'evidence',
  provision: '审查指南第四部分第三章4.3.2',
  label: '证据形式、举证期限与关联性',
  severity: 'block',
  assessKeys: ['evidence_check_report'],
  failureKey: 'evidence_check_passed',
  pendingKey: 'evidence_check_pending',
  notAssessed: (state) => {
    const report = state['evidence_check_report']
    return typeof report === 'string' && report.includes('未执行')
  },
}

/** 各案件类型的法条检查清单；顺序即报告顺序。 */
export const LEGAL_GAP_CHECKS: Record<LegalGapProfile, readonly LegalGapCheckpoint[]> = {
  novelty: [
    TIME_BASELINE_CHECK,
    GRACE_PERIOD_CHECK,
    {
      id: 'conflicting-application',
      provision: '专利法第22条第2款',
      label: '抵触申请',
      severity: 'warn',
      assessKeys: ['conflicting_application_report'],
      pendingKey: 'conflicting_application_unknown',
    },
    {
      id: 'novelty',
      provision: '专利法第22条第2款',
      label: '新颖性单独对比',
      severity: 'warn',
      assessKeys: ['novelty_conclusion', 'compare', 'conclude'],
    },
  ],
  disclosure: [
    ELIGIBILITY_CHECK,
    TIME_BASELINE_CHECK,
    GRACE_PERIOD_CHECK,
    {
      id: 'novelty',
      provision: '专利法第22条第2款',
      label: '新颖性单独对比',
      severity: 'warn',
      assessKeys: ['novelty_conclusion', 'novelty_result'],
    },
    CLAIM_SUPPORT_CHECK,
    ENABLEMENT_CHECK,
  ],
  inventiveness: [
    {
      id: 'problem',
      provision: '专利法第22条第3款',
      label: '三步法技术问题的确定',
      severity: 'block',
      assessKeys: ['problem_check_report'],
      failureKey: 'problem_check_passed',
    },
    {
      id: 'inventiveness',
      provision: '专利法第22条第3款',
      label: '创造性结论',
      severity: 'warn',
      assessKeys: ['inventiveness_conclusion', 'conclude'],
    },
    TIME_BASELINE_CHECK,
    GRACE_PERIOD_CHECK,
  ],
  patentability: [
    ELIGIBILITY_CHECK,
    TIME_BASELINE_CHECK,
    GRACE_PERIOD_CHECK,
    CLAIM_SUPPORT_CHECK,
    ENABLEMENT_CHECK,
  ],
  'oa-response': [
    {
      id: 'response-compliance',
      provision: '专利法第26条第3款、第26条第4款、第22条第2款、第22条第3款',
      label: '答复规范检查（PR-OA-007/008/009：26.3 判准落位、驳回理由覆盖、条款引用）',
      severity: 'block',
      assessKeys: ['response_check_report'],
      failureKey: 'response_check_passed',
      pendingKey: 'response_check_unevaluated',
    },
    {
      id: 'amendment-basis',
      provision: '专利法第33条',
      label: '修改依据（修改不得超出原说明书和权利要求书记载的范围）',
      severity: 'block',
      assessKeys: ['amendment_basis_report'],
      failureKey: 'amendment_basis_passed',
      notApplicable: state => state['amendment_basis_scope'] === '未检测到修改后权利要求',
    },
  ],
  invalidation: [
    EVIDENCE_CHECK,
    {
      id: 'novelty',
      provision: '专利法第22条第2款',
      label: '新颖性无效理由',
      severity: 'warn',
      assessKeys: ['novelty'],
    },
    {
      id: 'inventiveness',
      provision: '专利法第22条第3款',
      label: '创造性无效理由',
      severity: 'warn',
      assessKeys: ['inventiveness'],
    },
  ],
  reexamination: [
    EVIDENCE_CHECK,
    {
      id: 'novelty',
      provision: '专利法第22条第2款',
      label: '新颖性复审理由',
      severity: 'warn',
      assessKeys: ['novelty'],
    },
    {
      id: 'inventiveness',
      provision: '专利法第22条第3款',
      label: '创造性复审理由',
      severity: 'warn',
      assessKeys: ['inventiveness'],
    },
  ],
  infringement: [
    {
      id: 'protection-scope',
      provision: '专利法第59条',
      label: '保护范围与全面覆盖',
      severity: 'warn',
      assessKeys: ['claim_chart_doc', 'coverage_report'],
    },
    {
      id: 'prior-art-defense',
      provision: '专利法第62条',
      label: '现有技术抗辩',
      severity: 'warn',
      assessKeys: ['prior_art_defense_report'],
    },
  ],
}

/** 各案件类型在报告标题中的中文名称。 */
const PROFILE_LABELS: Record<LegalGapProfile, string> = {
  novelty: '新颖性分析',
  disclosure: '披露分析',
  inventiveness: '创造性分析',
  patentability: '可专利性分析',
  'oa-response': '审查意见答复',
  invalidation: '无效宣告',
  reexamination: '复审',
  infringement: '侵权比对',
}

/** 状态的中文标签。 */
const STATUS_LABELS: Record<LegalGapStatus, string> = {
  passed: '通过',
  failed: '未通过',
  'not-assessed': '未评估',
  'not-applicable': '不适用',
}

/** legal-gaps 原子：按案件类型汇总确定性检查的法条覆盖情况。 */
export const legalGapsAtom: Atom = {
  name: 'legal-gaps',
  description:
    '法条缺口聚合：按案件类型把确定性检查产出映射回法条，汇总未通过、未评估与不适用项并给可复核依据',
  category: 'gate',
  inputSchema: [
    'profile',
    'eligibility_report',
    'reference_date',
    'prior_art_filter_report',
    'conflicting_application_report',
    'novelty_conclusion',
    'novelty',
    'inventiveness',
    'spec_check_report',
    'specification_check_report',
    'problem_check_report',
    'response_check_report',
    'amendment_basis_report',
    'evidence_check_report',
    'claim_chart_doc',
    'coverage_report',
    'prior_art_defense_report',
  ],
  outputSchema: [
    'legal_gaps_report',
    'legal_gaps_passed',
    'legal_gaps_items',
    'legal_gaps_unassessed',
  ],
}

/** 状态键是否有值（非空字符串、非空数组或显式布尔/对象）；降级标记不算已评估。 */
function hasValue(value: unknown): boolean {
  if (typeof value === 'string') {
    const text = value.trim()
    return text.length > 0 && !text.startsWith('[WORKFLOW_DEGRADED]')
  }
  if (Array.isArray(value)) return value.length > 0
  return value !== undefined && value !== null
}

/** 读取待核项数量；非数组或缺失按 0 处理。 */
function pendingCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
}

/**
 * 评估一条法条检查。
 * @param state - 共享执行态。
 * @param checkpoint - 检查声明。
 * @returns 汇总项（含状态与可复核依据）。
 */
function evaluateCheckpoint(state: PipelineState, checkpoint: LegalGapCheckpoint): LegalGapItem {
  const base = {
    id: checkpoint.id,
    provision: checkpoint.provision,
    label: checkpoint.label,
    severity: checkpoint.severity,
  }
  if (checkpoint.notApplicable?.(state) === true) {
    return { ...base, status: 'not-applicable', evidence: '本程序未触发该法条' }
  }
  if (checkpoint.failureKey !== undefined && state[checkpoint.failureKey] === false) {
    return { ...base, status: 'failed', evidence: `state.${checkpoint.failureKey} = false` }
  }
  if (checkpoint.pendingKey !== undefined) {
    const pending = pendingCount(state[checkpoint.pendingKey])
    if (pending > 0) {
      return { ...base, status: 'not-assessed', evidence: `state.${checkpoint.pendingKey} 有 ${pending} 项待核` }
    }
  }
  if (checkpoint.notAssessed?.(state) === true) {
    return { ...base, status: 'not-assessed', evidence: `${checkpoint.assessKeys.join(' / ')} 报告本次未执行` }
  }
  const assessedKey = checkpoint.assessKeys.find(key => hasValue(state[key]))
  if (assessedKey !== undefined) {
    return { ...base, status: 'passed', evidence: `已由 state.${assessedKey} 评估` }
  }
  return {
    ...base,
    status: 'not-assessed',
    evidence: `未找到 ${checkpoint.assessKeys.join(' / ')}（该法条未被任何确定性阶段覆盖）`,
  }
}

/**
 * 渲染法条缺口报告。
 * @param profile - 案件类型。
 * @param items - 汇总项。
 * @returns 模型可读的中文报告。
 */
function renderReport(profile: LegalGapProfile, items: readonly LegalGapItem[]): string {
  const failed = items.filter(item => item.status === 'failed')
  const blocking = failed.filter(item => item.severity === 'block').length
  const unassessed = items.filter(item => item.status === 'not-assessed').length
  const applicable = items.filter(item => item.status !== 'not-applicable').length
  const header = blocking === 0
    ? `法条缺口汇总（${PROFILE_LABELS[profile]}）：无阻断项（${failed.length} 项未通过，${unassessed} 项未评估，共 ${applicable} 项）`
    : `法条缺口汇总（${PROFILE_LABELS[profile]}）：未通过（${blocking} 项阻断，${unassessed} 项未评估，共 ${applicable} 项）`
  return [
    header,
    ...items.map(item => `- [${STATUS_LABELS[item.status]}] ${item.provision} — ${item.label}\n  依据：${item.evidence}`),
    '限制说明：本原子只汇总确定性检查是否覆盖相应法条，不判断实体结论是否成立，也不替代审查意见；未评估项需人工复核。',
  ].join('\n')
}

/** 解析案件类型：`params.profile` 必须是已知取值。 */
function resolveProfile(state: PipelineState): LegalGapProfile | undefined {
  const raw = state['profile']
  if (typeof raw !== 'string') return undefined
  return (LEGAL_GAP_PROFILES as readonly string[]).includes(raw) ? (raw as LegalGapProfile) : undefined
}

/** legal-gaps 执行器：按案件类型汇总各确定性检查的法条覆盖情况。 */
export class LegalGapsHandler implements StageHandler {
  readonly name = 'legal-gaps'
  readonly category = 'gate' as const

  /**
   * 执行法条缺口汇总。
   * @param input - 阶段执行输入（state 携带 `profile` 与各检查产出）。
   * @returns `legal_gaps_report`（主输出）、`legal_gaps_passed`、`legal_gaps_items` 与 `legal_gaps_unassessed`。
   */
  // oxlint-disable-next-line typescript/require-await -- StageHandler contract requires async execute
  async execute(input: StageExecuteInput): Promise<PipelineState> {
    const profile = resolveProfile(input.state)
    if (profile === undefined) {
      return degraded('legal-gaps', `params.profile 必须是 ${LEGAL_GAP_PROFILES.join(' / ')} 之一`)
    }
    const items = LEGAL_GAP_CHECKS[profile].map(checkpoint => evaluateCheckpoint(input.state, checkpoint))
    const passed = !items.some(item => item.status === 'failed' && item.severity === 'block')
    return {
      legal_gaps_report: renderReport(profile, items),
      legal_gaps_passed: passed,
      legal_gaps_items: items,
      legal_gaps_unassessed: items.filter(item => item.status === 'not-assessed').map(item => item.id),
    }
  }
}
