// 资产一致性测试：随包分发的模板与样式必须自洽——声明的样式能解析到已加载的样式、
// 声明的格式有渲染器、声明的变量名是 {{snake_case}} 且真的出现在正文里。

import { describe, expect, it } from 'vitest'
import { findStyleByName, loadStyles, stylesDirectory, DISCLAIMER_CATEGORY_KEYS } from '@deepseek-ai/dsh-doc-style'
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
  it('ships the twelve templates of the four introduced categories', () => {
    expect(TEMPLATES).toHaveLength(12)
    expect(categoriesOf('specification')).toHaveLength(4)
    expect(categoriesOf('claims')).toHaveLength(3)
    expect(categoriesOf('oa-response')).toHaveLength(3)
    expect(categoriesOf('disclosure')).toHaveLength(2)
  })

  it('ships no template of the categories this batch leaves out', () => {
    expect(TEMPLATES.filter(template => template.category === 'legal')).toEqual([])
    expect(TEMPLATES.filter(template => template.category === 'patent-report')).toEqual([])
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

  it('declares no style, so no shipped template resolves a disclaimer', () => {
    // The styled corpus this package was ported from is not part of the shipped
    // batch. The loop keeps style and disclaimer resolution checked for a styled
    // template a deployment adds later.
    for (const template of TEMPLATES) {
      if (template.styleName === '') continue
      const style = findStyleByName(STYLES, template.styleName)
      expect(style, template.name).toBeDefined()
      const key = DISCLAIMER_CATEGORY_KEYS[template.category]
      expect(key, `${template.name} (${template.category})`).toBeDefined()
      expect(style?.sections.disclaimers.get(key ?? ''), template.name).toBeDefined()
    }
    expect(TEMPLATES.filter(template => template.styleName !== '')).toEqual([])
  })

  it('declares only formats a renderer produces', () => {
    for (const template of TEMPLATES) {
      expect(template.supportedFormats.length).toBeGreaterThan(0)
      for (const format of template.supportedFormats) expect(RENDERER_FORMATS).toContain(format)
    }
  })

  it('offers the DOCX deliverable for every shipped template', () => {
    // The bodies carrying HTML blocks, which a DOCX package cannot reproduce,
    // left with the patent-report category; every remaining body is Markdown.
    for (const template of TEMPLATES) {
      expect(template.supportedFormats).toEqual(['markdown', 'html', 'docx'])
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
