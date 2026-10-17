/**
 * 无效宣告三份文书的结构防线：请求人侧对外请求书（invalidation-opinion）、内部无效分析意见
 * （invalidation-analysis）与被请求人侧对外意见陈述书（invalidation-defense）必须是三套章节集合——
 * 对外件不得承载引用日志、结论分档与缺口披露，内部件必须承载它们，被请求人侧不写请求人侧的
 * 「不具备」节标题。示例与模板的小节集合一致性、以及对外件不出现内部标记，都由本文件断言，
 * 单侧改动（例如把引用日志加回对外件）在此失败。
 *
 * 证据清单的列口径同样在此断言：无效程序中的证据不限于专利文献，列名退回专利文献专用写法时，
 * 出版物与原始申请文件无处登记（口径源为 `invalidation-opinion/references/conventions.md` §4.1）。
 * 被请求人侧的期限、修改与举证依据另按 2023 年修订版的节号逐条断言。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const TEMPLATE_ROOT = join(import.meta.dirname, '../assets/templates/patent')

/** 读取一份模板或示例 HTML。 */
function read(template: string, file: string): string {
  return readFileSync(join(TEMPLATE_ROOT, template, file), 'utf8')
}

/** 抽取 `<h2>…</h2>` 的小节标题，保持文档顺序。 */
function sectionsOf(template: string, file: string): string[] {
  return [...read(template, file).matchAll(/<h2[^>]*>([^<]+)<\/h2>/g)].map(match => (match[1] ?? '').trim())
}

describe('invalidation-opinion（对外无效宣告请求书）', () => {
  const sections = sectionsOf('invalidation-opinion', 'assets/template.html')

  it('恰有六个 h2 小节，按中文序数一~六连续编号', () => {
    expect(sections).toHaveLength(6)
    expect(sections.map(section => section.slice(0, 1))).toEqual(['一', '二', '三', '四', '五', '六'])
    expect(sections[5]).toBe('六、结论与请求')
  })

  it('example 的小节集合与顺序与 template 一致', () => {
    expect(sectionsOf('invalidation-opinion', 'example.html')).toEqual(sections)
  })

  it('不承载内部工作记录：无引用日志节、无结论分档、无模型推断标记', () => {
    for (const file of ['assets/template.html', 'example.html']) {
      const html = read('invalidation-opinion', file)
      expect(html, file).not.toContain('引用日志')
      expect(html, file).not.toContain('class="badge badge-risk')
      expect(html, file).not.toContain('模型推断')
      expect(html, file).not.toContain('成功率')
      expect(html, file).not.toContain('缺口')
    }
  })

  it('无效理由节的节标题不由模板写死（由 grounds-body 槽位按结构生成）', () => {
    const html = read('invalidation-opinion', 'assets/template.html')
    expect(html).toContain('<div id="grounds-body"></div>')
    expect(html).not.toMatch(/<h3>\d+\.\d+ 权利要求/)
  })

  it('不把单一性列为无效理由（明示排除，且法条体系表不含该条）', () => {
    const conventions = read('invalidation-opinion', 'references/conventions.md')
    expect(conventions).toContain('不在无效理由之列')
    for (const line of conventions.split('\n')) {
      if (!line.startsWith('|')) continue
      expect(line, line).not.toMatch(/单一性|31\s*条/)
    }
    expect(read('invalidation-opinion', 'references/checklist.md')).toContain('未把单一性')
  })
})

describe('invalidation-analysis（内部无效分析意见）', () => {
  const sections = sectionsOf('invalidation-analysis', 'assets/template.html')

  it('七个中文序数小节加一个不带序数的收尾小结', () => {
    expect(sections).toHaveLength(8)
    expect(sections.slice(0, 7).map(section => section.slice(0, 1))).toEqual([
      '一', '二', '三', '四', '五', '六', '七',
    ])
    expect(sections[7]).toBe('分析结论')
  })

  it('example 的小节集合与顺序与 template 一致', () => {
    expect(sectionsOf('invalidation-analysis', 'example.html')).toEqual(sections)
  })

  it('承载内部工作记录：引用日志、结论分档与缺口披露', () => {
    const html = read('invalidation-analysis', 'assets/template.html')
    expect(html).toContain('六、引用日志')
    expect(html).toContain('成功率分档')
    expect(html).toContain('七、缺口与待补事项')
    expect(read('invalidation-analysis', 'references/citation-log.md')).toContain('四字段')
  })

  it('内部件不写对外请求句', () => {
    for (const file of ['assets/template.html', 'example.html']) {
      expect(read('invalidation-analysis', file), file).not.toContain('请求专利复审和无效审理部')
    }
  })
})

/** 无效宣告程序意见陈述书（被请求人侧；对外件） */
describe('invalidation-defense（无效宣告程序意见陈述书）', () => {
  const sections = sectionsOf('invalidation-defense', 'assets/template.html')

  it('八个中文序数小节，按一~八连续编号', () => {
    expect(sections).toHaveLength(8)
    expect(sections.map(section => section.slice(0, 1))).toEqual(['一', '二', '三', '四', '五', '六', '七', '八'])
    expect(sections[7]).toBe('八、结论与请求')
  })

  it('example 的小节集合与顺序与 template 一致', () => {
    expect(sectionsOf('invalidation-defense', 'example.html')).toEqual(sections)
  })

  it('程序性意见、质证意见与实体答辩分节', () => {
    expect(sections[1]).toBe('二、程序性意见')
    expect(sections[2]).toBe('三、关于请求人提交证据的意见')
    expect(sections[3]).toBe('四、权利要求书的修改')
    expect(sections[4]).toBe('五、逐项答辩')
  })

  it('不承载内部工作记录：无引用日志节、无结论分档、无模型推断标记', () => {
    for (const file of ['assets/template.html', 'example.html']) {
      const html = read('invalidation-defense', file)
      expect(html, file).not.toContain('引用日志')
      expect(html, file).not.toContain('class="badge badge-risk')
      expect(html, file).not.toContain('模型推断')
      expect(html, file).not.toContain('成功率')
      expect(html, file).not.toContain('缺口')
    }
  })

  it('逐项答辩的节标题由 grounds 槽位按模板体例生成（模板里不写死，也不套用请求人侧的关系词）', () => {
    const template = read('invalidation-defense', 'assets/template.html')
    expect(template).toContain('<div id="defense-body"></div>')
    expect(template).not.toMatch(/<h3>/)
    const example = read('invalidation-defense', 'example.html')
    expect(example).toMatch(/<h3>5\.1 权利要求 [\d、]+ 的\S+（专利法第\d+条第\d+款）<\/h3>/)
    expect(example).not.toMatch(/<h3>[^<]*不具备/)
    expect(example).toContain('<h4>事实认定</h4>')
    expect(example).not.toMatch(/<h3>5\.2 权利要求 1 至 3/)
  })

  it('每节按四段式给出（后两段合并为一个小标题），且口径源写明各段落点', () => {
    const conventions = read('invalidation-defense', 'references/conventions.md')
    expect(conventions).toContain('**事实认定** → **证据分析** → **法条适用** → **结论**')
    expect(conventions).toContain('合并为一个「法条适用与结论」小标题')
    expect(conventions).toContain('不得只作结论式陈述')
    expect(conventions).toContain('请求人在该理由下主张的事实与证据')
  })
})

describe('被请求人侧的期限、修改与举证依据', () => {
  const conventions = read('invalidation-defense', 'references/conventions.md')

  it('陈述意见的期限、不得延长与延期举证的区别都写明', () => {
    expect(conventions).toContain('专利法实施细则第 72 条')
    expect(conventions).toContain('专利法实施细则第 75 条')
    expect(conventions).toContain('审查指南第四部分第三章4.4.1')
    expect(conventions).toContain('延期举证不是一回事')
  })

  it('修改的依据精确到节，且写明未修改时表 1 只登记一行', () => {
    for (const section of [
      '审查指南第四部分第三章4.6.1',
      '审查指南第四部分第三章4.6.2',
      '审查指南第四部分第三章4.6.3',
    ]) {
      expect(conventions, section).toContain(section)
    }
    expect(conventions).toContain('专利法实施细则第 73 条')
    expect(conventions).toContain('本次答复未修改权利要求书')
  })

  it('专利权人举证期限与公知常识、互联网证据、外文证据的落点都写明', () => {
    for (const section of [
      '审查指南第四部分第三章4.3.2',
      '审查指南第四部分第三章4.3.3',
      '审查指南第四部分第八章2.2.1',
      '审查指南第四部分第八章4.3.3',
      '审查指南第四部分第八章5.1',
    ]) {
      expect(conventions, section).toContain(section)
    }
  })

  it('载体是 100902，附件一式两份', () => {
    expect(conventions).toContain('100902')
    expect(read('invalidation-defense', 'SKILL.md')).toContain('100902')
  })
})

describe('被请求人侧的反证编号口径', () => {
  it('只登记专利权人的证据，请求人证据不重新登记', () => {
    const conventions = read('invalidation-defense', 'references/conventions.md')
    expect(conventions).toContain('在本件不重新登记')
    expect(conventions).toContain('反证')
    for (const file of ['assets/template.html', 'example.html']) {
      expect(read('invalidation-defense', file), file).toMatch(/<td class="mono">反证\d<\/td>/)
      expect(read('invalidation-defense', file), file).not.toMatch(/<td class="mono">证据\d<\/td>/)
    }
  })
})

describe('证据清单的列口径（非专利证据）', () => {
  const TEMPLATES = ['invalidation-opinion', 'invalidation-analysis', 'invalidation-defense'] as const

  /** 抽取证据清单节的表头：从 `aria-label="证据清单"` 到该表的 `</thead>`。 */
  function evidenceHeader(template: string, file: string): string {
    const html = read(template, file)
    const start = html.indexOf('aria-label="证据清单"')
    expect(start, `${template}/${file} 缺证据清单节`).toBeGreaterThanOrEqual(0)
    return html.slice(start, html.indexOf('</thead>', start))
  }

  it('列名容纳非专利证据：标识列写 ISBN、日期列写出版日', () => {
    for (const template of TEMPLATES) {
      for (const file of ['assets/template.html', 'example.html']) {
        const header = evidenceHeader(template, file)
        expect(header, `${template}/${file}`).toContain('标识（公开号 / ISBN 等）')
        expect(header, `${template}/${file}`).toContain('证据名称')
        expect(header, `${template}/${file}`).toContain('公开 / 出版日')
        // 回归防线：列名退回专利文献专用写法时，出版物与原始申请文件没有可登记的列。
        expect(header, `${template}/${file}`).not.toContain('>公开号</th>')
        expect(header, `${template}/${file}`).not.toContain('>标题</th>')
      }
    }
  })

  it('内部件样例按该口径登记非专利证据：ISBN 与「—」落在标识列', () => {
    const html = read('invalidation-analysis', 'example.html')
    expect(html).toMatch(/<td class="mono">ISBN [\d-]+<\/td>/)
    expect(html).toMatch(/<td class="mono">—<\/td>/)
  })

  it('登记口径有单一口径源，内部件与两份清单都引用它', () => {
    const conventions = read('invalidation-opinion', 'references/conventions.md')
    expect(conventions).toContain('### 4.1 证据清单的登记口径（按证据类型）')
    expect(conventions).toContain('标识列不得留空')
    expect(read('invalidation-analysis', 'references/conventions.md')).toContain('conventions.md` §4.1')
    expect(read('invalidation-opinion', 'references/checklist.md')).toContain('§4.1')
    expect(read('invalidation-analysis', 'references/checklist.md')).toContain('§4.1')
  })
})

describe('证据编号的两侧对齐（口径与检查）', () => {
  it('编号形态与两侧核对写在口径源里，两份清单、两份技能都要求它', () => {
    // 渲染器的证据编号核对按编号列的形态取编号，形态本身由口径源规定，两处必须同时存在
    const conventions = read('invalidation-opinion', 'references/conventions.md')
    expect(conventions).toContain('编号列写 `D` 前缀加序号')
    expect(conventions).toContain('正文引用的编号必须已登记，登记的编号必须在正文引用一次')
    for (const template of ['invalidation-opinion', 'invalidation-analysis', 'invalidation-defense'] as const) {
      expect(read(template, 'references/checklist.md'), template).toContain('证据编号两侧对齐')
      expect(read(template, 'SKILL.md'), template).toContain('正文引用与清单登记共用同一编号')
    }
  })
})
