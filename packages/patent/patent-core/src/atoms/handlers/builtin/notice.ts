/**
 * 程序文书域原子：oa-parse（审查意见通知书解析）与 grounds（程序法定理由识别）。
 *
 * 两个原子都是 `notice/` 纯函数的声明式包装：读工作流 state 里的文书正文，输出结构化事实，
 * 全程不调用模型，也不判定理由是否成立。原子只负责把确定性内核接进工作流，解析口径归
 * `notice/office-action.ts` 与 `notice/grounds.ts`。
 *
 * 输入约定：正文取工作流材料 `input`（`patent_workflow_run.input` 与 `flexible_plan.inputText`
 * 都映射到该键）；`grounds` 另需显式的 `ground_program` 选定理由表——正文里同时出现无效与
 * 复审措辞时无从推断，故不做猜测，缺失或非法取值一律降级并说明取值域。
 */

import { type Atom } from '../../atom.ts'
import { type PipelineState, type StageExecuteInput, type StageHandler, getStateString } from '../../handler.ts'
import {
  formatOfficeActionSummary,
  parseOfficeAction,
  type ParsedOfficeAction,
} from '../../../notice/office-action.ts'
import {
  detectPatentSubject,
  identifyDesignGrounds,
  identifyInvalidationGrounds,
  identifyReexaminationGrounds,
  type GroundFinding,
  type PatentSubject,
} from '../../../notice/grounds.ts'
import { degraded } from './llm.ts'

/** oa-parse 原子：审查意见通知书结构化解析。 */
export const oaParseAtom: Atom = {
  name: 'oa-parse',
  description: '审查意见通知书解析：驳回类型、引用文献、涉及权项、审查员论点（纯函数，不调用模型）',
  category: 'extract',
  inputSchema: ['input'],
  outputSchema: ['office_action', 'office_action_summary'],
}

/** oa-parse 执行器：解析通知书正文，输出结构化结果与中文摘要。 */
export class OaParseHandler implements StageHandler {
  readonly name = 'oa-parse'
  readonly category = 'extract' as const

  /**
   * 解析通知书正文；正文为空时降级。
   * @param input - 阶段执行输入（state 携带文书正文）。
   * @returns `office_action`（JSON）与 `office_action_summary`（中文摘要）两键。
   */
  // oxlint-disable-next-line typescript/require-await -- StageHandler contract requires async execute
  async execute(input: StageExecuteInput): Promise<PipelineState> {
    const text = getStateString(input.state, 'input')
    if (text.trim().length === 0) {
      return degraded('oa-parse', '通知书正文为空（state.input 未提供）')
    }
    const parsed: ParsedOfficeAction = parseOfficeAction(text)
    return {
      office_action: JSON.stringify(parsed),
      office_action_summary: formatOfficeActionSummary(parsed),
    }
  }
}

/** 理由表取值域：无效宣告 / 复审 / 外观设计无效。 */
export const GROUND_PROGRAMS = ['invalidation', 'reexamination', 'design'] as const

/** 程序类型（决定使用哪张法定理由表）。 */
export type GroundProgram = (typeof GROUND_PROGRAMS)[number]

/** grounds 原子：程序法定理由识别与专利权类型判定。 */
export const groundsAtom: Atom = {
  name: 'grounds',
  description: '程序法定理由识别：按 ground_program 选定无效/复审/外观设计理由表（纯函数，不调用模型）',
  category: 'compare',
  inputSchema: ['input', 'ground_program'],
  outputSchema: ['grounds', 'grounds_summary'],
}

/** 类型守卫：值是否为已知的程序类型。 */
function isGroundProgram(value: string): value is GroundProgram {
  return (GROUND_PROGRAMS as readonly string[]).includes(value)
}

/** 未识别到理由时的摘要，与解析器"不兜底造理由"的口径一致。 */
const NO_GROUND_SUMMARY = '未识别到具体法条依据（须人工判读文书是否援引理由）'

/**
 * 渲染理由摘要：逐条给出中文标签与法条依据。
 * @param findings - 识别到的理由。
 * @returns 逐条摘要文本；未识别到理由时返回明示文案。
 */
function summarizeGrounds(findings: readonly GroundFinding<string>[]): string {
  if (findings.length === 0) return NO_GROUND_SUMMARY
  return findings.map(finding => `${finding.label}（${finding.article}）`).join('、')
}

/** grounds 执行器：按程序类型识别法定理由（复审另判专利权类型）。 */
export class GroundsHandler implements StageHandler {
  readonly name = 'grounds'
  readonly category = 'compare' as const

  /**
   * 按 `ground_program` 识别正文援引的法定理由；程序类型缺失/非法或正文为空时降级。
   * @param input - 阶段执行输入（state 携带正文与 ground_program）。
   * @returns `grounds`（JSON）与 `grounds_summary`（中文摘要）两键；复审另带 `patent_subject`。
   */
  // oxlint-disable-next-line typescript/require-await -- StageHandler contract requires async execute
  async execute(input: StageExecuteInput): Promise<PipelineState> {
    const state = input.state
    const program = getStateString(state, 'ground_program')
    if (!isGroundProgram(program)) {
      const shown = program.trim().length > 0 ? program : '(缺失)'
      return degraded('grounds', `ground_program 非法: ${shown}（须为 ${GROUND_PROGRAMS.join(' / ')}）`)
    }
    const text = getStateString(state, 'input')
    if (text.trim().length === 0) {
      return degraded('grounds', '程序文书正文为空（state.input 未提供）')
    }

    let findings: readonly GroundFinding<string>[]
    let subject: PatentSubject | undefined
    switch (program) {
      case 'invalidation':
        findings = identifyInvalidationGrounds(text)
        break
      case 'reexamination': {
        const reexamination = identifyReexaminationGrounds(text)
        findings = reexamination
        subject = detectPatentSubject(text, reexamination)
        break
      }
      case 'design':
        findings = identifyDesignGrounds(text)
        break
    }
    return {
      grounds: JSON.stringify(findings),
      grounds_summary: summarizeGrounds(findings),
      ...(subject !== undefined ? { patent_subject: subject } : {}),
    }
  }
}
