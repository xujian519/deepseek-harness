/**
 * 争议定位域原子：dispute-framing（粗定位）与 dispute-framing-refine（时间基准修正）。
 *
 * 两个原子都是确定性的：只从程序文书、`grounds`/`oa-parse` 的结构化产出与法条
 * 文字中收集「本案争哪几条法条、落在哪几项权利要求」，不判断实体结论，也不调用
 * 模型。粗定位放在 `parse` 之前，让后续解析带争议过滤器；修正放在时间基准/程序
 * 理由确定之后，只标注时间依据是否锁定，不改写已锁定的时间基准。
 */

import type { Atom } from '../../atom.ts'
import { type PipelineState, type StageExecuteInput, type StageHandler, getStateString } from '../../handler.ts'
import { readStateJson, readStateObject } from './state-json.ts'
import { degraded } from './llm.ts'

/** 争议定位结果中的一条法条候选。 */
export type DisputeCandidate = {
  /** 规范化法条编号（如 `A22.3`）。 */
  statute: string
  /** 中文标签（如 `专利法第22条第3款（创造性）`）。 */
  label: string
  /** 该候选的来源。 */
  source: 'office-action' | 'grounds' | 'text'
}

/** 修正后的候选：补充时间依据状态。 */
export type RefinedDisputeCandidate = DisputeCandidate & {
  /** 该法条的判断是否依赖现有技术时间基准。 */
  timeDependent: boolean
  /** `locked` = 已锁定截止日；`unverified` = 缺时间基准或时间基准降级。 */
  timeBasis: 'locked' | 'unverified'
}

/** 粗定位报告：候选法条、涉及权项与来源。 */
export type DisputeFraming = {
  candidates: DisputeCandidate[]
  claims: number[]
  source: DisputeCandidate['source'] | 'none'
}

/** 法条目录：条号 + 款号 → 标签。 */
const STATUTE_LABELS: ReadonlyMap<string, string> = new Map([
  ['A2.2', '专利法第2条第2款（技术方案客体）'],
  ['A2', '专利法第2条（发明创造定义）'],
  ['A5', '专利法第5条（违反法律/公序良俗）'],
  ['A9', '专利法第9条（禁止重复授权）'],
  ['A22', '专利法第22条（新颖性/创造性/实用性）'],
  ['A22.2', '专利法第22条第2款（新颖性）'],
  ['A22.3', '专利法第22条第3款（创造性）'],
  ['A22.4', '专利法第22条第4款（实用性）'],
  ['A22.5', '专利法第22条第5款（现有技术）'],
  ['A24', '专利法第24条（宽限期）'],
  ['A25', '专利法第25条（不授予专利权的客体）'],
  ['A26', '专利法第26条（说明书与权利要求）'],
  ['A26.3', '专利法第26条第3款（充分公开）'],
  ['A26.4', '专利法第26条第4款（清楚/支持）'],
  ['A31', '专利法第31条（单一性）'],
  ['A31.1', '专利法第31条第1款（单一性）'],
  ['A33', '专利法第33条（修改超范围）'],
  ['A59', '专利法第59条（保护范围）'],
  ['A62', '专利法第62条（现有技术抗辩）'],
])

/** 通知书与程序理由共用的理由 → 法条编号。 */
const COMMON_STATUTES: ReadonlyArray<readonly [string, string]> = [
  ['novelty', 'A22.2'],
  ['inventiveness', 'A22.3'],
  ['utility', 'A22.4'],
  ['disclosure', 'A26.3'],
  ['claim-clarity', 'A26.4'],
  ['amendment', 'A33'],
  ['subject-matter-art2', 'A2.2'],
  ['subject-matter-art5', 'A5'],
  ['subject-matter-art25', 'A25'],
]

/** 程序理由（grounds）→ 法条编号。 */
const GROUND_STATUTES: ReadonlyMap<string, string> = new Map([
  ...COMMON_STATUTES,
  ['necessary-features', 'A26.4'],
  ['divisional-amendment', 'A33'],
  ['double-patenting', 'A9'],
])

/** 通知书驳回类型（oa-parse 的 rejectionTypes）→ 法条编号。 */
const REJECTION_STATUTES: ReadonlyMap<string, string> = new Map(COMMON_STATUTES)

/**
 * 依赖现有技术时间基准的法条。实用性（A22.4）判断的是能否工业应用，与申请日/
 * 优先权日无关，故不在此列。
 */
const TIME_DEPENDENT = new Set(['A22.2', 'A22.3', 'A22.5', 'A24'])

/** 单次定位最多保留的候选数。 */
const MAX_CANDIDATES = 12

/** 单次定位最多保留的权项数。 */
const MAX_CLAIMS = 50

/** 中文数字（1-9）→ 数字。 */
const CHINESE_DIGIT: ReadonlyMap<string, number> = new Map([
  ['一', 1], ['二', 2], ['三', 3], ['四', 4], ['五', 5],
  ['六', 6], ['七', 7], ['八', 8], ['九', 9],
])

/**
 * 把条号/款号文本转成数字，支持阿拉伯数字与「二十六」「三十三」这类中文写法。
 * @param value - 条号或款号文本。
 * @returns 数字；无法识别时返回 undefined。
 */
function chineseNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  if (/^\d+$/.test(value)) return Number(value)
  if (value === '十') return 10
  const ten = value.indexOf('十')
  if (ten >= 0) {
    const tens = ten === 0 ? 1 : CHINESE_DIGIT.get(value.charAt(ten - 1))
    const onesText = value.slice(ten + 1)
    const ones = onesText === '' ? 0 : CHINESE_DIGIT.get(onesText)
    if (tens === undefined || ones === undefined) return undefined
    return tens * 10 + ones
  }
  return CHINESE_DIGIT.get(value)
}

/** 权项号去重、升序并限长；非正整数被丢弃。 */
function toClaims(claims: Iterable<number>): number[] {
  return [...new Set(claims)]
    .filter(value => Number.isInteger(value) && value > 0)
    .sort((a, b) => a - b)
    .slice(0, MAX_CLAIMS)
}

/** 把条号/款号规范化成法条编号；未收录的条号返回 undefined。 */
function statuteKey(article: number, paragraph: number | undefined): string | undefined {
  const key = paragraph === undefined ? `A${article}` : `A${article}.${paragraph}`
  return STATUTE_LABELS.has(key) ? key : undefined
}

/**
 * 从自由文本收集法条候选与权项号。
 * @param text - 程序文书或技术材料。
 * @returns 候选法条（去重）与权项号（升序）。
 */
export function scanDisputeText(text: string): { statutes: string[]; claims: number[] } {
  const statutes = new Set<string>()
  const full = /(?:专利法)?\s*第\s*(\d{1,2}|[一二三四五六七八九十]{1,3})\s*条(?:\s*第\s*([0-9一二三四五六七八九十]{1,2})\s*款)?/gu
  for (const match of text.matchAll(full)) {
    const article = chineseNumber(match[1])
    const paragraph = chineseNumber(match[2])
    if (article === undefined) continue
    const key = statuteKey(article, paragraph)
    if (key !== undefined) statutes.add(key)
  }
  const short = /\bA\s*(\d{1,2})(?:\.(\d))?\b/gu
  for (const match of text.matchAll(short)) {
    const key = statuteKey(Number(match[1]), match[2] === undefined ? undefined : Number(match[2]))
    if (key !== undefined) statutes.add(key)
  }
  return { statutes: [...statutes].slice(0, MAX_CANDIDATES), claims: scanClaimNumbers(text) }
}

/**
 * 从文本收集权利要求号，展开 `1-3` 这类区间。
 * @param text - 程序文书或技术材料。
 * @returns 升序去重的权项号。
 */
export function scanClaimNumbers(text: string): number[] {
  const claims = new Set<number>()
  const pattern = /权利要求\s*([0-9]+(?:\s*[-–~至]\s*[0-9]+)?(?:[\s、,，和及]*[0-9]+(?:\s*[-–~至]\s*[0-9]+)?)*)/gu
  for (const match of text.matchAll(pattern)) {
    /* v8 ignore next -- 正则第一捕获组是必选数字串，`?? ''` 只用于类型收窄 */
    const captured = match[1] ?? ''
    for (const part of captured.split(/[\s、,，和及]+/u)) {
      const range = /^(\d+)\s*[-–~至]\s*(\d+)$/u.exec(part)
      if (range !== null) {
        const start = Number(range[1])
        const end = Number(range[2])
        if (end >= start && end - start <= MAX_CLAIMS) {
          for (let n = start; n <= end; n += 1) claims.add(n)
        }
        continue
      }
      // 非区间片段只可能是数字（分隔符已被 split 去掉）；空片段会得到 0 并在下方过滤。
      claims.add(Number(part))
    }
  }
  return toClaims(claims)
}

/** 读取 JSON 对象状态键；缺失、不可读或不是对象时返回 undefined。 */
function readJsonRecord(state: PipelineState, key: string): Record<string, unknown> | undefined {
  return readStateObject(state, key)
}

/**
 * 把法条编号整理为候选（去重、限长）。
 * @param statutes - 已识别的法条编号。
 * @param source - 来源。
 * @returns 候选列表。
 */
function toCandidates(
  statutes: Iterable<string>,
  source: DisputeCandidate['source'],
): DisputeCandidate[] {
  return [...statutes].slice(0, MAX_CANDIDATES).map(statute => ({
    statute,
    /* v8 ignore next -- 候选只来自 STATUTE_LABELS 覆盖的理由表与正文条款 */
    label: STATUTE_LABELS.get(statute) ?? statute,
    source,
  }))
}

/**
 * 把结构化来源收集到的法条与权项整理为定位结果。
 * @param statutes - 已识别的法条编号。
 * @param claims - 涉及权项。
 * @param source - 来源。
 * @returns 去重、限长后的定位结果。
 */
function toFraming(
  statutes: ReadonlySet<string>,
  claims: readonly number[],
  source: 'office-action' | 'grounds',
): DisputeFraming {
  return {
    candidates: toCandidates(statutes, source),
    claims: toClaims(claims),
    source,
  }
}

/** 从 office_action 的结构化驳回类型与涉及权项收集候选。 */
function fromOfficeAction(state: PipelineState): DisputeFraming | undefined {
  const officeAction = readJsonRecord(state, 'office_action')
  if (officeAction === undefined) return undefined
  const statutes = new Set<string>()
  const types = Array.isArray(officeAction['rejectionTypes']) ? officeAction['rejectionTypes'] : []
  for (const type of types) {
    if (typeof type !== 'string') continue
    const statute = REJECTION_STATUTES.get(type)
    if (statute !== undefined) statutes.add(statute)
  }
  const affected = Array.isArray(officeAction['affectedClaims']) ? officeAction['affectedClaims'] : []
  const claims = affected.filter((value): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0)
  if (statutes.size === 0 && claims.length === 0) return undefined
  return toFraming(statutes, claims, 'office-action')
}

/** 从 grounds 的结构化理由收集候选（跳过否定表述）。 */
function fromGrounds(state: PipelineState): DisputeFraming | undefined {
  const findings = readStateJson(state, 'grounds')
  if (!Array.isArray(findings)) return undefined
  const statutes = new Set<string>()
  for (const finding of findings) {
    if (finding === null || typeof finding !== 'object') continue
    const record = finding as Record<string, unknown>
    if (record['negated'] === true) continue
    const ground = typeof record['ground'] === 'string' ? record['ground'] : ''
    const mapped = GROUND_STATUTES.get(ground)
    if (mapped !== undefined) {
      statutes.add(mapped)
      continue
    }
    const article = typeof record['article'] === 'string' ? record['article'] : ''
    for (const key of scanDisputeText(article).statutes) statutes.add(key)
  }
  if (statutes.size === 0) return undefined
  return toFraming(
    statutes,
    scanClaimNumbers(getStateString(state, 'claims') || getStateString(state, 'input')),
    'grounds',
  )
}

/**
 * 粗定位：优先使用已解析的通知书/程序理由，否则扫描正文。
 * @param state - 共享执行态。
 * @returns 争议候选、涉及权项与来源；无任何输入时返回 undefined。
 */
export function frameDispute(state: PipelineState): DisputeFraming | undefined {
  const structured = fromOfficeAction(state) ?? fromGrounds(state)
  if (structured !== undefined) return structured
  const text = getStateString(state, 'input') || getStateString(state, 'text') || getStateString(state, 'source_text')
  if (text.trim() === '') return undefined
  const { statutes, claims } = scanDisputeText(`${text}\n${getStateString(state, 'claims')}`)
  return {
    candidates: toCandidates(statutes, 'text'),
    claims,
    source: statutes.length > 0 ? 'text' : 'none',
  }
}

/**
 * 合并粗定位候选与已解析文书的结构化候选：同一法条以结构化来源为准，权项取并集。
 *
 * 粗定位阶段排在 parse/grounds 之前，当时只能读正文；结构化分支要在解析完成后由
 * 修正阶段补读，否则这两个分支在随包 OA/无效/复审 manifest 中永远不可达。
 * @param base - 粗定位候选与权项。
 * @param structured - 解析后的结构化候选与权项。
 * @returns 合并结果；没有结构化候选时原样返回粗定位。
 */
function mergeFraming(base: DisputeFraming, structured: DisputeFraming | undefined): DisputeFraming {
  if (structured === undefined) return base
  const byStatute = new Map<string, DisputeCandidate>()
  for (const candidate of base.candidates) byStatute.set(candidate.statute, candidate)
  for (const candidate of structured.candidates) byStatute.set(candidate.statute, candidate)
  return {
    candidates: [...byStatute.values()].slice(0, MAX_CANDIDATES),
    claims: [...new Set([...base.claims, ...structured.claims])].sort((a, b) => a - b).slice(0, MAX_CLAIMS),
    source: structured.source,
  }
}

/** 渲染粗定位报告。 */
function renderFraming(framing: DisputeFraming): string {
  if (framing.candidates.length === 0 && framing.claims.length === 0) {
    return [
      '争议粗定位：未从当前材料识别到法条或权项（不猜测争议）。',
      '说明：本阶段只做定位，不判断实体结论；解析阶段应按原文补全争议信息。',
    ].join('\n')
  }
  return [
    `争议粗定位（来源：${framing.source}）：${framing.candidates.length} 条候选法条，涉及权利要求 ${framing.claims.length > 0 ? framing.claims.join('、') : '未识别'}`,
    ...framing.candidates.map(candidate => `- ${candidate.statute} — ${candidate.label}`),
    '说明：本阶段只做定位，不判断实体结论；后续解析应围绕候选法条只提取相关事实。',
  ].join('\n')
}

/** dispute-framing 原子：粗定位争议法条与涉及权项。 */
export const disputeFramingAtom: Atom = {
  name: 'dispute-framing',
  description: '争议粗定位：从程序文书/已解析通知书/程序理由中收集候选法条与涉及权项（确定性，不调用模型）',
  category: 'extract',
  inputSchema: ['input', 'text', 'source_text', 'claims', 'office_action', 'grounds'],
  outputSchema: ['dispute_framing_report', 'dispute_framing_candidates', 'dispute_framing_claims', 'dispute_framing_source'],
}

/** dispute-framing 执行器。 */
export class DisputeFramingHandler implements StageHandler {
  readonly name = 'dispute-framing'
  readonly category = 'extract' as const

  /**
   * 收集争议候选。
   * @param input - 阶段执行输入（材料、通知书解析或程序理由）。
   * @returns 报告、候选数组、权项数组与来源；无输入时降级。
   */
  // oxlint-disable-next-line typescript/require-await -- StageHandler contract requires async execute
  async execute(input: StageExecuteInput): Promise<PipelineState> {
    const framing = frameDispute(input.state)
    if (framing === undefined) {
      return degraded('dispute-framing', '缺少争议定位材料（state.input / office_action / grounds 均为空）')
    }
    return {
      dispute_framing_report: renderFraming(framing),
      dispute_framing_candidates: framing.candidates,
      dispute_framing_claims: framing.claims,
      dispute_framing_source: framing.source,
    }
  }
}

/** dispute-framing-refine 原子：时间基准确定后标注候选法条的时间依据。 */
export const disputeFramingRefineAtom: Atom = {
  name: 'dispute-framing-refine',
  description: '争议定位修正：时间基准确定后标注候选法条的时间依据（不修改已锁定的时间基准）',
  category: 'compare',
  inputSchema: ['dispute_framing_candidates', 'dispute_framing_claims', 'reference_date', 'time_baseline_report'],
  outputSchema: ['dispute_framing_refined', 'dispute_framing_refined_candidates', 'time_basis_status'],
}

/** 来源标签是否是已知的定位来源。 */
function isFramingSource(value: unknown): value is DisputeCandidate['source'] {
  return value === 'office-action' || value === 'grounds' || value === 'text'
}

/** 读取候选数组；非法元素被丢弃。 */
function readCandidates(value: unknown): DisputeCandidate[] {
  if (!Array.isArray(value)) return []
  const candidates: DisputeCandidate[] = []
  for (const item of value) {
    if (item === null || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const statute = typeof record['statute'] === 'string' ? record['statute'].trim() : ''
    const label = typeof record['label'] === 'string' ? record['label'].trim() : ''
    const source = record['source']
    if (statute === '' || label === '') continue
    candidates.push({
      statute,
      label,
      source: isFramingSource(source) ? source : 'text',
    })
    if (candidates.length >= MAX_CANDIDATES) break
  }
  return candidates
}

/**
 * 修正争议定位：只补充时间依据状态。
 * @param state - 共享执行态（读取粗定位与时间基准，不写回）。
 * @returns 修正报告、候选与时间基准状态；无候选时仍返回可读报告。
 */
export function refineDispute(state: PipelineState): {
  candidates: RefinedDisputeCandidate[]
  timeBasis: 'locked' | 'unverified'
  report: string
} {
  const source = getStateString(state, 'dispute_framing_source')
  const rawClaims = state['dispute_framing_claims']
  const base: DisputeFraming = {
    candidates: readCandidates(state['dispute_framing_candidates']),
    claims: Array.isArray(rawClaims)
      ? toClaims(rawClaims.filter((value): value is number => typeof value === 'number'))
      : [],
    source: isFramingSource(source) ? source : 'none',
  }
  // parse/grounds 已跑完：补读结构化驳回类型/程序理由，让 OA 与无效/复审 manifest 的
  // 结构化分支真正生效；粗定位阶段的正文候选保留为补充。
  const candidates = mergeFraming(base, fromOfficeAction(state) ?? fromGrounds(state)).candidates
  const referenceDate = getStateString(state, 'reference_date').trim()
  const timeBasis: 'locked' | 'unverified' = referenceDate.length > 0 && !referenceDate.startsWith('[WORKFLOW_DEGRADED]')
    ? 'locked'
    : 'unverified'
  const refined: RefinedDisputeCandidate[] = candidates.map((candidate) => {
    const timeDependent = TIME_DEPENDENT.has(candidate.statute)
    return {
      ...candidate,
      timeDependent,
      timeBasis: timeDependent ? timeBasis : 'locked',
    }
  })
  const lines = refined.length === 0
    ? ['争议定位修正：粗定位没有候选法条，保持空集。']
    : [
      `争议定位修正：${refined.length} 条候选法条；时间依据${timeBasis === 'locked' ? `已锁定（${referenceDate}）` : '未锁定'}`,
      ...refined.map(candidate =>
        `- ${candidate.statute} — ${candidate.label}${candidate.timeDependent ? `（时间依据：${candidate.timeBasis}）` : ''}`,
      ),
    ]
  lines.push('约束：本阶段只标注时间依据，不改写已锁定的现有技术截止日。')
  return { candidates: refined, timeBasis, report: lines.join('\n') }
}

/** dispute-framing-refine 执行器。 */
export class DisputeFramingRefineHandler implements StageHandler {
  readonly name = 'dispute-framing-refine'
  readonly category = 'compare' as const

  /**
   * 标注时间依据；始终保留粗定位的候选与权项。
   * @param input - 阶段执行输入（粗定位产出与时间基准）。
   * @returns 修正报告、候选与时间基准状态。
   */
  // oxlint-disable-next-line typescript/require-await -- StageHandler contract requires async execute
  async execute(input: StageExecuteInput): Promise<PipelineState> {
    const refined = refineDispute(input.state)
    return {
      dispute_framing_refined: refined.report,
      dispute_framing_refined_candidates: refined.candidates,
      time_basis_status: refined.timeBasis,
    }
  }
}
