import { describe, expect, it } from 'vitest'
import type { SpecDraft } from '@deepseek-ai/dsh-patent-core'
import { renderSpecDraftSections } from '@deepseek-ai/dsh-patent-document'
import { contentFromDraft } from '@deepseek-ai/dsh-patent-filing'

/** 最小可转换 claims-spec 草案（与 patent-document 用例同形）。 */
function specDraft(overrides: Partial<SpecDraft> = {}): SpecDraft {
  return {
    meta: {
      title: '一种智能保温杯',
      applicant: '示例科技有限公司',
      inventor: '张三',
      agent: 'XX 知识产权代理事务所',
      date: '2026-10-09',
    },
    claims: [
      '一种智能保温杯，其特征在于，包括杯体、温度显示模块和加热单元。',
      '如权利要求 1 所述的智能保温杯，其特征在于，还包括控制模块。',
    ],
    abstract: ['本发明公开一种智能保温杯，主要用途是恒温饮水。'],
    figureFiles: ['fig1.svg', 'fig2.png'],
    drawingDescriptions: ['智能保温杯的整体结构示意图', '加热控制逻辑的模块框图'],
    sections: {
      technicalField: [{ kind: 'paragraph', text: '本发明属于日用品技术领域。' }],
      background: [{ kind: 'paragraph', text: '现有保温杯无法显示水温。' }],
      summary: [
        { kind: 'paragraph', text: '本发明提供一种智能保温杯。' },
        { kind: 'list', items: ['可以显示水温；', '可以低温加热。'], ordered: true },
      ],
      drawingDescriptions: [{ kind: 'list', items: ['智能保温杯的整体结构示意图', '加热控制逻辑的模块框图'] }],
      embodiment: [
        { kind: 'paragraph', text: '下面结合附图对本发明作进一步说明。' },
        {
          kind: 'table',
          name: '附图标记说明',
          header: ['标记', '名称'],
          rows: [['1', '杯体'], ['2', '杯盖']],
        },
      ],
    },
    ...overrides,
  }
}

describe('contentFromDraft', () => {
  it('摘要与附图路径按原样传递', () => {
    const content = contentFromDraft(specDraft())
    expect(content.abstract).toEqual(['本发明公开一种智能保温杯，主要用途是恒温饮水。'])
    expect(content.figures).toEqual(['fig1.svg', 'fig2.png'])
  })

  it('权项自动连续编号（「1. 」前缀），模型不带项号', () => {
    const content = contentFromDraft(specDraft())
    expect(content.claims).toEqual([
      '1. 一种智能保温杯，其特征在于，包括杯体、温度显示模块和加热单元。',
      '2. 如权利要求 1 所述的智能保温杯，其特征在于，还包括控制模块。',
    ])
  })

  it('说明书按五部分生成 h3 节点与正文节点', () => {
    const content = contentFromDraft(specDraft())
    const spec = content.specification
    expect(spec[0]).toEqual({ kind: 'h3', text: '技术领域' })
    expect(spec[1]).toEqual({ kind: 'p', text: '本发明属于日用品技术领域。' })
    const headings = spec.filter(node => node.kind === 'h3').map(node => node.text)
    expect(headings).toEqual(['技术领域', '背景技术', '发明内容', '附图说明', '具体实施方式'])
  })

  it('普通部分的列表块每项成一个正文段（docx 通道无列表节点）', () => {
    const content = contentFromDraft(specDraft())
    const summary = content.specification.filter(node => node.kind === 'p').map(node => node.text)
    expect(summary).toContain('可以显示水温；')
    expect(summary).toContain('可以低温加热。')
  })

  it('附图说明列表项生成「图N为……；/。」正文段', () => {
    const content = contentFromDraft(specDraft())
    const texts = content.specification.map(node => node.text ?? '')
    expect(texts).toContain('图1为智能保温杯的整体结构示意图；')
    expect(texts).toContain('图2为加热控制逻辑的模块框图。')
  })

  it('附图说明的图号跨列表块连续编号', () => {
    const draft = specDraft()
    draft.sections.drawingDescriptions = [
      { kind: 'list', items: ['整体结构示意图'] },
      { kind: 'list', items: ['模块框图', '剖视示意图'] },
    ]
    const texts = contentFromDraft(draft).specification.map(node => node.text ?? '')
    expect(texts).toContain('图1为整体结构示意图；')
    expect(texts).toContain('图2为模块框图；')
    expect(texts).toContain('图3为剖视示意图。')
  })

  it('表格生成「表 N · 名称」表题段与 header+rows 节点', () => {
    const content = contentFromDraft(specDraft())
    const captionIndex = content.specification.findIndex(node => node.text === '表 1 · 附图标记说明')
    expect(captionIndex).toBeGreaterThanOrEqual(0)
    expect(content.specification[captionIndex + 1]).toEqual({
      kind: 'table',
      rows: [['标记', '名称'], ['1', '杯体'], ['2', '杯盖']],
    })
  })

  it('附图说明中的段落块按普通段落渲染', () => {
    const draft = specDraft()
    draft.sections.drawingDescriptions = [
      { kind: 'paragraph', text: '本申请共两幅附图。' },
      { kind: 'list', items: ['整体结构示意图'] },
    ]
    const texts = contentFromDraft(draft).specification.map(node => node.text ?? '')
    expect(texts).toContain('本申请共两幅附图。')
    expect(texts).toContain('图1为整体结构示意图。')
  })

  it('附图说明中的表格也走表题+节点路径（防绕过校验的直接调用方）', () => {
    const draft = specDraft()
    draft.sections.drawingDescriptions = [
      { kind: 'table', name: '附图清单', header: ['图号'], rows: [['图1']] },
    ]
    const content = contentFromDraft(draft)
    const texts = content.specification.map(node => node.text ?? '')
    expect(texts).toContain('表 1 · 附图清单')
  })

  it('表题编号跨表格连续', () => {
    const draft = specDraft()
    draft.sections.embodiment = [
      { kind: 'table', name: '参数表', header: ['k'], rows: [['v']] },
      { kind: 'table', name: '部件表', header: ['k'], rows: [['x']] },
    ]
    const texts = contentFromDraft(draft).specification.map(node => node.text ?? '')
    expect(texts).toContain('表 1 · 参数表')
    expect(texts).toContain('表 2 · 部件表')
  })
})

describe('HTML 与 docx 通道一致性', () => {
  it('同一草案的权项编号、表题与附图说明在两通道一致', () => {
    const draft = specDraft()
    const html = renderSpecDraftSections(draft)
    const docx = contentFromDraft(draft)

    // 权项编号：HTML claim-num 序号与 docx 项号前缀一致。
    const htmlClaimNumbers = [...html.claims.matchAll(/<span class="claim-num">(\d+)\.<\/span>/g)].map(m => m[1])
    const docxClaimNumbers = docx.claims.map(claim => claim.slice(0, claim.indexOf('. ')))
    expect(htmlClaimNumbers).toEqual(['1', '2'])
    expect(docxClaimNumbers).toEqual(htmlClaimNumbers)
    for (const [index, claim] of docx.claims.entries()) {
      expect(claim.slice(claim.indexOf('. ') + 2)).toBe(draft.claims[index])
    }

    // 表题：HTML caption 文本与 docx 表题段一致且同序。
    const htmlCaptions = [...html.specification.matchAll(/<caption>(表 \d+ · [^<]+)<\/caption>/g)].map(m => m[1])
    const docxCaptions = docx.specification.filter(node => node.kind === 'p' && /^表 \d+ · /.test(node.text ?? '')).map(node => node.text)
    expect(htmlCaptions).toEqual(['表 1 · 附图标记说明'])
    expect(docxCaptions).toEqual(htmlCaptions)

    // 附图说明：HTML li 文本与 docx 正文段一致。
    const htmlFigures = [...html.specification.matchAll(/<li>(图\d+为[^<]+)<\/li>/g)].map(m => m[1])
    const docxFigures = docx.specification
      .filter(node => node.kind === 'p' && /^(图\d+为)/.test(node.text ?? ''))
      .map(node => node.text ?? '')
    expect(htmlFigures).toEqual(['图1为智能保温杯的整体结构示意图；', '图2为加热控制逻辑的模块框图。'])
    expect(docxFigures).toEqual(htmlFigures)
  })
})
