// 资产一致性测试：随包分发的模板与样式必须自洽——声明的样式能解析到已加载的样式、
// 声明的格式有渲染器、声明的变量名是 {{snake_case}} 且真的出现在正文里。

import { describe, expect, it } from 'vitest'
import { findStyleByName, loadStyles, stylesDirectory } from '@deepseek-ai/dsh-doc-style'
import { templatesDirectory } from '../src/asset-location.ts'
import { loadTemplateDirectory } from '../src/loader.ts'
import { createRendererRegistry } from '../src/renderer-registry.ts'

const TEMPLATES = loadTemplateDirectory(templatesDirectory())
const STYLES = loadStyles([stylesDirectory()])
const RENDERER_FORMATS = createRendererRegistry().formats()

/** The category of every shipped template, in load order. */
function categoriesOf(category: string): string[] {
  return TEMPLATES.filter(template => template.category === category).map(template => template.name)
}

describe('shipped template assets', () => {
  it('ships the seventeen templates of the five introduced categories', () => {
    expect(TEMPLATES).toHaveLength(17)
    expect(categoriesOf('patent-report')).toHaveLength(5)
    expect(categoriesOf('specification')).toHaveLength(4)
    expect(categoriesOf('claims')).toHaveLength(3)
    expect(categoriesOf('oa-response')).toHaveLength(3)
    expect(categoriesOf('disclosure')).toHaveLength(2)
  })

  it('ships no template of the categories this batch leaves out', () => {
    expect(TEMPLATES.filter(template => template.category === 'legal')).toEqual([])
    expect(TEMPLATES.filter(template => template.domain !== 'patent')).toEqual([])
  })

  it('describes every template in Chinese, with a title, a version, and a domain', () => {
    for (const template of TEMPLATES) {
      expect(template.language).toBe('zh-CN')
      expect(template.title).not.toBe('')
      expect(template.description).not.toBe('')
      expect(template.version).toMatch(/^\d+\.\d+/u)
      expect(template.domain).toBe('patent')
    }
  })

  it('resolves every declared style to a loaded style', () => {
    // Only the patent-report templates declare a style upstream; the plain
    // Markdown templates render without a disclaimer.
    for (const template of TEMPLATES) {
      if (template.styleName === '') continue
      expect(findStyleByName(STYLES, template.styleName)).toBeDefined()
    }
    expect(TEMPLATES.filter(template => template.styleName === '')).toHaveLength(12)
    expect(categoriesOf('patent-report').every(name => TEMPLATES.find(template => template.name === name)?.styleName === 'patent-standard')).toBe(true)
  })

  it('declares only formats a renderer produces', () => {
    for (const template of TEMPLATES) {
      expect(template.supportedFormats.length).toBeGreaterThan(0)
      for (const format of template.supportedFormats) expect(RENDERER_FORMATS).toContain(format)
    }
  })

  it('offers the DOCX deliverable for the plain Markdown templates only', () => {
    // The patent-report bodies carry HTML blocks (`<div class="doc-meta">`), which
    // a DOCX package cannot reproduce, so those templates stay Markdown and HTML.
    for (const template of TEMPLATES) {
      const htmlStyled = template.category === 'patent-report'
      expect(template.supportedFormats).toContain('markdown')
      expect(template.supportedFormats.includes('docx')).toBe(!htmlStyled)
    }
  })

  it('declares every variable as a snake_case name that appears in the body', () => {
    for (const template of TEMPLATES) {
      for (const definition of template.varSchema.definitions) {
        expect(definition.name).toMatch(/^[a-z][a-z0-9_]*$/u)
        expect(template.body).toContain(`{{${definition.name}}}`)
      }
    }
  })

  it('keeps the upstream shared-variable and changelog sections empty for this batch', () => {
    for (const template of TEMPLATES) {
      expect(template.sharedVars).toEqual([])
      expect(template.extends).toEqual([])
      expect(template.changelog).toEqual([])
    }
  })
})

describe('shipped style assets', () => {
  it('ships the four upstream styles', () => {
    expect(STYLES.map(style => style.name)).toEqual(['assistant-neutral', 'chat-friendly', 'legal-standard', 'patent-standard'])
  })

  it('gives the patent style the disclaimers the shipped templates need', () => {
    const patent = findStyleByName(STYLES, 'patent-standard')
    expect(patent?.sections.disclaimers.get('patent_drafting')).toContain('需经专利代理人审阅')
    expect(patent?.sections.disclaimers.get('patent_analysis')).toContain('不构成正式法律意见')
  })
})
