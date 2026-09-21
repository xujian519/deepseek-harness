/**
 * src/patent/response — 复审请求的准备段骨架（对比表 / A33 论证 / 质疑预演 / 口审时间线）。
 *
 * 输入 `identifyReexaminationGrounds` 的理由列表，输出各准备段的必填项、表格列、合议组
 * 可能质疑的问题与口审时间线阶段。全部是闭集表格，不调用模型，不产出案件结论。
 *
 * 口审两段（质疑预演、口审时间线）以 `oralHearing` 显式开关控制，默认关闭：不开庭的
 * 复审案件没有这两个环节。上游 `reexamination.go:90-95` 无任何构造器置 `oralHearing`
 * 为真，`reexamination_prepare.go` 的质疑预演与时间线因而是不可达代码；本模块把开关
 * 暴露给调用方，默认值与上游的实际行为一致。
 *
 * 与上游 Mady `domains/workflows/patent/reexamination_prepare.go` 的差异：
 * - A33 段不区分"有无修改超范围理由"。上游在无该理由时输出一段占位文字再给出论证框架，
 *   有该理由时给出另一套表；本模块两情形给同一套必填项——复审阶段随时可能提交修改替换
 *   页，论证框架不因驳回决定未提该理由而免做。
 * - 建议性文字不进本模块。"应考策略""注意事项"一类操作建议归技能层，本模块只输出必须
 *   落实的条目与表格列，条目内容由人填写。
 * - 技术特征对比表不出占位行。上游预置三行"（原权利要求特征1）…"占位数据并提示逐项
 *   填写，占位行会被当作已填内容；本模块只给表头列，行数由调用方按权项特征数给出。
 */

import type { GroundFinding, ReexaminationGround } from '../notice/index.ts'

/** 准备段中的一张表格：标题与列名（行数据由调用方按案情填写）。 */
export type PrepTable = {
  title: string
  columns: readonly string[]
}

/** 合议组可能质疑的一组问题，按复审理由分组。 */
export type RehearsalChallenge = {
  ground: ReexaminationGround
  /** 理由的中文标签，取自理由识别结果。 */
  label: string
  questions: readonly string[]
}

/** 口审陈述的一个阶段。 */
export type HearingPhase = {
  name: string
  /** 参考时长，如 `3-5 分钟`。 */
  minutes: string
  steps: readonly string[]
}

/** 复审准备段：按 `id` 区分内容形态。 */
export type ReexaminationSection =
  | { id: 'tech-comparison'; title: string; tables: readonly PrepTable[] }
  | { id: 'amendment-non-extension'; title: string; items: readonly string[]; basis: readonly string[] }
  | { id: 'challenge-rehearsal'; title: string; challenges: readonly RehearsalChallenge[] }
  | { id: 'hearing-timeline'; title: string; phases: readonly HearingPhase[] }

/** 复审准备的调用方选项。 */
export type ReexaminationPrepOptions = {
  /** 是否安排了口审；默认 `false`，此时不产出质疑预演与口审时间线两段。 */
  oralHearing?: boolean
}

/** 复审准备段集合。 */
export type ReexaminationPreparation = {
  oralHearing: boolean
  /** 参与准备的理由（按理由表序去重）。 */
  grounds: ReexaminationGround[]
  sections: ReexaminationSection[]
}

/** 技术特征对比表的列。 */
export const TECH_COMPARISON_TABLE: PrepTable = {
  title: '权利要求技术特征与对比文件对比表',
  columns: ['序号', '权利要求技术特征', '对比文件对应特征', '是否公开', '分析结论'],
}

/** 修改前后对比表的列。 */
export const AMENDMENT_COMPARISON_TABLE: PrepTable = {
  title: '修改前后特征对比',
  columns: ['修改项', '修改后内容', '原申请文件依据', '依据位置'],
}

/** A33 论证（修改不超范围）的必填项。 */
export const AMENDMENT_NON_EXTENSION_ITEMS: readonly string[] = [
  '修改内容概述',
  '逐项列明修改后的内容',
  '每处修改在原说明书或权利要求书中的记载位置',
  '每处修改是否可从原申请文件直接且毫无疑义地确定',
  '结论：修改未超出原说明书和权利要求书记载的范围',
]

/** A33 论证的依据。 */
export const AMENDMENT_NON_EXTENSION_BASIS: readonly string[] = [
  '专利法第33条（修改不得超出原说明书和权利要求书记载的范围）',
  '《专利法实施细则》关于复审阶段修改范围的规定（修改限于消除驳回决定指出的缺陷）',
  '《专利审查指南》关于修改超范围的判断标准（直接且毫无疑义地确定）',
]

/** 合议组质疑预演的问题表，表序即输出顺序。 */
export const CHALLENGE_QUESTIONS: Record<ReexaminationGround, readonly string[]> = {
  novelty: [
    '区别技术特征是否已被对比文件隐含公开',
    '该区别技术特征是否属于惯用手段或公知常识',
    '将对比文件与公知文献结合是否能得出权利要求的技术方案',
    '提交的修改是否足以克服新颖性缺陷',
  ],
  inventiveness: [
    '区别技术特征实际解决的技术问题是否认定正确',
    '现有技术整体上是否存在将该区别特征应用到最接近现有技术的技术启示',
    '技术效果是否可预料，是否存在预料不到的技术效果',
    '辅助判断因素（商业成功、长期需求、他人失败）是否成立',
  ],
  disclosure: [
    '说明书记载的内容是否足以使本领域技术人员能够实现该技术方案',
    '哪些技术手段属于本领域技术人员的常规实验范围',
    '参数或效果数据是否足以证明技术方案的可实现性',
    '说明书是否遗漏了实现技术方案所必需的内容',
  ],
  'claim-clarity': [
    '有争议的术语在说明书中是否有明确定义或示例',
    '权利要求的保护范围阅读说明书和附图后能否合理确定',
    '从属权利要求的引用关系是否存在不清楚之处',
    '权利要求是否得到说明书的支持',
  ],
  amendment: [
    '修改内容能否从原说明书和权利要求书中直接且毫无疑义地确定',
    '修改是否引入了原申请文件未记载的技术内容',
    '修改是否限于消除驳回决定指出的缺陷',
    '修改是否导致保护范围扩大',
  ],
  'utility-model-subject-matter': [
    '权利要求限定的技术方案是否属于对产品的形状、构造或其结合',
    '是否存在不属于实用新型保护客体的方法、功能或材料特征',
    '非客体特征能否通过删除或限缩消除',
  ],
}

/** 各理由在口审理由陈述阶段的陈述动作。 */
export const GROUND_ARGUMENT_ACTIONS: Record<ReexaminationGround, string> = {
  novelty: '论证新颖性',
  inventiveness: '论证创造性',
  disclosure: '论证充分公开',
  'claim-clarity': '论证清楚、支持',
  amendment: '论证修改合规',
  'utility-model-subject-matter': '论证客体合规',
}

/** 开场阶段的步骤。 */
const OPENING_STEPS: readonly string[] = [
  '确认请求人、代理机构与代理师身份及执业资格',
  '确认收到驳回决定及所附对比文件',
  '简述复审请求的核心观点',
  '说明是否提交修改文本及修改范围',
]

/** 合议组提问阶段的步骤。 */
const QUESTION_STEPS: readonly string[] = [
  '听取问题，确认理解后再回答',
  '围绕区别技术特征、技术效果与现有技术整体是否给出技术启示作答',
  '涉及修改的，指明每处修改在原申请文件中的出处',
  '涉及充分公开的，说明说明书足以使本领域技术人员实现',
  '不能当场回答的，请求记录在案并在指定期限内提交书面补充意见',
  '合议组提出新对比文件或新理由的，请求给予答辩期限',
]

/** 总结陈述阶段的步骤。 */
const CLOSING_STEPS: readonly string[] = [
  '重申驳回决定在事实认定或法律适用上的错误',
  '强调技术方案相对现有技术的改进',
  '表达配合提供补充材料与说明的意愿',
  '明确请求：撤销驳回决定，或发回原审查部门继续审查',
]

/**
 * 拼装口审时间线的四个阶段，理由陈述阶段按理由逐条展开。
 * @param findings - 理由识别结果。
 * @returns 四个阶段。
 */
function hearingPhases(findings: readonly GroundFinding<ReexaminationGround>[]): HearingPhase[] {
  return [
    { name: '开场', minutes: '3-5 分钟', steps: OPENING_STEPS },
    {
      name: '复审理由陈述',
      minutes: '10-15 分钟',
      steps: findings.map(finding => `${finding.label}——${GROUND_ARGUMENT_ACTIONS[finding.ground]}`),
    },
    { name: '合议组提问与应答', minutes: '15-20 分钟', steps: QUESTION_STEPS },
    { name: '总结陈述', minutes: '5 分钟', steps: CLOSING_STEPS },
  ]
}

/**
 * 由理由识别结果拼装复审准备段。
 * @param findings - `identifyReexaminationGrounds` 的理由识别结果。
 * @param options - 是否口审；缺省视为不口审。
 * @returns 准备段集合，段序为对比表、A33 论证、质疑预演、口审时间线。
 */
export function buildReexaminationPreparation(
  findings: readonly GroundFinding<ReexaminationGround>[],
  options?: ReexaminationPrepOptions,
): ReexaminationPreparation {
  const oralHearing = options?.oralHearing ?? false
  const unique = dedupeGrounds(findings)
  const tables: PrepTable[] = [TECH_COMPARISON_TABLE]
  // 修改超范围理由或复审阶段提交的修改，都需要修改前后对比表。
  if (unique.some(finding => finding.ground === 'amendment')) tables.push(AMENDMENT_COMPARISON_TABLE)

  const sections: ReexaminationSection[] = [
    { id: 'tech-comparison', title: '对比表', tables },
    {
      id: 'amendment-non-extension',
      title: '修改不超范围论证',
      items: AMENDMENT_NON_EXTENSION_ITEMS,
      basis: AMENDMENT_NON_EXTENSION_BASIS,
    },
  ]
  if (oralHearing) {
    sections.push({
      id: 'challenge-rehearsal',
      title: '合议组质疑预演',
      challenges: unique.map(finding => ({
        ground: finding.ground,
        label: finding.label,
        questions: CHALLENGE_QUESTIONS[finding.ground],
      })),
    })
    sections.push({ id: 'hearing-timeline', title: '口审陈述时间线', phases: hearingPhases(unique) })
  }

  return { oralHearing, grounds: unique.map(finding => finding.ground), sections }
}

/**
 * 按理由表序去重。
 * @param findings - 理由识别结果（表序）。
 * @returns 去重后的理由识别结果。
 */
function dedupeGrounds(
  findings: readonly GroundFinding<ReexaminationGround>[],
): GroundFinding<ReexaminationGround>[] {
  const seen = new Set<ReexaminationGround>()
  return findings.filter((finding) => {
    if (seen.has(finding.ground)) return false
    seen.add(finding.ground)
    return true
  })
}
