/**
 * TRIZ 矛盾抽取：一次模型调用从交底书识别技术矛盾与参数缺口。
 *
 * 模型只负责识别；编号合法性、矩阵落格与证据核验由 `buildTrizAnalysis` 判定。
 * 抽取失败返回失败结果而不抛错，让调用方决定降级方式。
 * @module @deepseek-ai/dsh-patent-core/triz/extract
 */

import { ENGINEERING_PARAMS } from '@deepseek-ai/dsh-methodology'
import { tryParseJson } from '../llm-json.ts'
import { collectPortText } from '../model-port.ts'
import { dataBlock } from '../prompt-hygiene.ts'
import type { PatentModelPort } from '../types.ts'
import type { TrizExtractionInput } from './types.ts'

/** 抽取调用选项。 */
export type TrizExtractionOptions = {
  /** 关注的技术问题方向（可选，收窄识别范围）。 */
  readonly focus?: string
  /** 调用方取消信号，透传到 port.stream。 */
  readonly signal?: AbortSignal
}

/** 抽取结果：成功携带待校验的原始结果，失败携带原因。 */
export type TrizExtractionOutcome =
  | { readonly ok: true; readonly extraction: TrizExtractionInput }
  | { readonly ok: false; readonly message: string }

/** 提示级 JSON 形状（端口把它作为 advisory schema 传递，落地约束在组装阶段）。 */
export const TRIZ_EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    contradictions: {
      type: 'array',
      description: '交底书中真实存在的技术矛盾，逐条给出原文证据',
      items: {
        type: 'object',
        properties: {
          improving: { type: 'integer', description: '改善的工程参数编号，1-39' },
          worsening: { type: 'integer', description: '随之恶化的工程参数编号，1-39' },
          statement: { type: 'string', description: '矛盾表述：改善什么、同时牺牲什么' },
          evidence: { type: 'string', description: '交底书原文片段，必须逐字摘抄' },
          solution_directions: {
            type: 'array',
            items: { type: 'string' },
            description: '候选方案方向（1-3 条，指向可替换的手段而非结论）',
          },
        },
        required: ['improving', 'worsening', 'statement', 'evidence'],
      },
    },
    parameter_gaps: {
      type: 'array',
      description: '交底书提到但未给出取值的工程参数',
      items: {
        type: 'object',
        properties: {
          parameter: { type: 'integer', description: '工程参数编号，1-39' },
          missing: {
            type: 'array',
            items: { type: 'string', enum: ['current-value', 'target-value', 'unit', 'test-method', 'other'] },
          },
          detail: { type: 'string', description: '缺口说明' },
        },
        required: ['parameter', 'missing'],
      },
    },
    unmapped: {
      type: 'array',
      description: '像技术问题但无法映射到 1-39 工程参数的表述',
      items: {
        type: 'object',
        properties: {
          statement: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['statement'],
      },
    },
  },
  required: ['contradictions'],
} as const

/** 39 个经典工程参数的紧凑清单（编号 + 名称），供模型选号。 */
const PARAMETER_LIST = ENGINEERING_PARAMS.map(param => `${param.no} ${param.label}`).join('；')

/**
 * 构建抽取提示：只做识别，不做法律判断。
 * @param text - 交底书原文。
 * @param focus - 可选关注方向。
 * @returns 提示文本。
 */
function buildExtractionPrompt(text: string, focus: string | undefined): string {
  return [
    '你是专利技术交底书分析师。请从下面的交底书中识别**技术矛盾**（改善某一工程参数的同时牺牲了另一工程参数），并指出参数完备性缺口。',
    '要求：',
    '- 只识别交底书里真实写到的取舍关系，不得臆断；交底书没说的一律不写。',
    '- evidence 必须是交底书原文的连续片段，逐字摘抄，供程序核验；核验不通过的矛盾会被丢弃。',
    '- improving 与 worsening 只能取下列 39 个经典工程参数的编号；无法映射的表述放进 unmapped，不要硬凑编号。',
    '- parameter_gaps 只列交底书**提到但没给取值**的参数（缺现状值 / 缺目标值 / 缺单位 / 缺测量口径）。',
    '- solution_directions 写候选方案方向（可替换的手段），不写结论，不写法条依据。',
    ...(focus === undefined ? [] : [`关注方向：${focus}`]),
    '',
    '【39 个经典工程参数】',
    PARAMETER_LIST,
    '',
    '【技术交底书】',
    dataBlock(text),
    '',
    '请严格输出 JSON：{ contradictions: [{ improving, worsening, statement, evidence, solution_directions }], parameter_gaps: [{ parameter, missing, detail }], unmapped: [{ statement, reason }] }。',
  ].join('\n')
}

/**
 * 从交底书抽取 TRIZ 矛盾候选。
 * @param port - 专利域模型端口。
 * @param text - 交底书原文。
 * @param options - 关注方向与调用方取消信号。
 * @returns 抽取结果：成功为待校验的原始结果，失败为原因说明。
 */
export async function extractTrizContradictions(
  port: PatentModelPort,
  text: string,
  options: TrizExtractionOptions = {},
): Promise<TrizExtractionOutcome> {
  const prompt = buildExtractionPrompt(text, options.focus)
  let raw: string
  try {
    raw = await collectPortText(port, prompt, options.signal, {
      temperature: 0.2,
      schema: TRIZ_EXTRACTION_SCHEMA,
    })
  } catch (error) {
    /* v8 ignore next -- port failures surface as a message, never as a rethrow. */
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, message: `模型调用失败: ${message}` }
  }
  const parsed = tryParseJson(raw)
  if (parsed === undefined) return { ok: false, message: '模型输出不是可解析的 JSON 对象' }
  return { ok: true, extraction: parsed }
}
