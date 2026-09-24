/**
 * The template store, rewritten from `store.go` of the Go project Mady: the
 * loaded templates, the lookup and listing operations over them, and the
 * resolution-then-render pipeline.
 *
 * The store is constructed once with explicit directories, the loaded styles,
 * and the deployment defaults, and is then read-only, so no lock is needed.
 * @module @deepseek-ai/dsh-doc-template/store
 */

import { resolve } from 'node:path'
import { findStyleByName, toRenderStyle, type DocumentStyle } from '@deepseek-ai/dsh-doc-style'
import { loadTemplateDirectory } from './loader.ts'
import { RendererRegistry, createRendererRegistry } from './renderer-registry.ts'
import { escapeHtmlText } from './renderers/html.ts'
import {
  DocTemplateError,
  FALLBACK_FORMAT,
  FORMAT_ENCODINGS,
  FORMAT_EXTENSIONS,
  FORMAT_MIME_TYPES,
  type DocTemplate,
  type OutputFormat,
  type RenderMeta,
  type RenderStyle,
  type ResolveResult,
  type VarDefinition,
  type VarIssue,
} from './types.ts'
import { validatedResolve } from './vars.ts'

/** Filters of a template listing; every filter is optional. */
export interface TemplateFilter {
  /** Exact category, e.g. `claims`. */
  readonly category?: string
  /** Exact domain, e.g. `patent`. */
  readonly domain?: string
  /** Exact effective language, e.g. `zh-CN`. */
  readonly language?: string
  /** Case-insensitive substring matched against name, title, description, and use-when. */
  readonly query?: string
}

/** A version discrepancy between a first-loaded template and an overriding one. */
export interface VersionConflict {
  /** Template name. */
  readonly templateName: string
  /** Version of the first-loaded template, which the packaged asset declares. */
  readonly packagedVersion: string
  /** Version of the template that overrode it. */
  readonly overrideVersion: string
  /** `warn` when the override compares older than the packaged version, `info` otherwise. */
  readonly severity: 'info' | 'warn'
}

/** The merged variable space of several templates. */
export interface MergedVarContext {
  /** The merged templates, in the order requested. */
  readonly templates: readonly DocTemplate[]
  /** Variables declared by more than one of the templates. */
  readonly sharedVars: readonly string[]
  /** Every distinct variable, taking the last template's definition. */
  readonly allVars: readonly VarDefinition[]
}

/** Construction options of a template store. */
export interface TemplateStoreOptions {
  /**
   * Template asset roots in ascending precedence: the packaged root first, then
   * the configured overrides. A name repeated across roots is overridden.
   */
  readonly templateDirs: readonly string[]
  /** Loaded styles, used to resolve a template's `styleName`. */
  readonly styles: readonly DocumentStyle[]
  /** Language a template without a declared `language` is rendered in. */
  readonly defaultLanguage: string
  /** Whether the style disclaimer is injected into rendered documents. */
  readonly includeDisclaimer: boolean
  /** Renderer registry to use; the shipped Markdown, HTML, and DOCX renderers by default. */
  readonly renderers?: RendererRegistry
}

/** One render request. */
export interface RenderRequest {
  /** Template name. */
  readonly template: string
  /** Variable values, keyed by variable name without braces. */
  readonly variables: Readonly<Record<string, string>>
  /** Target format; the fallback format when omitted. */
  readonly format?: OutputFormat
  /** Document title override; the template title when omitted. */
  readonly title?: string
  /** Author or attorney recorded in the HTML metadata. */
  readonly author?: string
  /** Document date recorded in the HTML metadata. */
  readonly date?: string
  /** Suggested file name without extension; the template name when omitted. */
  readonly filename?: string
}

/** One rendered document. */
export interface RenderOutcome {
  /** The template that was rendered. */
  readonly template: DocTemplate
  /** The format rendered to. */
  readonly format: OutputFormat
  /** Suggested file name including the format's extension. */
  readonly fileName: string
  /** Content type of the rendered document. */
  readonly mimeType: string
  /** How `content` is encoded. */
  readonly encoding: 'utf8' | 'base64'
  /** The rendered document: text for the text formats, a base64 package for DOCX. */
  readonly content: string
  /** The resolved Markdown body the renderer consumed. */
  readonly markdown: string
  /** Placeholders left unfilled, in first-occurrence order. */
  readonly residual: readonly string[]
  /** Non-blocking variable validation issues, in declaration order. */
  readonly warnings: readonly VarIssue[]
}

/** The loaded templates, their styles, and the render pipeline over them. */
export class TemplateStore {
  private readonly templates: readonly DocTemplate[]
  private readonly positionByName: ReadonlyMap<string, number>
  private readonly firstVersions: ReadonlyMap<string, string>
  private readonly styles: readonly DocumentStyle[]
  private readonly defaultLanguage: string
  private readonly includeDisclaimer: boolean
  private readonly renderers: RendererRegistry

  /**
   * @param options - asset roots, styles, and deployment defaults.
   * @throws DocTemplateError when no root is given, a root is unavailable, an asset is invalid, or no template loaded.
   */
  constructor(options: TemplateStoreOptions) {
    if (options.templateDirs.length === 0) {
      throw new DocTemplateError('asset-invalid', '未提供模板目录：无法加载任何模板资产。')
    }
    const templates: DocTemplate[] = []
    const positions = new Map<string, number>()
    const firstVersions = new Map<string, string>()
    for (const directory of options.templateDirs) {
      for (const template of loadTemplateDirectory(directory)) {
        const existing = positions.get(template.name)
        if (existing === undefined) {
          positions.set(template.name, templates.length)
          firstVersions.set(template.name, template.version)
          templates.push(template)
          continue
        }
        templates[existing] = template
      }
    }
    if (templates.length === 0) {
      throw new DocTemplateError('asset-invalid', `模板目录 ${options.templateDirs.join('、')} 中没有 .md 模板资产。`)
    }
    this.templates = templates
    this.positionByName = positions
    this.firstVersions = firstVersions
    this.styles = options.styles
    this.defaultLanguage = options.defaultLanguage
    this.includeDisclaimer = options.includeDisclaimer
    this.renderers = options.renderers ?? createRendererRegistry()
  }

  /** The loaded templates, in load order. */
  get allTemplates(): readonly DocTemplate[] {
    return this.templates
  }

  /** The number of loaded templates. */
  get count(): number {
    return this.templates.length
  }

  /**
   * The renderer registry, for a consumer that registers an additional format.
   * @returns the registry.
   */
  get rendererRegistry(): RendererRegistry {
    return this.renderers
  }

  /**
   * The language a template renders in: its declaration, or the deployment default.
   * @param template - the template.
   * @returns the effective language tag.
   */
  languageOf(template: DocTemplate): string {
    return template.language === '' ? this.defaultLanguage : template.language
  }

  /**
   * List the templates matching a filter.
   * @param filter - the filters to apply; an empty filter returns every template.
   * @returns the matching templates, in load order.
   */
  list(filter: TemplateFilter = {}): readonly DocTemplate[] {
    const query = (filter.query ?? '').trim().toLowerCase()
    return this.templates.filter((template) => {
      if (filter.category !== undefined && template.category !== filter.category) return false
      if (filter.domain !== undefined && template.domain !== filter.domain) return false
      if (filter.language !== undefined && this.languageOf(template) !== filter.language) return false
      if (query === '') return true
      return [template.name, template.title, template.description, template.useWhen]
        .some(field => field.toLowerCase().includes(query))
    })
  }

  /**
   * Find a template by name.
   * @param name - the template name.
   * @returns the template, or `undefined` when no template has that name.
   */
  findByName(name: string): DocTemplate | undefined {
    const position = this.positionByName.get(name)
    return position === undefined ? undefined : this.templates[position]
  }

  /**
   * Find a template by name, restricted to one effective language.
   * @param name - the template name.
   * @param language - the required language; an empty string accepts any.
   * @returns the template, or `undefined` when it is absent or in another language.
   */
  findByNameAndLanguage(name: string, language: string): DocTemplate | undefined {
    const template = this.findByName(name)
    if (template === undefined) return undefined
    if (language !== '' && this.languageOf(template) !== language) return undefined
    return template
  }

  /**
   * Report the templates an override replaced with a different version.
   * @returns one entry per differing template, in load order.
   */
  listConflicts(): readonly VersionConflict[] {
    const conflicts: VersionConflict[] = []
    for (const template of this.templates) {
      const packagedVersion = this.firstVersions.get(template.name)
      if (packagedVersion === undefined || template.version === packagedVersion) continue
      conflicts.push({
        templateName: template.name,
        packagedVersion,
        overrideVersion: template.version,
        severity: compareVersions(template.version, packagedVersion) < 0 ? 'warn' : 'info',
      })
    }
    return conflicts
  }

  /**
   * Merge the variable spaces of the named templates. A variable declared by
   * more than one template, or listed under `shared_vars` by one and declared by
   * another, is shared; the last template's definition wins.
   * @param names - the template names to merge.
   * @returns the templates, their shared variable names, and every distinct definition.
   * @throws DocTemplateError when a name is not loaded.
   */
  mergeVarContext(names: readonly string[]): MergedVarContext {
    const templates: DocTemplate[] = []
    const occurrences = new Map<string, number>()
    const countUp = (name: string): void => {
      occurrences.set(name, (occurrences.get(name) ?? 0) + 1)
    }
    for (const name of names) {
      const template = this.findByName(name)
      if (template === undefined) {
        throw new DocTemplateError('template-not-found', `未找到模板 ${JSON.stringify(name)}，无法合并变量空间。`)
      }
      templates.push(template)
      const declared = template.varSchema.names()
      for (const variable of declared) countUp(variable)
      for (const shared of template.sharedVars) {
        if (!declared.includes(shared)) countUp(shared)
      }
    }
    const sharedVars = [...occurrences].filter(([, count]) => count > 1).map(([name]) => name)
    const allVars: VarDefinition[] = []
    const seen = new Set<string>()
    for (const template of templates) {
      for (const definition of template.varSchema.definitions) seen.add(definition.name)
    }
    for (const name of seen) {
      for (let position = templates.length - 1; position >= 0; position -= 1) {
        const definition = templates[position]?.varSchema.get(name)
        if (definition === undefined) continue
        allVars.push(definition)
        break
      }
    }
    return { templates, sharedVars, allVars }
  }

  /**
   * Resolve a template's variables and render it.
   *
   * Every failure that a caller cannot recover from is an error rather than a
   * degraded document: an unknown template or style name, a format the template
   * does not support, and a missing required variable. A value of the wrong type
   * stays a warning, and an unresolved placeholder stays in the residual list, so
   * the caller decides what to do with a document that rendered but is incomplete.
   * @param request - the template, variables, format, and metadata overrides.
   * @returns the rendered document with its residual placeholders and warnings.
   * @throws DocTemplateError when the template, style, format, or required variables cannot be satisfied.
   */
  render(request: RenderRequest): RenderOutcome {
    const template = this.findByName(request.template)
    if (template === undefined) {
      throw new DocTemplateError(
        'template-not-found',
        `未找到模板 ${JSON.stringify(request.template)}；可用模板见 list_doc_templates。`,
      )
    }
    const format = request.format ?? FALLBACK_FORMAT
    if (!template.supportedFormats.includes(format)) {
      throw new DocTemplateError(
        'format-unsupported',
        `模板 ${template.name} 不支持 ${format} 格式（支持 ${template.supportedFormats.join('/')}）。`,
      )
    }
    const style = this.resolveStyle(template)
    // HTML output passes raw template markup through, so a variable value is escaped first.
    const variables = format === 'html' ? escapeVariables(request.variables) : request.variables
    const resolved: ResolveResult = validatedResolve(template, variables)
    const missing = resolved.warnings.filter(warning => warning.code === 'missing_required')
    if (missing.length > 0) {
      throw new DocTemplateError(
        'variable-missing',
        `模板 ${template.name} 缺少必填变量：${missing.map(issue => issue.variable).join('、')}。`,
      )
    }
    const title = request.title ?? template.title
    const meta: RenderMeta = {
      ...(style === undefined ? {} : { style }),
      ...(title === '' ? {} : { title }),
      ...(request.author === undefined ? {} : { author: request.author }),
      ...(request.date === undefined ? {} : { date: request.date }),
      ...(request.filename === undefined ? {} : { filename: request.filename }),
      language: this.languageOf(template),
    }
    const rendered = this.renderers.render(format, resolved.output, meta)
    return {
      template,
      format,
      fileName: `${request.filename ?? template.name}${FORMAT_EXTENSIONS[format]}`,
      mimeType: FORMAT_MIME_TYPES[format],
      encoding: FORMAT_ENCODINGS[format],
      content: typeof rendered === 'string' ? rendered : Buffer.from(rendered).toString('base64'),
      markdown: resolved.output,
      residual: resolved.residual,
      warnings: resolved.warnings,
    }
  }

  /**
   * Resolve the render style a template names.
   * @param template - the template.
   * @returns the render style, or `undefined` when the template declares none.
   * @throws DocTemplateError when the declared style is not loaded.
   */
  private resolveStyle(template: DocTemplate): RenderStyle | undefined {
    if (template.styleName === '') return undefined
    const style = findStyleByName(this.styles, template.styleName)
    if (style === undefined) {
      throw new DocTemplateError(
        'style-not-found',
        `模板 ${template.name} 声明的样式 ${JSON.stringify(template.styleName)} 未加载；请检查样式资产目录。`,
      )
    }
    const renderStyle = toRenderStyle(style, template.category)
    return this.includeDisclaimer ? renderStyle : { name: renderStyle.name, disclaimer: '' }
  }
}

/**
 * Build a template store.
 * @param options - asset roots, styles, and deployment defaults.
 * @returns the store.
 */
export function createTemplateStore(options: TemplateStoreOptions): TemplateStore {
  return new TemplateStore(options)
}

/**
 * Resolve a configured directory against the process working directory.
 * @param directory - the configured directory.
 * @returns the absolute path.
 */
export function resolveTemplateDirectory(directory: string): string {
  return resolve(directory)
}

/**
 * Order two dotted template versions by segment, so `10.0.0` follows `1.0.0`
 * where a code-unit string comparison would order it first. A missing or
 * non-numeric segment counts as 0, so `1.0` equals `1.0.0`.
 * @param left - left version.
 * @param right - right version.
 * @returns negative when `left` is older, positive when newer, 0 when equal by this rule.
 */
function compareVersions(left: string, right: string): number {
  const leftSegments = left.split('.')
  const rightSegments = right.split('.')
  for (let index = 0; index < Math.max(leftSegments.length, rightSegments.length); index += 1) {
    const difference = (Number(leftSegments[index]) || 0) - (Number(rightSegments[index]) || 0)
    if (difference !== 0) return difference
  }
  return 0
}

/**
 * Escape every variable value for HTML substitution.
 * @param variables - the supplied values.
 * @returns a new map with escaped values.
 */
function escapeVariables(variables: Readonly<Record<string, string>>): Record<string, string> {
  const escaped: Record<string, string> = {}
  for (const [name, value] of Object.entries(variables)) escaped[name] = escapeHtmlText(value)
  return escaped
}
