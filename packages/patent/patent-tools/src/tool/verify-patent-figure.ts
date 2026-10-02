/**
 * `verify_patent_figure` tool: 在既有 SVG 上量测图面事实，报告只在渲染结果上才看得见
 * 的问题。
 *
 * 与输入侧检查（`generate_patent_figure` 的 warnings）互补：输入检查看的是「调用方
 * 声明了什么」，本工具看的是「画出来是什么样」——图面文字（标号、元件名、连线说明）
 * 是否被线条贯穿、文字与图线净距是否够、点划线是否被实线覆盖、相邻零件剖面线是否
 * 可区分、内容是否越出画布。量测在矢量源上进行（见 `figure/render-check`），不依赖
 * 系统栅格化器。
 *
 * 用途：对已交付或由外部工具生成的 SVG 附图做交付前自检，等价于人工「看一眼图」，
 * 但给出可复核的量测值。
 * @module @deepseek-ai/dsh-patent-tools/tool/verify-patent-figure
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { PatentToolError } from '../error.ts'
import { checkFigureRendering } from '../figure/render-check.ts'
import type { RenderCheckReport } from '../figure/render-check.ts'
import { SvgAnnotateError } from '../figure/svg-annotate.ts'
import { SVG_PATH_PARAM, SVG_PATH_RESULT_FIELDS, readSvgInput } from './internal/svg-input.ts'

/** 依赖注入。cwd 为路径基准，默认 process.cwd()。 */
export type VerifyPatentFigureDeps = {
  cwd?: string
}

/** 输入：待复核的 SVG 路径与标号净距。 */
export type VerifyPatentFigureInput = {
  /** SVG 图片路径（工作区相对或绝对路径）。 */
  svg_path: string
  /** 标号净距（毫米）；缺省 1.5，`0` 关闭该判据。 */
  text_clearance_mm?: number
}

/** 输出：量测值 + 发现问题（与 `figure/render-check` 的报告同形）。 */
export type VerifyPatentFigureOutput = {
  /** 复核的图片路径（工作区相对）。 */
  path: string
  /** 绝对路径（被复核文件可能不在工作区内）。 */
  absolutePath: string
  /** 画布宽（毫米）；根元素未声明时为缺省。 */
  widthMm?: number
  /** 画布高（毫米）；根元素未声明时为缺省。 */
  heightMm?: number
  /** 文字元素数。 */
  textCount: number
  /** 线宽分布（毫米 → 元素数）。 */
  strokeWidthMm: { widthMm: number; count: number }[]
  /** 线段取向分布（0–180°，按线段数降序）。 */
  orientationDeg: { orientationDeg: number; count: number }[]
  /** 发现的问题（无问题为空数组）。 */
  findings: { check: string; message: string }[]
}

const DESCRIPTION = [
  '复核已生成的 SVG 说明书附图：量测线宽、线段取向、文字元素，并报告只在渲染结果上才看得见的问题——图面文字（标号、元件名、连线说明）被线条贯穿、文字与图线净距不足、中心线（点划线）被同位置的实线覆盖、相邻零件剖面线难以区分（方向与间距都分不清）、内容越出画布。',
  '',
  '量测在矢量源上进行（线段位置、线宽与字号即渲染输入），不需要栅格化器：根元素的画布尺寸、viewBox 与 preserveAspectRatio 先解析成用户单位到毫米的映射，元素按嵌套逐层继承变换（translate/scale/rotate/matrix）与线宽、描边、字号（含自 `<g>` 继承的 text-anchor 与行内 style），故落版页、拼版页与 px 级用户单位的导出文件同一口径量测。不在量测范围内的结构（CSS 类样式、`<use>`/`<image>`、嵌套 `<svg>` 内层视口、marker 端头、`<tspan>` 位移、dominant-baseline、百分比长度、无法解析的变换/路径/viewBox、按端点弦近似的曲线段）各出一条「未量测」发现：没有它时才等于逐类量测过。',
  '',
  '净距判据（text_clearance_mm，默认 1.5 毫米）来自实测：剖切面上密布剖面线时，标号或零件名贴住剖面线带、轴线便读不出。判据把文字外框外扩该净距后与图元线段求交——绘图侧标注为引线（data-dsh-role="leader"）的线段、以及落在更晚绘制的不透明白填充之下的线段不参与（前者本来就止于文字外框，后者图面上看不见）。电路图、曲线图这类「文字贴着符号放」的图型按本判据会大量播报，复核它们时传 text_clearance_mm: 0 关闭。',
  '',
  '与 generate_patent_figure 的返回值配合使用：生成后按本工具复核，把 findings 当作必须处理的图面缺陷。',
].join('\n')

/**
 * Build the `verify_patent_figure` tool.
 * @param deps - optional cwd.
 * @returns a registry-ready tool definition.
 */
export function createVerifyPatentFigureTool(deps: VerifyPatentFigureDeps = {}): ToolDefinition {
  return defineTool({
    name: 'verify_patent_figure',
    description: DESCRIPTION,
    parameters: {
      svg_path: SVG_PATH_PARAM,
      text_clearance_mm: {
        type: 'number',
        description: '标号净距（毫米），默认 1.5，0 表示不判该判据；文字外框外扩这么多后与图元线段相交即报',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ...SVG_PATH_RESULT_FIELDS,
          widthMm: { type: 'number' },
          heightMm: { type: 'number' },
          textCount: { type: 'integer', required: true },
          strokeWidthMm: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: { widthMm: { type: 'number', required: true }, count: { type: 'integer', required: true } },
            },
          },
          orientationDeg: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: { orientationDeg: { type: 'number', required: true }, count: { type: 'integer', required: true } },
            },
          },
          findings: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: { check: { type: 'string', required: true }, message: { type: 'string', required: true } },
            },
          },
        },
      },
      render: (_args, value) => {
        const canvas = value.widthMm === undefined || value.heightMm === undefined
          ? '根元素未声明画布尺寸'
          : `${String(value.widthMm)}×${String(value.heightMm)} 毫米`
        const lines = [
          `附图渲染复核：${value.path}`,
          `绝对路径：${value.absolutePath}`,
          '',
          '## 量测',
          `- 画布 ${canvas}`,
          `- 文字元素 ${String(value.textCount)} 个`,
          `- 线宽分布：${value.strokeWidthMm.map(entry => `${String(entry.widthMm)}mm×${String(entry.count)}`).join('、') || '无'}`,
          `- 线段取向（按线段数）：${value.orientationDeg.slice(0, 8).map(entry => `${String(entry.orientationDeg)}°×${String(entry.count)}`).join('、') || '无'}`,
          '',
          ...(value.findings.length === 0
            ? ['## 发现的问题', '- 未发现问题']
            : ['## 发现的问题', ...value.findings.map(finding => `- [${finding.check}] ${finding.message}`)]),
        ]
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) {
      const cwd = deps.cwd ?? process.cwd()
      const clearanceMm = args.text_clearance_mm
      if (clearanceMm !== undefined && clearanceMm < 0) {
        throw new PatentToolError(
          'invalid_tool_input',
          `text_clearance_mm 必须是非负数（毫米），0 表示不判该判据：${String(clearanceMm)}`,
          { tool: 'verify_patent_figure' },
        )
      }
      const { absolutePath: absPath, path, svg } = await readSvgInput(args.svg_path, cwd, 'verify_patent_figure')
      let report: RenderCheckReport
      try {
        report = checkFigureRendering(svg, clearanceMm === undefined ? {} : { textClearanceMm: clearanceMm })
      } catch (error) {
        if (error instanceof SvgAnnotateError) {
          throw new PatentToolError('invalid_tool_input', `SVG 复核被拒：${error.message}`, { tool: 'verify_patent_figure' })
        }
        /* v8 ignore next -- checkFigureRendering 只抛 SvgAnnotateError；其余异常原样上抛 */
        throw error
      }
      return {
        path,
        absolutePath: absPath,
        ...(report.widthMm === undefined ? {} : { widthMm: report.widthMm }),
        ...(report.heightMm === undefined ? {} : { heightMm: report.heightMm }),
        textCount: report.textCount,
        strokeWidthMm: report.strokeWidthMm.map(entry => ({ ...entry })),
        orientationDeg: report.orientationDeg.map(entry => ({ ...entry })),
        findings: report.findings.map(finding => ({ check: finding.check, message: finding.message })),
      }
    },
  })
}
