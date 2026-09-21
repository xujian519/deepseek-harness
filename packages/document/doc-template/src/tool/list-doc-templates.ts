/**
 * `list_doc_templates` tool: the renderable templates and their variable schema.
 *
 * The listing is how the model learns which variables a template expects before
 * calling `render_doc_template`; the variable schema is returned with every
 * template rather than behind a second call, because a render call without the
 * required variables fails.
 * @module @deepseek-ai/dsh-doc-template/tool/list-doc-templates
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { TemplateFilter, TemplateStore } from '../store.ts'
import { TEMPLATE_CATEGORY_ORDER, VAR_TYPES, OUTPUT_FORMATS, type DocTemplate, type OutputFormat, type VarType } from '../types.ts'

/** Filters the model may pass to the listing. */
export interface ListDocTemplatesInput {
  /** Exact category, e.g. `claims`; empty means every category. */
  readonly category?: string
  /** Exact domain, e.g. `patent`; empty means every domain. */
  readonly domain?: string
  /** Exact language, e.g. `zh-CN`; empty means every language. */
  readonly language?: string
  /** Case-insensitive substring matched against name, title, description, and use-when. */
  readonly query?: string
}

/** One variable of a template, as the model sees it. */
export interface DocTemplateVariable {
  /** Variable name, without its `{{}}` wrapping. */
  readonly name: string
  /** Declared type. */
  readonly type: VarType
  /** Whether the render call must supply the variable. */
  readonly required: boolean
  /** Value used when the variable is absent; absent means no default. */
  readonly default?: string
  /** What the variable means. */
  readonly description: string
}

/** One template, as the model sees it. */
export interface DocTemplateSummary {
  /** Template name to pass to `render_doc_template`. */
  readonly name: string
  /** Document title. */
  readonly title: string
  /** Document category. */
  readonly category: string
  /** One-line description. */
  readonly description: string
  /** Domain the template belongs to. */
  readonly domain: string
  /** Template version. */
  readonly version: string
  /** Language the document is written in. */
  readonly language: string
  /** Writing style the template is composed with; empty when it declares none. */
  readonly style: string
  /** When the template should be used. */
  readonly useWhen: string
  /** Formats the template may be rendered to. */
  readonly formats: OutputFormat[]
  /** The template's variables, in declaration order. */
  readonly variables: DocTemplateVariable[]
}

/** The listing result. */
export interface ListDocTemplatesOutput {
  /** The matching templates, in category then name order. */
  readonly templates: DocTemplateSummary[]
  /** How many templates matched. */
  readonly count: number
}

/** A mutable filter under construction. */
type MutableFilter = { -readonly [K in keyof TemplateFilter]: TemplateFilter[K] }

/** Category ranks, as a list a lookup can search by an arbitrary category. */
const CATEGORY_RANK: readonly string[] = TEMPLATE_CATEGORY_ORDER

/**
 * Turn model input into a store filter; an absent or empty field filters nothing.
 * @param input - the model's filters.
 * @returns the store filter.
 */
export function toTemplateFilter(input: ListDocTemplatesInput): TemplateFilter {
  const filter: MutableFilter = {}
  if (input.category !== undefined && input.category !== '') filter.category = input.category
  if (input.domain !== undefined && input.domain !== '') filter.domain = input.domain
  if (input.language !== undefined && input.language !== '') filter.language = input.language
  if (input.query !== undefined && input.query !== '') filter.query = input.query
  return filter
}

/**
 * Rank a category by the listing order; an unlisted category sorts last.
 * @param category - the category to rank.
 * @returns its rank.
 */
function categoryRank(category: string): number {
  const rank = CATEGORY_RANK.indexOf(category)
  return rank < 0 ? CATEGORY_RANK.length : rank
}

/**
 * Order two templates for listing: by category, then by name. A store holds one
 * template per name, so the name comparison never ties.
 * @param left - one template.
 * @param right - the other template.
 * @returns a negative or positive number, as `Array.prototype.sort` expects.
 */
function compareTemplates(left: DocTemplate, right: DocTemplate): number {
  const byCategory = categoryRank(left.category) - categoryRank(right.category)
  return byCategory !== 0 ? byCategory : left.name < right.name ? -1 : 1
}

/**
 * Project one template for the model.
 * @param store - the store, for the template's effective language.
 * @param template - the template to project.
 * @returns the summary.
 */
function summarize(store: TemplateStore, template: DocTemplate): DocTemplateSummary {
  return {
    name: template.name,
    title: template.title,
    category: template.category,
    description: template.description,
    domain: template.domain,
    version: template.version,
    language: store.languageOf(template),
    style: template.styleName,
    useWhen: template.useWhen,
    formats: [...template.supportedFormats],
    variables: template.varSchema.definitions.map(definition => ({
      name: definition.name,
      type: definition.type,
      required: definition.required,
      ...(definition.default === undefined ? {} : { default: definition.default }),
      description: definition.description,
    })),
  }
}

/**
 * List the templates matching a filter, with their variable schemas.
 * @param store - the loaded templates.
 * @param input - the model's filters.
 * @returns the summaries in category then name order, and their count.
 */
export function listDocTemplates(store: TemplateStore, input: ListDocTemplatesInput): ListDocTemplatesOutput {
  const templates = [...store.list(toTemplateFilter(input))].sort(compareTemplates)
  const summaries = templates.map(template => summarize(store, template))
  return { templates: summaries, count: summaries.length }
}

/**
 * Render the listing for the model.
 * @param value - the listing result.
 * @returns the model-facing text.
 */
export function renderTemplateList(value: ListDocTemplatesOutput): string {
  if (value.count === 0) return 'No document template matches the filters.'
  const lines: string[] = [`${String(value.count)} document templates`, '']
  for (const template of value.templates) {
    const style = template.style === '' ? 'none' : template.style
    lines.push(`- [${template.category}] ${template.name} — ${template.title}`)
    lines.push(`  description: ${template.description}`)
    lines.push(`  formats: ${template.formats.join(', ')} · language: ${template.language} · style: ${style}`)
    lines.push(`  variables: ${describeVariables(template.variables)}`)
    if (template.useWhen !== '') lines.push(`  use when: ${template.useWhen}`)
    lines.push('')
  }
  return lines.join('\n')
}

/**
 * Render one template's variables for the model.
 * @param variables - the variables.
 * @returns one line naming every variable with its type, requiredness, and default.
 */
function describeVariables(variables: readonly DocTemplateVariable[]): string {
  if (variables.length === 0) return 'none'
  return variables
    .map((variable) => {
      const required = variable.required ? ', required' : ''
      const declaredDefault = variable.default === undefined ? '' : `, default ${JSON.stringify(variable.default)}`
      return `${variable.name}: ${variable.type}${required}${declaredDefault}`
    })
    .join('; ')
}

const DESCRIPTION = [
  '- Lists the document templates this deployment can render, with each template\'s variables, so a `render_doc_template` call can supply them.',
  '- Filters are optional and combine: category, domain, language, and a case-insensitive query over the name, title, description, and use-when text.',
  '- Every template also reports the formats it supports. A template that does not list `docx` cannot be rendered to DOCX.',
  '',
  'Usage notes:',
  '  - Read-only and offline; reads the packaged template assets and any configured override directories.',
  '  - Call this before `render_doc_template`: required variables and their types are only reported here.',
].join('\n')

const VARIABLE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', required: true },
    type: { type: 'string', required: true, enum: VAR_TYPES },
    required: { type: 'boolean', required: true },
    default: { type: 'string' },
    description: { type: 'string', required: true },
  },
} as const

const TEMPLATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', required: true },
    title: { type: 'string', required: true },
    category: { type: 'string', required: true },
    description: { type: 'string', required: true },
    domain: { type: 'string', required: true },
    version: { type: 'string', required: true },
    language: { type: 'string', required: true },
    style: { type: 'string', required: true },
    useWhen: { type: 'string', required: true },
    formats: { type: 'array', required: true, items: { type: 'string', enum: OUTPUT_FORMATS } },
    variables: { type: 'array', required: true, items: VARIABLE_SCHEMA },
  },
} as const

/**
 * Build the `list_doc_templates` tool.
 * @param store - the loaded templates.
 * @returns the tool definition.
 */
export function createListDocTemplatesTool(store: TemplateStore): ToolDefinition {
  return defineTool({
    name: 'list_doc_templates',
    description: DESCRIPTION,
    parameters: {
      category: { type: 'string', description: 'Exact category filter, e.g. claims' },
      domain: { type: 'string', description: 'Exact domain filter, e.g. patent' },
      language: { type: 'string', description: 'Exact language filter, e.g. zh-CN' },
      query: { type: 'string', description: 'Case-insensitive substring over name, title, description, and use-when' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          count: { type: 'number', required: true },
          templates: { type: 'array', required: true, items: TEMPLATE_SCHEMA },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderTemplateList(value) }],
    },
    execute(args) {
      // The listing only reads loaded assets, so the value is already settled.
      return Promise.resolve(listDocTemplates(store, args))
    },
  })
}
