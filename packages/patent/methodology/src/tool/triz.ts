/**
 * The model-facing triz tool: list the 40 inventive principles and the 39
 * engineering parameters, or look up one contradiction-matrix cell given an
 * improving/worsening parameter pair.
 * @module @deepseek-ai/dsh-methodology/tool/triz
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { ENGINEERING_PARAMS, loadPrinciples, lookupMatrixCell, paramLabel } from '../data.ts'
import type { TrizPrinciple } from '../types.ts'

/** Tool input: an optional improving/worsening parameter pair (both or neither). */
export type TrizInput = {
  /** Improving engineering parameter number, 1-39. */
  improving?: number
  /** Worsening engineering parameter number, 1-39. */
  worsening?: number
}

/** One engineering parameter as returned to the model. */
export type TrizParameterView = {
  number: number
  label: string
}

/** One inventive principle as returned to the model. */
export type TrizPrincipleView = {
  number: number
  name: string
  description: string
}

/** The tool's canonical result: the full catalog, or one matrix-cell lookup. */
export type TrizOutput =
  | { mode: 'catalog'; parameters: TrizParameterView[]; principles: TrizPrincipleView[] }
  | { mode: 'lookup'; improving: TrizParameterView; worsening: TrizParameterView; recommended: TrizPrincipleView[] }

const PARAMETER_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    number: { type: 'integer', required: true },
    label: { type: 'string', required: true },
  },
} as const

const PRINCIPLE_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    number: { type: 'integer', required: true },
    name: { type: 'string', required: true },
    description: { type: 'string', required: true },
  },
} as const

const DESCRIPTION = [
  '- TRIZ inventive problem solving: the 40 inventive principles and the 39x39 Altshuller contradiction matrix',
  '- Call with no arguments to list all 39 engineering parameters and 40 principles',
  '- Call with an improving and a worsening parameter number (1-39) to read that matrix cell and its recommended principles',
  '- Use for technical contradictions, trade-offs, and patent design-around',
].join('\n')

function parameterView(no: number): TrizParameterView {
  return { number: no, label: paramLabel(no) }
}

function principleView(principle: TrizPrinciple): TrizPrincipleView {
  return { number: principle.no, name: principle.name, description: principle.description }
}

function allParameters(): TrizParameterView[] {
  return ENGINEERING_PARAMS.map(param => parameterView(param.no))
}

function allPrinciples(): TrizPrincipleView[] {
  return loadPrinciples().map(principleView)
}

/** Render the full catalog as Markdown. */
function renderCatalog(value: { parameters: TrizParameterView[]; principles: TrizPrincipleView[] }): string {
  const lines = [
    'TRIZ: 39 engineering parameters and 40 inventive principles.',
    '',
    '## Engineering parameters',
    ...value.parameters.map(param => '- ' + param.number + '. ' + param.label),
    '',
    '## Inventive principles',
    ...value.principles.map(principle => '- ' + principle.number + '. ' + principle.name + ' — ' + principle.description),
  ]
  return lines.join('\n')
}

/** Render one matrix-cell lookup as Markdown. */
function renderLookup(value: { improving: TrizParameterView; worsening: TrizParameterView; recommended: TrizPrincipleView[] }): string {
  const header = 'Contradiction matrix: improving ' + value.improving.label + ' (' + value.improving.number + ') → worsening ' + value.worsening.label + ' (' + value.worsening.number + ')'
  if (value.recommended.length === 0) {
    return header + '\n\nRecommended principles: none. A diagonal cell names a physical contradiction (improving equals worsening), which classical TRIZ resolves by separation rather than a matrix entry.'
  }
  const lines = [
    header,
    '',
    'Recommended principles: ' + value.recommended.map(principle => principle.number).join(', '),
    '',
    ...value.recommended.map(principle => '- ' + principle.number + '. ' + principle.name + ' — ' + principle.description),
  ]
  return lines.join('\n')
}

/** Render the canonical value into model-facing Markdown. */
function renderTriz(value: TrizOutput): string {
  return value.mode === 'catalog' ? renderCatalog(value) : renderLookup(value)
}

/**
 * Build the triz tool over the shipped TRIZ data assets.
 * @returns a registry-ready tool definition.
 */
export function createTrizTool(): ToolDefinition {
  return defineTool({
    name: 'triz',
    description: DESCRIPTION,
    parameters: {
      improving: {
        type: 'integer',
        description: 'Improving engineering parameter number (1-39). Omit it together with worsening to list the full catalog.',
      },
      worsening: {
        type: 'integer',
        description: 'Worsening engineering parameter number (1-39). Provide it only together with improving.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          mode: { type: 'string', required: true, enum: ['catalog', 'lookup'] },
          parameters: { type: 'array', items: PARAMETER_VIEW_SCHEMA },
          principles: { type: 'array', items: PRINCIPLE_VIEW_SCHEMA },
          improving: PARAMETER_VIEW_SCHEMA,
          worsening: PARAMETER_VIEW_SCHEMA,
          recommended: { type: 'array', items: PRINCIPLE_VIEW_SCHEMA },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderTriz(value as unknown as TrizOutput) }],
    },
    async execute(args) {
      const hasImproving = args.improving !== undefined
      const hasWorsening = args.worsening !== undefined
      if (hasImproving !== hasWorsening) {
        throw new Error('triz requires both improving and worsening, or neither (for the full catalog)')
      }
      if (!hasImproving) {
        return { mode: 'catalog', parameters: allParameters(), principles: allPrinciples() } as const
      }
      const improving = args.improving as number
      const worsening = args.worsening as number
      if (!Number.isInteger(improving) || improving < 1 || improving > 39) {
        throw new Error('triz improving must be an integer 1-39')
      }
      if (!Number.isInteger(worsening) || worsening < 1 || worsening > 39) {
        throw new Error('triz worsening must be an integer 1-39')
      }
      const ids = lookupMatrixCell(improving, worsening)
      const byNo = new Map(loadPrinciples().map(principle => [principle.no, principle]))
      return {
        mode: 'lookup',
        improving: parameterView(improving),
        worsening: parameterView(worsening),
        recommended: ids.flatMap((id) => {
          const principle = byNo.get(id)
          return principle === undefined ? [] : [principleView(principle)]
        }),
      } as const
    },
  })
}
