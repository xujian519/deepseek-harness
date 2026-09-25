/**
 * `generate_patent_figure` 的落版：把渲染产物按目标法域的幅面、页边距与图号/页码写法
 * 落成固定幅面附图页，并汇总落版指标与合规核算警告。
 * @module @deepseek-ai/dsh-patent-tools/tool/figure-submission
 */

import { readFile, writeFile } from 'node:fs/promises'
import { PatentToolError } from '../error.ts'
import { drawingComplianceWarnings } from '../figure/compliance.ts'
import type { DotFormat } from '../figure/dot-builder.ts'
import { figureCaption, officeProfile, sheetNumberText } from '../figure/office-profile.ts'
import type { OfficeProfile, TargetOffice } from '../figure/office-profile.ts'
import { buildSubmissionPage } from '../figure/submission-page.ts'
import type { SubmissionPageMetrics } from '../figure/submission-page.ts'
import type { GeneratePatentFigureLayout } from './figure-input.ts'

/** DOT 正文字号（与 buildDotHeader 的 node fontsize 一致），用于落版后的字高核算。 */
const FIGURE_BODY_FONT_SIZE = 10

/** 落版参数（target_office 给定时解析）。 */
type SubmissionPlan = {
  profile: OfficeProfile
  caption?: string | undefined
  sheetNumber: string
  bodyFontSize: number
  fitToPage: boolean
}

/** 落版执行结果（指标 + 实际写上图面的图号与页码）。 */
type AppliedSubmission = {
  metrics: SubmissionPageMetrics
  caption?: string | undefined
  sheetNumber: string
}

/** 解析落版参数所需的输入字段（结构化输入在 exactOptionalPropertyTypes 下不能直接当作完整工具输入传入）。 */
export type SubmissionPlanInput = {
  target_office?: TargetOffice | undefined
  figure_number?: number | undefined
  figure_count?: number | undefined
  sheet_index?: number | undefined
  sheet_total?: number | undefined
  caption?: string | undefined
  fit_to_page?: boolean | undefined
}

/**
 * 解析落版参数：图号按目标法域生成（panels 模式追加面板后缀），页码按法域写法生成。
 * @param input - 工具输入（或归一化后的结构化输入）。
 * @param suffix - 面板后缀（单图为空串）。
 * @returns 落版参数；未指定 target_office 时 undefined。
 * @throws PatentToolError('invalid_tool_input') 图号、附图总数或页序超出法域写法允许范围时。
 */
export function resolveSubmission(input: SubmissionPlanInput, suffix: string): SubmissionPlan | undefined {
  const office = input.target_office
  if (office === undefined) return undefined
  const profile = officeProfile(office)
  let caption: string | undefined
  let sheetNumber: string
  try {
    const base = input.caption ?? figureCaption(profile, input.figure_number ?? 1, input.figure_count ?? 1)
    caption = base === undefined || base === '' ? undefined : `${base}${suffix}`
    sheetNumber = sheetNumberText(profile, input.sheet_index ?? 1, input.sheet_total ?? 1)
  } catch (error) {
    throw new PatentToolError('invalid_tool_input', `落版参数非法：${error instanceof Error ? error.message : String(error)}`, { tool: 'generate_patent_figure' })
  }
  return { profile, caption, sheetNumber, bodyFontSize: FIGURE_BODY_FONT_SIZE, fitToPage: input.fit_to_page ?? true }
}

/**
 * 把渲染产物落版到目标法域的固定幅面附图页并写回原文件。
 * @param outcomePath - 渲染产物路径（原地改写）。
 * @param plan - 落版参数。
 * @param format - 输出格式（仅 svg 支持落版）。
 * @param warnings - 收集提示的警告数组。
 * @returns 落版指标与实际图号/页码；格式不支持落版时 undefined。
 */
export async function applySubmissionPage(
  outcomePath: string,
  plan: SubmissionPlan,
  format: DotFormat,
  warnings: string[],
): Promise<AppliedSubmission | undefined> {
  if (format !== 'svg') {
    warnings.push(`落版仅支持 SVG 输出；本次 ${format} 未落版到 ${plan.profile.office} 幅面，请改用 format="svg" 或自行拼版`)
    return undefined
  }
  const rendered = await readFile(outcomePath, 'utf8')
  const page = buildSubmissionPage({
    drawingSvg: rendered,
    profile: plan.profile,
    caption: plan.caption,
    sheetNumber: plan.sheetNumber,
    bodyFontSize: plan.bodyFontSize,
  })
  warnings.push(...page.warnings.map(w => `落版：${w}`))
  if (plan.fitToPage) await writeFile(outcomePath, page.svg, 'utf8')
  return { metrics: page.metrics, caption: plan.caption, sheetNumber: plan.sheetNumber }
}

/**
 * 组装落版输出并追加合规核算警告（单图与 panels 共用）。
 * @param plan - 落版参数。
 * @param applied - 落版执行结果。
 * @param style - 本次色彩策略。
 * @param figureCount - 本案附图总数。
 * @param warnings - 收集提示的警告数组。
 * @returns 工具输出的 layout 字段。
 */
export function buildLayout(
  plan: SubmissionPlan,
  applied: AppliedSubmission,
  style: 'grayscale' | 'semantic',
  figureCount: number,
  warnings: string[],
): GeneratePatentFigureLayout {
  const { metrics } = applied
  warnings.push(...drawingComplianceWarnings({
    profile: plan.profile,
    style,
    figureCount,
    hasCaption: applied.caption !== undefined,
    metrics,
  }))
  return {
    office: plan.profile.office,
    pageScale: metrics.pageScale,
    placedWidthMm: metrics.placedWidthMm,
    placedHeightMm: metrics.placedHeightMm,
    ...(metrics.charHeightMm === undefined ? {} : { charHeightMm: metrics.charHeightMm }),
    ...(metrics.reducedCharHeightMm === undefined ? {} : { reducedCharHeightMm: metrics.reducedCharHeightMm }),
    ...(applied.caption === undefined ? {} : { caption: applied.caption }),
    sheetNumber: applied.sheetNumber,
  }
}
