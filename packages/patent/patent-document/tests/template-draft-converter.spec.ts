import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { validateTemplateDraft, type TemplateDraft } from '@deepseek-ai/dsh-patent-core'
import { injectTemplateDraft } from '../src/document/draftConverter/index.ts'
import { FORM_TEMPLATE_SCHEMAS } from '../src/document/draftSchema/index.ts'
import { readTemplateHtml } from '../src/document/templateResolver.ts'

/** 读取示例草案并通过注册表校验。 */
function exampleDraft(template: 'right-evaluation-report' | 'search-report-form'): TemplateDraft {
  const raw = JSON.parse(readFileSync(
    `packages/patent/patent-document/assets/templates/patent/${template}/assets/example-draft.json`,
    'utf8',
  )) as unknown
  return validateTemplateDraft(raw, FORM_TEMPLATE_SCHEMAS[template])
}

describe('injectTemplateDraft', () => {
  it('text 槽填充全部同名元素（抬头与落款同一值）', () => {
    const html = injectTemplateDraft(readTemplateHtml('search-report-form'), 'search-report-form', exampleDraft('search-report-form'))
    const hits = html.match(/检索人：<span class="fill">王磊<\/span>/g) ?? []
    expect(hits.length).toBe(2)
  })

  it('choice 单选与多选渲染勾选状态，未选选项保持空白', () => {
    const html = injectTemplateDraft(readTemplateHtml('right-evaluation-report'), 'right-evaluation-report', exampleDraft('right-evaluation-report'))
    expect(html).toContain('<span class="cb on"></span><span class="txt">与授权公告一并公布的专利文件')
    expect(html).toContain('<span class="cb"></span><span class="txt">由生效的无效宣告请求审查决定')
    expect(html).toContain('<span class="cb on"></span><span class="txt">全部权利要求 <span class="fill w-sm">1-8</span>；')
    // 创造性：具备与不具备同时勾选。
    expect(html).toContain('<span class="cb on"></span><span class="txt">权利要求 <span class="fill">2-4、6-8</span> 具备')
    expect(html).toContain('<span class="cb on"></span><span class="txt">权利要求 <span class="fill">1、5</span> 不具备')
    // F 区静态声明不被触碰。
    expect(html).toContain('<span class="cb"></span><span class="txt">说明书不符合专利法第 26 条第 3 款的规定。')
  })

  it('blocks 槽逐块克隆行包装并移除多余占位行', () => {
    const html = injectTemplateDraft(readTemplateHtml('search-report-form'), 'search-report-form', exampleDraft('search-report-form'))
    // databases 两个草案段落 → 两行 part-value，模板第二个 tight 占位被移除。
    expect(html).toContain('<div class="part-value"><span class="fill w-full">CNABS, DWPI, SIPOABS, 中国期刊网全文数据库：</span></div>')
    expect(html).toContain('<div class="part-value"><span class="fill w-full">输送带, 张紧')
    expect(html).not.toContain('part-value tight')
  })

  it('list 块每项一行', () => {
    const draft = exampleDraft('right-evaluation-report')
    draft.sections = draft.sections.map(section => section.id === 'searchField'
      ? { id: 'searchField', blocks: [{ kind: 'list', items: ['甲领域', '乙领域'], ordered: false }] }
      : section)
    const html = injectTemplateDraft(readTemplateHtml('right-evaluation-report'), 'right-evaluation-report', draft)
    expect(html).toContain('<div class="part-value"><span class="fill w-full">甲领域</span></div>')
    expect(html).toContain('<div class="part-value"><span class="fill w-full">乙领域</span></div>')
  })

  it('rows 槽按草案行数克隆并转义单元格', () => {
    const html = injectTemplateDraft(readTemplateHtml('search-report-form'), 'search-report-form', exampleDraft('search-report-form'))
    expect(html.match(/<tr><td><span class="fill w-sm">R[1-4]<\/span><\/td>/g)?.length).toBe(4)
    expect(html).toContain('输送带 &lt;AND&gt; 自动张紧')
  })

  it('注入完成后的成品不残留任何 data-slot', () => {
    for (const template of ['right-evaluation-report', 'search-report-form'] as const) {
      const html = injectTemplateDraft(readTemplateHtml(template), template, exampleDraft(template))
      expect(html).not.toContain('data-slot')
    }
  })

  it('示例草案渲染结果与 example.html 逐字节一致（示例即渲染基准）', () => {
    for (const template of ['right-evaluation-report', 'search-report-form'] as const) {
      const rendered = injectTemplateDraft(readTemplateHtml(template), template, exampleDraft(template))
      const onDisk = readFileSync(`packages/patent/patent-document/assets/templates/patent/${template}/example.html`, 'utf8')
      expect(rendered).toBe(onDisk)
    }
  })

  it('模板缺选项复选框时报错（注册表与资产不一致 fail-loud）', () => {
    const html = readTemplateHtml('right-evaluation-report').replace('data-slot="evalTarget:granted"', 'data-slot="broken"')
    expect(() => injectTemplateDraft(html, 'right-evaluation-report', exampleDraft('right-evaluation-report')))
      .toThrow(/模板缺少选项复选框 data-slot="evalTarget:granted"/)
  })

  it('表格块到达转换器时报错（校验器应先拒绝）', () => {
    const draft = exampleDraft('right-evaluation-report')
    draft.sections = [{ id: 'searchField', blocks: [{ kind: 'table', name: 't', header: ['h'], rows: [['c']] }] }]
    expect(() => injectTemplateDraft(readTemplateHtml('right-evaluation-report'), 'right-evaluation-report', draft))
      .toThrow(/表单模板不支持表格块/)
  })
})

describe('injectTemplateDraft 模板资产损坏路径（fail-loud 或安全跳过）', () => {
  it('缺失 blocks 章节槽位时报错', () => {
    const html = readTemplateHtml('right-evaluation-report').replace('data-slot="searchField"', 'data-slot="broken"')
    expect(() => injectTemplateDraft(html, 'right-evaluation-report', exampleDraft('right-evaluation-report')))
      .toThrow(/模板缺少章节槽位 data-slot="searchField"/)
  })

  it('blocks 槽位元素缺少 .fill 载体时报错', () => {
    const html = readTemplateHtml('right-evaluation-report').replace(
      '<div class="part-value" data-slot="searchField"><span class="fill w-full"></span></div>',
      '<div class="part-value" data-slot="searchField">无载体</div>',
    )
    expect(() => injectTemplateDraft(html, 'right-evaluation-report', exampleDraft('right-evaluation-report')))
      .toThrow(/槽位 searchField 的模板元素缺少 \.fill 文本载体/)
  })

  it('缺失 rows 槽位时报错', () => {
    const html = readTemplateHtml('search-report-form').replace('data-slot="searchRounds"', 'data-slot="broken"')
    expect(() => injectTemplateDraft(html, 'search-report-form', exampleDraft('search-report-form')))
      .toThrow(/模板缺少数据行槽位 data-slot="searchRounds"/)
  })

  it('rows 模板行没有 .fill 单元格时报错', () => {
    const html = readTemplateHtml('search-report-form').replace(
      /<tr data-slot="searchRounds">[\s\S]*?<\/tr>/,
      '<tr data-slot="searchRounds"><td>无单元格</td></tr>',
    )
    expect(() => injectTemplateDraft(html, 'search-report-form', exampleDraft('search-report-form')))
      .toThrow(/数据行槽位 searchRounds 的模板行缺少 \.fill 单元格/)
  })

  it('rows 列数与模板不一致时报错（绕过校验器的直接调用）', () => {
    const draft = exampleDraft('search-report-form')
    draft.sections = draft.sections.map(section =>
      section.id === 'searchRounds' ? { id: 'searchRounds', rows: [['只有一格']] } : section)
    expect(() => injectTemplateDraft(readTemplateHtml('search-report-form'), 'search-report-form', draft))
      .toThrow(/数据行槽位 searchRounds 列数 1 与模板列数 5 不一致/)
  })

  it('非 choice 槽位收到数组时报错（绕过校验器的直接调用）', () => {
    const draft = exampleDraft('search-report-form')
    draft.fields = { ...draft.fields, reportNo: ['A', 'B'] }
    expect(() => injectTemplateDraft(readTemplateHtml('search-report-form'), 'search-report-form', draft))
      .toThrow(/槽位 reportNo 不是多选 choice 槽位/)
  })

  it('槽位元素完全无闭合标签时安全跳过（模板损坏不抛、值不落位）', () => {
    const html = '<div><span class="fill" data-slot="reportNo">'
    const draft: TemplateDraft = { fields: { reportNo: 'X' }, sections: [] }
    // 成品剥离全部 data-slot；损坏槽位不被填充（值 X 不落位）。
    expect(injectTemplateDraft(html, 'search-report-form', draft)).toBe('<div><span class="fill">')
  })
})

describe('injectTemplateDraft 无 fields 草案', () => {
  it('只处理 sections（fields 缺省分支）', () => {
    const draft: TemplateDraft = {
      sections: [{ id: 'searchField', blocks: [{ kind: 'paragraph', text: '仅章节。' }] }],
    }
    const html = injectTemplateDraft(readTemplateHtml('right-evaluation-report'), 'right-evaluation-report', draft)
    expect(html).toContain('<span class="fill w-full">仅章节。</span>')
  })
})

describe('injectTemplateDraft 占位行移除的空白处理', () => {
  const blocksDraft = (texts: string[]): TemplateDraft => ({
    sections: [{ id: 'searchField', blocks: texts.map(text => ({ kind: 'paragraph', text })) }],
  })

  it('额外占位行前是制表符缩进时一并吞掉', () => {
    const html = '<div data-slot="searchField"><span class="fill w-full"></span></div>\n\t<div data-slot="searchField"><span class="fill w-full"></span></div>\n'
    const out = injectTemplateDraft(html, 'right-evaluation-report', blocksDraft(['甲', '乙']))
    expect(out).toBe('<div><span class="fill w-full">甲</span></div><div><span class="fill w-full">乙</span></div>\n\n')
  })

  it('额外占位元素不在行首时只移除元素本身', () => {
    const html = '<div data-slot="searchField"><span class="fill w-full"></span></div> 尾注 <div data-slot="searchField"><span class="fill w-full"></span></div>\n'
    const out = injectTemplateDraft(html, 'right-evaluation-report', blocksDraft(['甲', '乙']))
    expect(out).toBe('<div><span class="fill w-full">甲</span></div><div><span class="fill w-full">乙</span></div> 尾注 \n')
  })
})
