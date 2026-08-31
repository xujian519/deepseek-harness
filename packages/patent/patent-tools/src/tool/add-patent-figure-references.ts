/**
 * `add_patent_figure_references` tool: 为既有 SVG 附图追加参考标号。
 *
 * 处理用户自己渲染/已有的流程图或框图（Graphviz 或同结构 SVG），按
 * label 文本匹配在 `<tspan>`/`<text>` 末尾追加 ` (numeral)`。用于
 * generate_patent_figure 之外的自有图或旧图补标号；标号体系与主工具
 * 一致（每图 100 系列，跨图同件同号）。移植自 Claude-Patent-Creator
 * 的 add_reference_numbers（MIT）。
 * @module @deepseek-ai/dsh-patent-tools/tool/add-patent-figure-references
 */

import { readFile, writeFile } from 'node:fs/promises'
import { basename, relative, resolve } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { PatentToolError } from '../error.ts'
import { SvgAnnotateError, annotateSvg } from '../figure/svg-annotate.ts'
import { annotateSvgWithLeaderLines } from '../figure/leader-line.ts'
import type { SvgAnnotateReference } from '../figure/svg-annotate.ts'

/** 依赖注入。cwd 为路径基准，默认 process.cwd()。 */
export type AddPatentFigureReferencesDeps = {
  cwd?: string
}

/** 输入：SVG 路径 + 参考标号表。 */
export type AddPatentFigureReferencesInput = {
  /** SVG 图片路径（工作区相对或绝对路径）。 */
  svg_path: string
  /** 参考标号（label 匹配图内文本；未命中项进 warnings）。 */
  references: SvgAnnotateReference[]
  /** 输出文件名（不含扩展名，默认 <原名>_annotated）。 */
  output_filename?: string
  /** true 时改用引线模式：标号置于组件外侧并以引线相连；默认 false 内嵌「 (标号)」。 */
  leader_lines?: boolean
}

/** 输出：标注后路径 + 未命中警告。 */
export type AddPatentFigureReferencesOutput = {
  /** 标注后的 SVG 路径（工作区相对）。 */
  path: string
  /** 参考数。 */
  numReferences: number
  /** 未命中任何文本元素的参考 label（原文顺序）。 */
  warnings: string[]
}

const DESCRIPTION = [
  '为已有 SVG 附图追加专利参考标号：按组件文本匹配标注，输出 *_annotated.svg（不改动原图）。默认在匹配文本末尾内嵌「 (标号)」；leader_lines=true 时改用引线模式，标号置于组件外侧并以引线相连（仅 Graphviz/同构节点组 SVG 支持）。用户提供了自绘流程图/框图或已渲染 SVG，需要补标记、与说明书标号对齐时使用。',
  '',
  '匹配规则：子串匹配（大小写不敏感）；每个文本元素至多命中一个参考；同名组件出现在多个位置时全部同号标注；未命中的参考列为警告返回。',
].join('\n')

/**
 * Build the `add_patent_figure_references` tool.
 * @param deps - optional cwd.
 * @returns a registry-ready tool definition.
 */
export function createAddPatentFigureReferencesTool(deps: AddPatentFigureReferencesDeps = {}): ToolDefinition {
  return defineTool({
    name: 'add_patent_figure_references',
    description: DESCRIPTION,
    parameters: {
      svg_path: { type: 'string', required: true, description: 'SVG 图片路径（工作区相对或绝对路径）' },
      references: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            label: { type: 'string', required: true, description: '图内组件文本（子串匹配）' },
            numeral: { type: 'string', required: true, description: '参考标号（如 20、101）' },
          },
        },
        description: '参考标号表',
      },
      output_filename: { type: 'string', description: '输出文件名（不含扩展名，默认 <原名>_annotated）' },
      leader_lines: { type: 'boolean', description: 'true 时改用引线模式（标号置于组件外侧并以引线相连）；默认 false 内嵌「 (标号)」' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          numReferences: { type: 'integer', required: true },
          warnings: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: [`已生成标注 SVG：${value.path}`, `参考标号：${value.numReferences}`, ...(value.warnings.length > 0 ? ['', '## 未命中', ...value.warnings.map(w => `- ${w}`)] : [])].join('\n'),
        },
      ],
    },
    async execute(args) {
      const cwd = deps.cwd ?? process.cwd()
      const absPath = resolve(cwd, args.svg_path)
      let svg: string
      try {
        svg = await readFile(absPath, 'utf8')
      } catch {
        throw new PatentToolError('file_not_found', `SVG 文件不存在：${args.svg_path}`, { tool: 'add_patent_figure_references' })
      }
      let result
      try {
        result = args.leader_lines === true
          ? annotateSvgWithLeaderLines(svg, args.references)
          : annotateSvg(svg, args.references)
      } catch (error) {
        /* v8 ignore start -- annotateSvg only throws SvgAnnotateError; the rethrow keeps unknown failures loud */
        if (error instanceof SvgAnnotateError) {
          throw new PatentToolError('invalid_tool_input', `SVG 标注被拒：${error.message}`, { tool: 'add_patent_figure_references' })
        }
        throw error
        /* v8 ignore stop */
      }
      const dir = resolve(absPath, '..')
      const base = args.output_filename ?? `${baseName(absPath)}_annotated`
      const outPath = resolve(dir, `${base}.svg`)
      await writeFile(outPath, result.svg, 'utf8')
      return { path: relative(cwd, outPath), numReferences: args.references.length, warnings: result.warnings }
    },
  })
}

/** 提取文件名（不含扩展名）。 */
function baseName(path: string): string {
  const name = basename(path)
  return name.endsWith('.svg') ? name.slice(0, -4) : name
}
