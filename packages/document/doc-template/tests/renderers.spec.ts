// 上游来源：Mady 项目 `domains/doctmpl/renderer_markdown.go`（标题与免责声明注入顺序）、
// `renderer_html.go`（`lang` 属性、作者元数据、两套样式表的选择规则）、
// `renderer_docx.go`（标题与免责声明注入，本包委托 `@deepseek-ai/dsh-docx-kit`）、
// `renderer_registry.go`（注册、查找、未注册格式报错）。

import { describe, expect, it } from 'vitest'
import { extractDocxText } from '@deepseek-ai/dsh-docx-kit'
import { createRendererRegistry, RendererRegistry } from '../src/renderer-registry.ts'
import { escapeHtmlText, isPatentStyle } from '../src/renderers/html.ts'
import { applyDisclaimer } from '../src/renderers/markdown.ts'
import { DocTemplateError, type Renderer } from '../src/types.ts'

const PATENT_STYLE = { name: 'patent-standard', disclaimer: '本分析由 AI 辅助生成。' }
const NEUTRAL_STYLE = { name: 'assistant-neutral', disclaimer: '' }

/** A renderer registered only by the registry cases. */
const STUB: Renderer = { format: 'markdown', render: () => 'stub' }

describe('Markdown renderer', () => {
  it('prepends the disclaimer in the upstream form', () => {
    expect(applyDisclaimer(PATENT_STYLE, '正文')).toBe('> ⚠️ 本分析由 AI 辅助生成。\n\n---\n\n正文')
    expect(applyDisclaimer(NEUTRAL_STYLE, '正文')).toBe('正文')
    expect(applyDisclaimer(undefined, '正文')).toBe('正文')
  })

  it('prepends the title only when the body has none', () => {
    const registry = createRendererRegistry()
    const meta = { language: 'zh-CN' }
    expect(registry.render('markdown', '正文', { ...meta, title: '标题' })).toBe('# 标题\n\n正文')
    expect(registry.render('markdown', '# 已有标题\n\n正文', { ...meta, title: '标题' })).toBe('# 已有标题\n\n正文')
    expect(registry.render('markdown', '正文', { ...meta, title: '' })).toBe('正文')
    expect(registry.render('markdown', '正文', meta)).toBe('正文')
  })

  it('writes the disclaimer before the title, as upstream', () => {
    const registry = createRendererRegistry()
    expect(registry.render('markdown', '正文', { language: 'zh-CN', title: '标题', style: PATENT_STYLE }))
      .toBe('# 标题\n\n> ⚠️ 本分析由 AI 辅助生成。\n\n---\n\n正文')
  })
})

describe('HTML renderer', () => {
  const registry = createRendererRegistry()

  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtmlText('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#39;')
    expect(escapeHtmlText('普通文本')).toBe('普通文本')
  })

  it('selects the patent stylesheet for the patent styles only', () => {
    expect(isPatentStyle(PATENT_STYLE)).toBe(true)
    expect(isPatentStyle({ name: 'sati', disclaimer: '' })).toBe(true)
    expect(isPatentStyle({ name: 'PATENT-DRAFT', disclaimer: '' })).toBe(true)
    expect(isPatentStyle(NEUTRAL_STYLE)).toBe(false)
    expect(isPatentStyle(undefined)).toBe(false)
  })

  it('writes a standalone document with the language, title, author, and stylesheet', () => {
    const html = registry.render('html', '**加粗**', {
      language: 'en-US',
      title: 'A <title>',
      author: 'A & B',
      style: NEUTRAL_STYLE,
    })
    expect(typeof html).toBe('string')
    const document = String(html)
    expect(document.startsWith('<!DOCTYPE html>\n<html lang="en-US">\n<head>\n<meta charset="UTF-8">\n')).toBe(true)
    expect(document).toContain('<title>A &lt;title&gt;</title>')
    expect(document).toContain('<meta name="author" content="A &amp; B">')
    expect(document).toContain('<h1>A &lt;title&gt;</h1>')
    expect(document).toContain('<strong>加粗</strong>')
    expect(document).toContain('font-family:-apple-system')
    expect(document.endsWith('</body>\n</html>\n')).toBe(true)
  })

  it('omits the title and author metadata when the caller supplies none', () => {
    const document = String(registry.render('html', '正文', { language: 'zh-CN' }))
    expect(document).not.toContain('<title>')
    expect(document).not.toContain('<meta name="author"')
    expect(document).not.toContain('<h1')
    expect(document).toContain('<p>正文</p>')
    expect(document).toContain('<html lang="zh-CN">')
  })

  it('renders a body heading as a heading of the document', () => {
    const document = String(registry.render('html', '# 正文', { language: 'zh-CN' }))
    expect(document).toMatch(/<h1[^>]*>正文<\/h1>/u)
  })

  it('passes the template markup through and keeps the disclaimer above it', () => {
    const document = String(registry.render('html', '<div class="doc-meta">正文</div>', { language: 'zh-CN', style: PATENT_STYLE }))
    expect(document).toContain('<div class="doc-meta">正文</div>')
    expect(document).toContain('⚠️ 本分析由 AI 辅助生成。')
    expect(document).toContain('@page { size: A4;')
  })
})

describe('DOCX renderer', () => {
  const registry = createRendererRegistry()

  it('writes a DOCX package carrying the title, the disclaimer, and the body', () => {
    const bytes = registry.render('docx', '正文**加粗**', { language: 'zh-CN', title: '交底书', style: PATENT_STYLE })
    expect(bytes).toBeInstanceOf(Uint8Array)
    const text = extractDocxText(bytes as Uint8Array).text
    expect(text).toContain('交底书')
    expect(text).toContain('本分析由 AI 辅助生成。')
    expect(text).toContain('正文加粗')
  })

  it('omits the title and the disclaimer when the caller supplies neither', () => {
    const text = extractDocxText(registry.render('docx', '正文', { language: 'zh-CN', style: NEUTRAL_STYLE }) as Uint8Array).text
    expect(text).toBe('正文')
  })
})

describe('RendererRegistry', () => {
  it('registers, replaces, and looks up renderers by format', () => {
    const registry = new RendererRegistry()
    expect(registry.has('markdown')).toBe(false)
    expect(registry.get('markdown')).toBeUndefined()
    expect(registry.formats()).toEqual([])
    registry.register(STUB)
    expect(registry.has('markdown')).toBe(true)
    expect(registry.get('markdown')).toBe(STUB)
    expect(registry.formats()).toEqual(['markdown'])
    const replacement: Renderer = { format: 'markdown', render: () => 'replaced' }
    registry.register(replacement)
    expect(registry.get('markdown')).toBe(replacement)
  })

  it('renders through the registered renderer and fails loud on an unregistered format', () => {
    const registry = new RendererRegistry()
    registry.register(STUB)
    expect(registry.render('markdown', 'body', { language: 'zh-CN' })).toBe('stub')
    expect(() => registry.render('docx', 'body', { language: 'zh-CN' })).toThrow(DocTemplateError)
    expect(() => registry.render('docx', 'body', { language: 'zh-CN' })).toThrow(/没有注册 docx 格式的渲染器/)
  })

  it('ships the Markdown, HTML, and DOCX renderers', () => {
    expect(createRendererRegistry().formats()).toEqual(['docx', 'html', 'markdown'])
  })
})
