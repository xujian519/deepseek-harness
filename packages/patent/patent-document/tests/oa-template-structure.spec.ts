/**
 * oa-response 模板的结构防线（2026-10-16 审阅乙3）：八节 h2 结构与编号顺序、
 * example 与 template 的小节集合一致性都由此断言——重排编号或让示例漂移
 * 不再只靠人工核对。
 *
 * 2026-10-30 增补两条成品纪律：可选节必须带 `data-omit-if-empty` 折叠标记
 * （否则空节标题会留在交付物里），模板正文不得含写给起草人的作业指令
 * （这些句子只活在 references/）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const TEMPLATE_DIR = join(import.meta.dirname, '../assets/templates/patent/oa-response')

/** 抽取 `<h2>…</h2>` 的小节标题，保持文档顺序。 */
function sectionsOf(file: string): string[] {
  const html = readFileSync(join(TEMPLATE_DIR, file), 'utf8')
  return [...html.matchAll(/<h2[^>]*>([^<]+)<\/h2>/g)].map(match => (match[1] ?? '').trim())
}

const templateSections = sectionsOf('assets/template.html')
const exampleSections = sectionsOf('example.html')

/** 模板正文（去掉样式表）：成品只由这一段渲染出来。 */
function bodyOf(file: string): string {
  return readFileSync(join(TEMPLATE_DIR, file), 'utf8').replace(/<style[\s\S]*?<\/style>/i, '')
}

/** 可选节的折叠标记：值是可空槽位 id。 */
function omitMarkers(file: string): string[] {
  return [...bodyOf(file).matchAll(/data-omit-if-empty="([^"]+)"/g)].map(match => match[1] ?? '')
}

/**
 * 写给起草人的作业指令：成品读者不需要，一旦渲染出去就是交付物里的杂音。
 * 这些句子只应活在 `references/conventions.md` 与 `references/checklist.md`。
 */
const DRAFTING_INSTRUCTIONS = ['两句以内', '不作评价', '不作小节标题', '逐项列明', 'citation-log.md'] as const

describe('oa-response 模板结构（乙3 防线）', () => {
  it('template 恰有八个 h2 小节，且以中文序数一~八连续编号', () => {
    expect(templateSections).toHaveLength(8)
    expect(templateSections.map(section => section.slice(0, 1))).toEqual([
      '一', '二', '三', '四', '五', '六', '七', '八',
    ])
  })

  it('example 的小节集合与顺序与 template 一致（覆盖度断言）', () => {
    expect(exampleSections).toEqual(templateSections)
  })

  it('两个可选节带折叠标记，标记的槽位就是注册表里的可空槽位', () => {
    expect(omitMarkers('assets/template.html')).toEqual(['argument-other', 'formalities-body'])
  })

  it('模板正文不含写给起草人的指令（这些句子只活在 references/）', () => {
    const body = bodyOf('assets/template.html')
    for (const phrase of DRAFTING_INSTRUCTIONS) {
      expect(body, `模板正文不应出现起草指令「${phrase}」`).not.toContain(phrase)
    }
  })

  it('示例与折叠行为一致：无其他争点时不设 5.3 小节', () => {
    const body = bodyOf('example.html')
    expect(body).toContain('5.1 关于新颖性')
    expect(body).toContain('5.2 关于创造性')
    expect(body).not.toContain('5.3 其他争点')
  })

  it('template 与 example 的签名行不含下划线占位（人工签署时填写）', () => {
    for (const file of ['assets/template.html', 'example.html']) {
      const html = readFileSync(join(TEMPLATE_DIR, file), 'utf8')
      const signatureRows = [...html.matchAll(/<div class="sign-block"[^>]*>([\s\S]*?)<\/div>/g)]
        .map(match => (match[1] ?? '').trim())
      expect(signatureRows).toEqual(['代理人：', '日期：'])
      expect(signatureRows.join('')).not.toContain('________')
    }
  })
})
