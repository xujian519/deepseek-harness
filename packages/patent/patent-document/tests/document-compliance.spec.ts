/**
 * 对外文书合规检查的行为测试：章节编号唯一有序、无内部工作章节、证据编号与清单相互覆盖。
 */
import { describe, expect, it } from 'vitest'
import { checkDocumentCompliance } from '../src/document/documentCompliance.ts'

describe('checkDocumentCompliance', () => {
  it('接受编号唯一且递增的骨架', () => {
    const html = '<h2>一、总体立场</h2><h2>二、权利要求分析</h2><h2>三、证据清单</h2>'
    expect(checkDocumentCompliance(html)).toEqual([])
  })

  it('忽略无中文编号的标题', () => {
    const html = '<h3>4.1 法条与判断标准</h3><h3>事实认定</h3><h4>（一）区别特征</h4>'
    expect(checkDocumentCompliance(html)).toEqual([])
  })

  it('报告重复的章节编号', () => {
    const html = '<h2>一、总体立场</h2><h2>一、涉案专利权利要求分析</h2>'
    const issues = checkDocumentCompliance(html)
    expect(issues).toHaveLength(1)
    expect(issues[0]?.rule).toBe('section-numbering')
    expect(issues[0]?.message).toContain('重复')
  })

  it('报告乱序的章节编号', () => {
    const html = '<h2>一、总体立场</h2><h2>三、证据清单</h2><h2>二、权利要求分析</h2>'
    const issues = checkDocumentCompliance(html)
    expect(issues).toHaveLength(1)
    expect(issues[0]?.message).toContain('乱序')
  })

  it('报告内部工作章节标题', () => {
    const html = '<h2>一、总体立场</h2><h2>十六、引用核验记录</h2><h2>十七、待办清单</h2>'
    const issues = checkDocumentCompliance(html)
    expect(issues.map(i => i.rule)).toEqual(['internal-section', 'internal-section'])
    expect(issues[0]?.message).toContain('核验记录')
    expect(issues[1]?.message).toContain('待办')
  })

  it('按中文数码正确比较编号，十以上不误判乱序', () => {
    const html = '<h2>九、理由</h2><h2>十、结论</h2><h2>十一、请求</h2><h2>二十、附记</h2><h2>二十一、尾注</h2>'
    expect(checkDocumentCompliance(html)).toEqual([])
  })

  it('跳过空标题与无法解析的数码写法', () => {
    const html = '<h2></h2><h2>  </h2><h2>二十三五、异常编号</h2>'
    expect(checkDocumentCompliance(html)).toEqual([])
  })

  it('跳过无「十」的多字数码', () => {
    const html = '<h2>一二、异常编号</h2><h2>二、正常编号</h2>'
    expect(checkDocumentCompliance(html)).toEqual([])
  })

  it('剥掉标题内的标签后判定', () => {
    const html = '<h2><span class="n">一、</span>总体立场</h2><h2>二、涉案专利权利要求分析</h2>'
    expect(checkDocumentCompliance(html)).toEqual([])
  })

  it('检出非章节层级的中文编号标题', () => {
    const html = '<h2>一、总体立场</h2><h4>一、法条与判断方法</h4>'
    const issues = checkDocumentCompliance(html)
    expect(issues).toHaveLength(1)
    expect(issues[0]?.message).toContain('章节级标题')
  })

  it('章节层级取文档中第一个中文编号标题的层级', () => {
    const html = '<h3>一、当事人及专利著录事项</h3><h2>一、总体立场</h2>'
    const issues = checkDocumentCompliance(html)
    expect(issues).toHaveLength(1)
    expect(issues[0]?.message).toContain('章节级标题')
  })
})

describe('checkDocumentCompliance · 正文内部记录', () => {
  it('检出正文中的内部评估与待办用语', () => {
    const html = '<h2>一、总体立场</h2><p>权利要求 1 的成功率约为 70%。</p><ul><li>待办：补充检索</li></ul>'
    const issues = checkDocumentCompliance(html)
    expect(issues.map(i => i.rule)).toEqual(['internal-body', 'internal-body'])
    expect(issues.map(i => i.message).join('\n')).toMatch(/成功概率分档/)
    expect(issues.map(i => i.message).join('\n')).toMatch(/待办/)
  })

  it('检出正文中的缺口汇总与内部文件路径', () => {
    const html = '<h2>一、总体立场</h2><p>缺口汇总：权利要求 3 无对应证据。</p><p>source_path: data/cases/x.json</p>'
    const issues = checkDocumentCompliance(html)
    expect(issues).toHaveLength(2)
    expect(issues[0]?.message).toContain('缺口汇总')
    expect(issues[1]?.message).toContain('内部文件路径')
  })

  it('不把同形词与不可见内容当成内部记录', () => {
    // 「口径」只在标题词表内；正文里的正常表述、样式表与注释都不算内部记录
    const html = '<style>.x{content:"待办"}</style><!-- 待办：核验 -->'
      + '<h2>一、总体立场</h2><p>权利要求解释口径以说明书为准。</p><p>本表数据来源为公证文书。</p>'
    expect(checkDocumentCompliance(html)).toEqual([])
  })

  it('注释与样式表里的标题既不参与编号也不构成内部记录', () => {
    // 模板里注释掉的标题不是可见章节：既不产生编号问题，也不构成内部记录泄漏
    const html = '<h2>一、总体立场</h2><!-- <h2>二、缺口汇总</h2> -->'
      + '<style>.x::before{content:"<h2>三、口径</h2>"}</style>'
    expect(checkDocumentCompliance(html)).toEqual([])
  })

  it('内部记录模板跳过内部工作记录检查，仍做章节编号与证据编号核对', () => {
    const html = '<h2>一、总体立场</h2><p>权利要求 1 的成功率约为 70%。</p>'
    expect(checkDocumentCompliance(html, 'internal-record')).toEqual([])
    const numbered = '<h2>一、总体立场</h2><h2>一、逐权项结论</h2>'
    expect(checkDocumentCompliance(numbered, 'internal-record')).toHaveLength(1)
    const unregistered = evidenceDoc([['D1', 'CN20151234567A']], '<p>D3 公开了加热单元。</p>')
    expect(checkDocumentCompliance(unregistered, 'internal-record').map(issue => issue.rule))
      .toEqual(['evidence-cross-reference', 'evidence-cross-reference'])
  })
})

/**
 * 造一份含证据清单表的文书：章节标题固定，清单表用随包模板的列序（首列为编号），正文片段由
 * 用例给出。`anchor` 决定清单表的标记方式——`aria-label`（随包样例）或注入锚点（部分模板）。
 * @param rows - 清单数据行的单元格。
 * @param body - 清单表之外的正文片段。
 * @param anchor - 清单表的定位标记。
 * @returns 文书 HTML。
 */
function evidenceDoc(
  rows: readonly (readonly string[])[],
  body: string,
  anchor: 'section' | 'tbody' = 'section',
): string {
  const cells = rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')
  const table = '<table><caption>表 2 · 证据与对比文件清单</caption>'
    + '<thead><tr><th>编号</th><th>标识</th></tr></thead>'
    + `<tbody${anchor === 'tbody' ? ' id="evidence-table"' : ''}>${cells}</tbody></table>`
  const section = anchor === 'section' ? `<section aria-label="证据清单">${table}</section>` : table
  return `<h2>一、总体立场</h2>${body}${section}`
}

describe('checkDocumentCompliance · 证据编号与清单相互覆盖', () => {
  it('放行引用与登记一致的文书，正文里的引用表算引用位置', () => {
    const html = evidenceDoc(
      [['D1', 'CN20151234567A'], ['D2', 'CN20159876543U']],
      '<table><tbody><tr><td>D1+D2 结合具备技术启示</td></tr></tbody></table>',
    )
    expect(checkDocumentCompliance(html)).toEqual([])
  })

  it('报告正文引用但清单未登记的编号', () => {
    const html = evidenceDoc([['D1', 'CN20151234567A']], '<p>D1 与 D3 的结合公开了全部特征。</p>')
    const issues = checkDocumentCompliance(html)
    expect(issues).toHaveLength(1)
    expect(issues[0]?.rule).toBe('evidence-cross-reference')
    expect(issues[0]?.message).toContain('「D3」未登记')
  })

  it('报告清单登记但正文未引用的编号', () => {
    const html = evidenceDoc([['D1', 'CN1'], ['D2', 'CN2']], '<p>D1 公开了全部特征。</p>')
    const issues = checkDocumentCompliance(html)
    expect(issues).toHaveLength(1)
    expect(issues[0]?.message).toContain('「D2」在正文中未被引用')
  })

  it('清单表内的编号不算引用位置', () => {
    const html = evidenceDoc([['D1', 'CN1'], ['D2', 'CN2']], '<p>本件不作理由主张。</p>')
    expect(checkDocumentCompliance(html).map(issue => issue.message))
      .toEqual([
        '证据清单登记的「D1」在正文中未被引用：删除该条，或在支撑的理由、结论表中引用它',
        '证据清单登记的「D2」在正文中未被引用：删除该条，或在支撑的理由、结论表中引用它',
      ])
  })

  it('报告编号列未填写的行', () => {
    const html = evidenceDoc([['', 'CN1'], ['________', 'CN2']], '<p>正文无引用。</p>')
    const issues = checkDocumentCompliance(html)
    expect(issues.map(issue => issue.message)).toEqual([
      '证据清单第 1 行未填编号：正文无法引用该条证据，登记编号后正文与清单共用同一写法',
      '证据清单第 2 行未填编号：正文无法引用该条证据，登记编号后正文与清单共用同一写法',
    ])
  })

  it('数据行没有编号单元格时按未填写报告', () => {
    const html = '<h2>一、总体立场</h2><section aria-label="证据清单"><table>'
      + '<tbody id="evidence-table"><tr></tr></tbody></table></section>'
    expect(checkDocumentCompliance(html).map(issue => issue.message))
      .toEqual(['证据清单第 1 行未填编号：正文无法引用该条证据，登记编号后正文与清单共用同一写法'])
  })

  it('区间写法按逐个编号展开', () => {
    const html = evidenceDoc([['D1', 'CN1'], ['D2', 'CN2'], ['D3', 'CN3']], '<p>D1–D3 的结合。</p>')
    expect(checkDocumentCompliance(html)).toEqual([])
  })

  it('区间跨度超限时按普通文字处理', () => {
    // 端点自身仍按编号计（D1、D11 已登记），跨度内的编号不展开，故 D2 仍报未引用
    const html = evidenceDoc(
      [['D1', 'CN1'], ['D2', 'CN2'], ['D11', 'CN11']],
      '<p>D1–D11 的检索范围。</p>',
    )
    expect(checkDocumentCompliance(html).map(issue => issue.message))
      .toEqual(['证据清单登记的「D2」在正文中未被引用：删除该条，或在支撑的理由、结论表中引用它'])
  })

  it('端序倒置的区间不展开', () => {
    const html = evidenceDoc([['D2', 'CN2'], ['D1', 'CN1']], '<p>D2 至 D1 的引用顺序。</p>')
    expect(checkDocumentCompliance(html)).toEqual([])
  })

  it('中文前缀的编号同样核对，前缀与序号间允许空白', () => {
    const html = evidenceDoc([['对比文件1', 'CN1']], '<p>对比文件 1 与对比文件 2 的结合。</p>')
    const issues = checkDocumentCompliance(html)
    expect(issues).toHaveLength(1)
    expect(issues[0]?.message).toContain('「对比文件2」未登记')
  })

  it('编号列写成纯数字或不可解析时不参与核对', () => {
    // 纯数字编号无法与正文里的序号区分，专利号写在编号列也无法定前缀——两者都只报未填的行
    expect(checkDocumentCompliance(evidenceDoc([['1', 'CN1'], ['2', 'CN2']], '<p>D9 公开。</p>'))).toEqual([])
    expect(checkDocumentCompliance(evidenceDoc([['—', 'CN1']], '<p>D9 公开。</p>'))).toEqual([])
  })

  it('单词尾部的同形前缀不算编号', () => {
    const html = evidenceDoc([['D1', 'CN1']], '<p>END2 型控制器与本件无关。</p>')
    const issues = checkDocumentCompliance(html)
    expect(issues.map(issue => issue.message))
      .toEqual(['证据清单登记的「D1」在正文中未被引用：删除该条，或在支撑的理由、结论表中引用它'])
  })

  it('样式表与注释里的编号不算引用', () => {
    const html = evidenceDoc(
      [['D1', 'CN1']],
      '<style>.x{content:"D2"}</style><!-- D3 --><p>D1 公开了全部特征。</p>',
    )
    expect(checkDocumentCompliance(html)).toEqual([])
  })

  it('清单表按注入锚点定位时同样核对', () => {
    const html = evidenceDoc([['D1', 'CN1'], ['D2', 'CN2']], '<p>D1 公开了全部特征。</p>', 'tbody')
    const issues = checkDocumentCompliance(html)
    expect(issues).toHaveLength(1)
    expect(issues[0]?.message).toContain('「D2」在正文中未被引用')
  })

  it('没有证据清单标记、清单节里没有表、清单表未闭合时都不报', () => {
    expect(checkDocumentCompliance('<h2>一、总体立场</h2><p>D9 公开。</p>')).toEqual([])
    expect(checkDocumentCompliance(
      '<h2>一、总体立场</h2><section aria-label="证据清单"><p>附件见清单。</p></section>',
    )).toEqual([])
    expect(checkDocumentCompliance(
      '<h2>一、总体立场</h2><section aria-label="证据清单"><table><thead><tr><th>编号</th></tr></thead></table></section>',
    )).toEqual([])
    expect(checkDocumentCompliance(
      '<h2>一、总体立场</h2><section aria-label="证据清单"><table><tbody><tr><td>D1</td></tr>',
    )).toEqual([])
    // 注入锚点没有外层表时按没有清单表处理，不报编号差异
    expect(checkDocumentCompliance(
      '<h2>一、总体立场</h2><p>D9 公开。</p><tbody id="evidence-table"><tr><td>D1</td></tr></tbody>',
    )).toEqual([])
  })
})
