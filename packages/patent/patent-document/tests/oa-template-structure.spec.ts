/**
 * oa-response 模板的结构防线（2026-10-16 审阅乙3）：八节 h2 结构与编号顺序、
 * example 与 template 的小节集合一致性都由此断言——重排编号或让示例漂移
 * 不再只靠人工核对。
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
