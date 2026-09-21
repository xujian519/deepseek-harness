/**
 * Projections of a loaded style, rewritten from the methods and helpers of
 * `domains/config/style.go` of the Go project Mady.
 *
 * Three projections exist because the three consumers need different amounts of
 * the style: the system prompt carries the whole guide to the model, the
 * template-context prompt adds the template and its required disclaimer, and the
 * render style carries only what a renderer injects into the output.
 * @module @deepseek-ai/dsh-doc-style/projection
 */

import {
  DISCLAIMER_CATEGORY_KEYS,
  type DocumentStyle,
  type RenderStyle,
  type TemplateContext,
} from './types.ts'

/**
 * Render a style as the system-prompt block an agent reads before writing.
 * Section order and wording follow the upstream guide; sections the style leaves
 * empty are omitted entirely.
 * @param style - the style to project.
 * @returns the prompt block, without a trailing newline.
 */
export function systemPrompt(style: DocumentStyle): string {
  const { tone, voice, antiPatterns, disclaimers, citation, outputConventions } = style.sections
  const lines: string[] = [
    '<!-- Document Style Guide -->',
    `Style: ${style.name} (domain: ${style.domain}, version: ${style.version})`,
    '',
  ]

  if (tone.formality !== '' || tone.perspective !== '' || tone.language !== '') {
    lines.push('## Tone')
    if (tone.formality !== '') lines.push(`- Formality: ${tone.formality}`)
    if (tone.perspective !== '') lines.push(`- Perspective: ${tone.perspective} person`)
    if (tone.language !== '') lines.push(`- Language: ${tone.language}`)
    lines.push('')
  }

  if (voice.principles.length > 0) {
    lines.push('## Voice Principles')
    for (const principle of voice.principles) lines.push(`- ${principle}`)
    lines.push('')
  }

  if (antiPatterns.length > 0) {
    lines.push('## Anti-Patterns (FORBIDDEN WORDS)')
    for (const pattern of antiPatterns) {
      const tag = pattern.severity === 'warn' ? '[WARN]' : '[BLOCK]'
      lines.push(`- ${tag} Never use ${JSON.stringify(pattern.word)} → use ${JSON.stringify(pattern.replace)} instead`)
    }
    lines.push('')
  }

  if (disclaimers.size > 0) {
    lines.push('## Required Disclaimers')
    for (const [key, text] of disclaimers) lines.push(`- ${key}: ${text}`)
    lines.push('')
  }

  if (citation.style !== '') {
    lines.push('## Citation Format')
    lines.push(`- Style: ${citation.style}`)
    if (citation.format !== '') lines.push(`- Format: ${citation.format}`)
    lines.push('')
  }

  if (outputConventions.confidenceLabel || outputConventions.weakVisual) {
    lines.push('## Output Conventions')
    if (outputConventions.confidenceLabel) lines.push('- Attach confidence labels to all analytical conclusions')
    if (outputConventions.weakVisual) lines.push('- De-emphasize low-confidence content visually')
    lines.push('')
  }

  lines.push('<!-- End Document Style Guide -->')
  return lines.join('\n')
}

/**
 * The disclaimer that applies to documents of one template category.
 * The category map selects the specific disclaimer; when the style has none for
 * it, the domain-level `<domain>_analysis` disclaimer applies; when the style has
 * neither, no disclaimer applies and the empty string is returned.
 * @param style - the style to read.
 * @param category - the template category, e.g. `claims` or `oa-response`.
 * @returns the disclaimer text, or the empty string when none applies.
 */
export function disclaimerFor(style: DocumentStyle, category: string): string {
  const key = DISCLAIMER_CATEGORY_KEYS[category]
  if (key !== undefined) {
    const disclaimer = style.sections.disclaimers.get(key)
    if (disclaimer !== undefined) return disclaimer
  }
  return style.sections.disclaimers.get(`${style.domain}_analysis`) ?? ''
}

/**
 * Project a style and a template category to what a renderer injects.
 * @param style - the style to project.
 * @param categoryHint - the template category that selects the disclaimer.
 * @returns the render style.
 */
export function toRenderStyle(style: DocumentStyle, categoryHint: string): RenderStyle {
  return { name: style.name, disclaimer: disclaimerFor(style, categoryHint) }
}

/**
 * Render the style guide followed by the template context, so a model fills a
 * template while following the style.
 * @param style - the style to project.
 * @param template - the template the content fills.
 * @returns the prompt block, without a trailing newline.
 */
export function systemPromptForTemplate(style: DocumentStyle, template: TemplateContext): string {
  const lines: string[] = [
    systemPrompt(style),
    '<!-- Template Context -->',
    `Template: ${template.name} (${template.title})`,
    `Category: ${template.category}`,
  ]
  const disclaimer = disclaimerFor(style, template.category)
  if (disclaimer !== '') lines.push(`Required Disclaimer: ${disclaimer}`)
  lines.push('', 'Generate content following the style guide above and filling the template variables below.', '<!-- End Template Context -->')
  return lines.join('\n')
}

/**
 * The styles belonging to one domain.
 * @param styles - the loaded styles.
 * @param domain - the domain to select, e.g. `patent`.
 * @returns the matching styles, in load order.
 */
export function stylesForDomain(styles: readonly DocumentStyle[], domain: string): readonly DocumentStyle[] {
  return styles.filter(style => style.domain === domain)
}

/**
 * Find a style by name.
 * @param styles - the loaded styles.
 * @param name - the style name a template declares as its `style`.
 * @returns the first matching style, or `undefined` when none matches.
 */
export function findStyleByName(styles: readonly DocumentStyle[], name: string): DocumentStyle | undefined {
  return styles.find(style => style.name === name)
}
