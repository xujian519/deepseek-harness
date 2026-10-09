import { describe, expect, it } from 'vitest'
import type { TemplateDraft } from '@deepseek-ai/dsh-patent-core'
import { renderGenericTemplateSections } from '../src/document/draftConverter/index.ts'
import { readTemplateHtml } from '../src/document/templateResolver.ts'

const OA_HTML = readTemplateHtml('oa-response')

function validatedDraft(): TemplateDraft {
  return {
    fields: {
      'meta-appno': 'CN2022209876543',
      'footer-date': '2026 年 10 月 09 日',
    },
    sections: [
      {
        id: 'position-points',
        blocks: [
          { kind: 'paragraph', text: '立场段。' },
          { kind: 'list', items: ['要点一；', '要点二。'], ordered: true },
        ],
      },
      {
        id: 'amendment-table',
        rows: [['权利要求 1', '修改前', '修改后', '依据']],
      },
    ],
  }
}

describe('renderGenericTemplateSections', () => {
  it('fields 生成转义文本 inner，blocks 经 renderBlocks，rows 以占位行为模板克隆', () => {
    const sections = renderGenericTemplateSections(OA_HTML, validatedDraft())
    expect(sections['meta-appno']).toBe('CN2022209876543')
    expect(sections['position-points'] ?? '').toContain('<p>立场段。</p>')
    expect(sections['position-points'] ?? '').toContain('<li>要点一；</li>')
    // 占位行的 td 属性（居中列 class 等）随模板保留。
    expect(sections['amendment-table'] ?? '').toContain('<td>修改后</td>')
    expect(sections['amendment-table']?.match(/<tr/g)?.length).toBe(1)
  })

  it('多个 rows 槽位各克隆各的行数', () => {
    const draft = validatedDraft()
    draft.sections = [
      { id: 'amendment-table', rows: [['1', 'a', 'b', 'c'], ['2', 'd', 'e', 'f']] },
      { id: 'evidence-table', rows: [['D1', 'CN1', '2021.01.01', '实用新型', '全文', '1'], ['D2', 'CN2', '2022.01.01', '发明', '全文', '2']] },
    ]
    const sections = renderGenericTemplateSections(OA_HTML, draft)
    expect(sections['amendment-table']?.match(/<tr/g)?.length).toBe(2)
    expect(sections['evidence-table']?.match(/<tr/g)?.length).toBe(2)
  })

  it('rows 单元格文本转义', () => {
    const draft = validatedDraft()
    draft.sections = [{ id: 'amendment-table', rows: [['1', 'a<b', 'c&d', 'e']] }]
    const sections = renderGenericTemplateSections(OA_HTML, draft)
    expect(sections['amendment-table'] ?? '').toContain('a&lt;b')
    expect(sections['amendment-table'] ?? '').toContain('c&amp;d')
  })

  it('表格块带连续表题（跨 sections 连续编号）', () => {
    const draft: TemplateDraft = {
      sections: [
        { id: 'position-points', blocks: [{ kind: 'table', name: '对比表', header: ['列'], rows: [['值']] }] },
        { id: 'amended-claim-1', blocks: [{ kind: 'table', name: '修改表', header: ['列'], rows: [['值']] }] },
      ],
    }
    const sections = renderGenericTemplateSections(OA_HTML, draft)
    expect(sections['position-points'] ?? '').toContain('表 1 · 对比表')
    expect(sections['amended-claim-1'] ?? '').toContain('表 2 · 修改表')
  })

  it('列数与模板不一致时报错（绕过校验器的直接调用）', () => {
    const draft = validatedDraft()
    draft.sections = [{ id: 'amendment-table', rows: [['只有一格']] }]
    expect(() => renderGenericTemplateSections(OA_HTML, draft))
      .toThrow(/数据行槽位 amendment-table 列数 1 与模板列数 4 不一致/)
  })

  it('模板缺 rows 槽位时报错（注册表与资产不一致 fail-loud）', () => {
    const html = OA_HTML.replace('id="amendment-table"', 'id="broken-table"')
    expect(() => renderGenericTemplateSections(html, validatedDraft()))
      .toThrow(/模板缺少数据行槽位 id="amendment-table"/)
  })

  it('rows 槽位元素未闭合时报错', () => {
    const html = '<tbody id="amendment-table"><tr><td>x</td></tr>'
    expect(() => renderGenericTemplateSections(html, validatedDraft()))
      .toThrow(/数据行槽位 amendment-table 的元素未闭合/)
  })

  it('模板缺占位行时报错', () => {
    const html = OA_HTML.replace(/<tbody id="amendment-table">[\s\S]*?<\/tbody>/, '<tbody id="amendment-table"></tbody>')
    expect(() => renderGenericTemplateSections(html, validatedDraft()))
      .toThrow(/数据行槽位 amendment-table 缺少占位行/)
  })

  it('非 choice 字段收到数组时报错（绕过校验器的直接调用）', () => {
    const draft = validatedDraft()
    draft.fields = { 'meta-appno': ['A', 'B'] }
    expect(() => renderGenericTemplateSections(OA_HTML, draft))
      .toThrow(/槽位 meta-appno 不是 choice 槽位/)
  })
})

describe('renderGenericTemplateSections 占位行无 td 单元格', () => {
  it('占位行全为 th 时按 0 列处理并与草案列数不一致报错', () => {
    const html = '<table><tbody id="amendment-table"><tr><th>表头</th></tr></tbody></table>'
    expect(() => renderGenericTemplateSections(html, validatedDraft()))
      .toThrow(/数据行槽位 amendment-table 列数 4 与模板列数 0 不一致/)
  })
})
