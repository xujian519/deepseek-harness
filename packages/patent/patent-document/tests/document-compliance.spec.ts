/**
 * 对外文书合规检查的行为测试：章节编号唯一有序、无内部工作章节。
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
