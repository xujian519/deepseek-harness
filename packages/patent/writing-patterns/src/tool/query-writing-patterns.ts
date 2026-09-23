/**
 * The model-facing `query_writing_patterns` tool: select the writing patterns
 * that fit a case and return them compiled into a `<writing_skills>` block.
 * @module @deepseek-ai/dsh-writing-patterns/tool/query-writing-patterns
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { PatternStore } from '../pattern-store.ts'
import { compileWritingSkills } from '../skill-compiler.ts'
import {
  PATTERN_CATEGORIES,
  PATTERN_CATEGORY_LABELS,
  type PatternCategory,
  type WritingPattern,
} from '../types.ts'

/** Tool input. */
export type QueryWritingPatternsInput = {
  category?: PatternCategory
  /** Search keywords; when set, the call searches by keyword instead of matching case features. */
  query?: string
  /** Technical features or keywords of the case. */
  features?: string[]
  /** Maximum number of patterns to return; the deployment's cap when omitted. */
  limit?: number
}

/** One selected pattern as the model sees it. */
export type WritingPatternView = {
  id: string
  name: string
  category: PatternCategory
  summary: string
  quality: number
}

/** How the returned patterns were selected. */
export type QueryWritingPatternsMode = 'search' | 'match' | 'category' | 'catalog'

/** The tool's canonical result: the selected patterns and their compiled block. */
export type QueryWritingPatternsOutput = {
  mode: QueryWritingPatternsMode
  patterns: WritingPatternView[]
  /** Patterns in the loaded corpus, so a narrow hit is distinguishable from a small library. */
  librarySize: number
  /** Compiled block for `patterns`; `''` when nothing matched. */
  skills: string
}

/** Injected collaborators. */
export type QueryWritingPatternsToolOptions = {
  store: PatternStore
  /** Cap applied when the call omits `limit`. */
  matchLimit: number
}

const PATTERN_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    category: { type: 'string', required: true, enum: PATTERN_CATEGORIES },
    summary: { type: 'string', required: true },
    quality: { type: 'number', required: true },
  },
} as const

const CATEGORY_DESCRIPTION = PATTERN_CATEGORIES
  .map(category => `${category} (${PATTERN_CATEGORY_LABELS[category]})`)
  .join(', ')

/** Label per selection mode, used in the rendered result. */
const MODE_LABELS: Readonly<Record<QueryWritingPatternsMode, string>> = {
  search: '按关键词检索',
  match: '按案件特征匹配',
  category: '按类目列举',
  catalog: '列举模式库',
}

const DESCRIPTION = [
  '- Retrieves the patent and legal writing patterns that fit a drafting or office-action situation, compiled into a <writing_skills> block',
  '- A pattern covers one situation with ordered steps and the rules to follow or avoid: claim drafting, specification drafting, disclosure drafting, IPC strategy, embodiment writing, and office-action replies on inventiveness, novelty, and clarity',
  '- Selection: `query` searches by keyword; otherwise `features` match the case features against pattern names, summaries, and step names; otherwise `category` lists that category; with no argument at all the library is listed, capped by `limit`',
  '- Selection is lexical and offline: the tool picks patterns, it does not judge the case. Apply the returned steps to the passage being written',
].join('\n')

/**
 * Build the `query_writing_patterns` tool.
 * @param options - the loaded pattern store and the deployment's result cap.
 * @returns a registry-ready tool definition.
 */
export function createQueryWritingPatternsTool(options: QueryWritingPatternsToolOptions): ToolDefinition {
  return defineTool({
    name: 'query_writing_patterns',
    description: DESCRIPTION,
    parameters: {
      category: {
        type: 'string',
        enum: PATTERN_CATEGORIES,
        description: `Pattern category: ${CATEGORY_DESCRIPTION}`,
      },
      query: {
        type: 'string',
        description: 'Search keywords; when set, the call searches by keyword instead of matching case features',
      },
      features: {
        type: 'array',
        items: { type: 'string' },
        description: 'Technical features or keywords of the case, e.g. ["创造性三步法", "功能性限定"]',
      },
      limit: {
        type: 'integer',
        description: `Maximum number of patterns to return; defaults to ${String(options.matchLimit)}`,
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          mode: { type: 'string', required: true, enum: ['search', 'match', 'category', 'catalog'] },
          patterns: { type: 'array', required: true, items: PATTERN_VIEW_SCHEMA },
          librarySize: { type: 'integer', required: true },
          skills: { type: 'string', required: true },
        },
      },
      render: (args, value) => [{ type: 'text', text: renderQueryWritingPatterns(args, value) }],
    },
    execute(args) {
      const limit = resolveLimit(args.limit, options.matchLimit)
      const mode = selectMode(args)
      const patterns = selectPatterns(options.store, mode, args, limit)
      return Promise.resolve({
        mode,
        patterns: patterns.map(toView),
        librarySize: options.store.size,
        skills: compileWritingSkills(patterns),
      })
    },
  })
}

/**
 * Render a result as the model-facing text: the selected patterns, then the
 * compiled block that carries their steps and rules.
 * @param _args - the tool arguments (the result already states its selection).
 * @param value - the canonical result.
 * @returns the rendered text.
 */
export function renderQueryWritingPatterns(
  _args: QueryWritingPatternsInput,
  value: QueryWritingPatternsOutput,
): string {
  const label = MODE_LABELS[value.mode]
  if (value.patterns.length === 0) {
    return `写作模式库：没有匹配的模式（库中共 ${String(value.librarySize)} 个）。`
      + '改用其他关键词或类目，或省略全部参数以列举库中的模式。'
  }
  const lines = [
    `写作模式库：命中 ${String(value.patterns.length)} / ${String(value.librarySize)} 个模式（${label}）。`,
    '',
    '匹配到的模式：',
    ...value.patterns.map(pattern =>
      `- \`${pattern.id}\` · ${PATTERN_CATEGORY_LABELS[pattern.category]} · **${pattern.name}** —— ${pattern.summary}`),
    '',
    '编译后的写作技能：',
    value.skills,
  ]
  return lines.join('\n')
}

/** Resolve the result cap: the call's own, else the deployment's. */
function resolveLimit(limit: number | undefined, matchLimit: number): number {
  if (limit === undefined) return matchLimit
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`query_writing_patterns: limit must be a positive integer, got ${String(limit)}`)
  }
  return limit
}

/** Which selection the arguments ask for. */
function selectMode(args: QueryWritingPatternsInput): QueryWritingPatternsMode {
  if (args.query !== undefined && args.query.trim() !== '') return 'search'
  if ((args.features ?? []).some(feature => feature.trim() !== '')) return 'match'
  if (args.category !== undefined) return 'category'
  return 'catalog'
}

/** Run the selection the mode names. */
function selectPatterns(
  store: PatternStore,
  mode: QueryWritingPatternsMode,
  args: QueryWritingPatternsInput,
  limit: number,
): readonly WritingPattern[] {
  switch (mode) {
    case 'search':
      return store.search(args.query ?? '', {
        ...(args.category !== undefined ? { category: args.category } : {}),
        limit,
      })
    case 'match':
      return store.match({
        ...(args.category !== undefined ? { caseType: args.category } : {}),
        features: (args.features ?? []).filter(feature => feature.trim() !== ''),
        limit,
      })
    case 'category':
      return store.byCategory(args.category ?? '').slice(0, limit)
    case 'catalog':
      return store.all().slice(0, limit)
    default:
      return unreachableMode(mode)
  }
}

/** 穷尽性收尾：封闭联合的默认分支不可达（未来新增 mode 时此处编译失败）。 */
function unreachableMode(mode: never): never {
  throw new Error(`未知 query_writing_patterns 选择模式：${String(mode)}`)
}

/** One pattern as the model sees it. */
function toView(pattern: WritingPattern): WritingPatternView {
  return {
    id: pattern.id,
    name: pattern.name,
    category: pattern.category,
    summary: pattern.summary,
    quality: pattern.quality,
  }
}
