import { describe, expect, it } from 'vitest'
import { parseFilename, parseLawMarkdown } from '../parse-law-md.ts'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Standard single-file law (行政处罚法). */
const STANDARD_LAW = `# 中华人民共和国行政处罚法

1996年3月17日 第八届全国人民代表大会第四次会议通过

2009年8月27日 第十一届全国人民代表大会常务委员会第十次会议《关于修改部分法律的决定》第一次修正

2017年9月1日 第十二届全国人民代表大会常务委员会第二十九次会议《关于修改〈中华人民共和国法官法〉等八部法律的决定》第二次修正

2021年1月22日 第十三届全国人民代表大会常务委员会第二十五次会议修订

<!-- INFO END -->

## 第一章 总则

第一条 为了规范行政处罚的设定和实施，保障和监督行政机关有效实施行政管理，维护公共利益和社会秩序，保护公民、法人或者其他组织的合法权益，根据宪法，制定本法。

第二条 行政处罚是指行政机关依法对违反行政管理秩序的公民、法人或者其他组织，以减损权益或者增加义务的方式予以惩戒的行为。

第三条 行政处罚的设定和实施，适用本法。

## 第二章 行政处罚的种类和设定

第四条 公民、法人或者其他组织违反行政管理秩序的行为，应当给予行政处罚的，依照本法由法律、法规、规章规定，并由行政机关依照本法规定的程序实施。

第五条 行政处罚遵循公正、公开的原则。
`

/** 民法典 split-file format (总则编). */
const CIVIL_CODE_SPLIT = `# 中华人民共和国民法典

# 总则

2020年5月28日 第十三届全国人民代表大会第三次会议通过

2021年1月1日 施行

<!-- INFO END -->

## 第一章 基本规定

第一条 为了保护民事主体的合法权益，调整民事关系，维护社会和经济秩序，适应中国特色社会主义发展要求，弘扬社会主义核心价值观，根据宪法，制定本法。

第二条 民法调整平等主体的自然人、法人和非法人组织之间的人身关系和财产关系。

第三条 民事主体的人身权利、财产权利以及其他合法权益受法律保护，任何组织或者个人不得侵犯。

## 第二章 自然人

### 第一节 民事权利能力和民事行为能力

第十三条 自然人从出生时起到死亡时止，具有民事权利能力，依法享有民事权利，承担民事义务。

第十四条 自然人的民事权利能力一律平等。
`

/** Law with no amendments (宪法). */
const CONSTITUTION = `# 中华人民共和国宪法

1982年12月4日 第五届全国人民代表大会第五次会议通过

1982年12月4日 全国人民代表大会公告公布施行

<!-- INFO END -->

## 序言

中国是世界上历史最悠久的国家之一。

## 第一章 总纲

第一条 中华人民共和国是工人阶级领导的、以工农联盟为基础的人民民主专政的社会主义国家。

社会主义制度是中华人民共和国的根本制度。中国共产党领导是中国特色社会主义最本质的特征。禁止任何组织或者个人破坏社会主义制度。

第二条 一切权力属于人民。
`

/** Law with no INFO END sentinel. */
const NO_SENTINEL = `# 测试法律

## 第一章 总则

第一条 测试条文。
`

// ---------------------------------------------------------------------------
// Tests: parseLawMarkdown — standard format
// ---------------------------------------------------------------------------

describe('parseLawMarkdown — standard format', () => {
  const parsed = parseLawMarkdown(STANDARD_LAW, '行政处罚法(2021-01-22).md')

  it('extracts the full law name from the # heading', () => {
    expect(parsed.name).toBe('中华人民共和国行政处罚法')
  })

  it('derives a short name by stripping the 中华人民共和国 prefix', () => {
    expect(parsed.shortName).toBe('行政处罚法')
  })

  it('normalizes corpus markers and wrapped spaces out of the short name', () => {
    const marked = parseLawMarkdown(
      '# 中华人民共和国台州市提高技术工人待遇扩大中等收入群体+若干规定\n\n<!-- INFO END -->\n\n## 第一章 总则\n\n第一条 为了促进技术工人增收。\n',
      '台州市提高技术工人待遇扩大中等收入群体-若干规定.md',
    )
    expect(marked.shortName).toBe('台州市提高技术工人待遇扩大中等收入群体若干规定')

    const wrapped = parseLawMarkdown(
      '# 中华人民共和国长春市农作物秸秆禁烧和综合          利用管理条例\n\n<!-- INFO END -->\n\n## 第一章 总则\n\n第一条 为了规范秸秆利用。\n',
      '长春市农作物秸秆禁烧和综合-利用管理条例.md',
    )
    expect(wrapped.shortName).toBe('长春市农作物秸秆禁烧和综合利用管理条例')
  })

  it('extracts the adoption date', () => {
    expect(parsed.adoptDate).toBe('1996-03-17')
  })

  it('extracts amendment history', () => {
    expect(parsed.amendments).toHaveLength(3)
    expect(parsed.amendments[0]!.date).toBe('2009-08-27')
    expect(parsed.amendments[0]!.description).toContain('第一次修正')
    expect(parsed.amendments[2]!.date).toBe('2021-01-22')
    expect(parsed.amendments[2]!.description).toContain('修订')
  })

  it('parses chapters', () => {
    expect(parsed.chapters).toHaveLength(2)
    expect(parsed.chapters[0]!.number).toBe(1)
    expect(parsed.chapters[0]!.title).toBe('总则')
    expect(parsed.chapters[0]!.articles).toEqual([1, 2, 3])
    expect(parsed.chapters[1]!.number).toBe(2)
    expect(parsed.chapters[1]!.title).toBe('行政处罚的种类和设定')
    expect(parsed.chapters[1]!.articles).toEqual([4, 5])
  })

  it('parses articles with correct numbers and text', () => {
    expect(parsed.articles).toHaveLength(5)
    expect(parsed.articles[0]!.number).toBe(1)
    expect(parsed.articles[0]!.text).toContain('规范行政处罚的设定和实施')
    expect(parsed.articles[4]!.number).toBe(5)
    expect(parsed.articles[4]!.text).toContain('公正、公开')
  })

  it('assigns chapter numbers to articles', () => {
    expect(parsed.articles[0]!.chapter).toBe(1)
    expect(parsed.articles[3]!.chapter).toBe(2)
  })

  it('records the source file path', () => {
    expect(parsed.sourceFile).toBe('行政处罚法(2021-01-22).md')
  })
})

// ---------------------------------------------------------------------------
// Tests: parseLawMarkdown — 民法典 split-file format
// ---------------------------------------------------------------------------

describe('parseLawMarkdown — 民法典 split format', () => {
  const parsed = parseLawMarkdown(CIVIL_CODE_SPLIT, '总则.md')

  it('extracts the main law name from the first # heading', () => {
    expect(parsed.name).toBe('中华人民共和国民法典')
  })

  it('extracts the subtitle from the second # heading', () => {
    expect(parsed.subtitle).toBe('总则')
  })

  it('extracts the effective date (施行)', () => {
    expect(parsed.effectiveDate).toBe('2021-01-01')
  })

  it('parses articles across chapters with section headings', () => {
    expect(parsed.articles).toHaveLength(5)
    // Articles 1-3 in chapter 1, articles 13-14 in chapter 2
    expect(parsed.articles[0]!.number).toBe(1)
    expect(parsed.articles[3]!.number).toBe(13)
    expect(parsed.articles[4]!.number).toBe(14)
  })

  it('tracks chapter membership across sections', () => {
    expect(parsed.chapters).toHaveLength(2)
    expect(parsed.chapters[1]!.articles).toEqual([13, 14])
  })
})

// ---------------------------------------------------------------------------
// Tests: parseLawMarkdown — constitution (序言 + no amendments)
// ---------------------------------------------------------------------------

describe('parseLawMarkdown — constitution format', () => {
  const parsed = parseLawMarkdown(CONSTITUTION, '宪法.md')

  it('parses the adoption date', () => {
    expect(parsed.adoptDate).toBe('1982-12-04')
  })

  it('has no amendments in the metadata block', () => {
    // The constitution metadata only has 通过 and 施行, no 修正
    expect(parsed.amendments).toHaveLength(0)
  })

  it('parses articles after a 序言 section (non-article text)', () => {
    // 序言 has no articles; articles start in 第一章
    const articleNumbers = parsed.articles.map(a => a.number)
    expect(articleNumbers).toEqual([1, 2])
  })
})

// ---------------------------------------------------------------------------
// Tests: parseLawMarkdown — edge cases
// ---------------------------------------------------------------------------

describe('parseLawMarkdown — edge cases', () => {
  it('handles a file with no INFO END sentinel', () => {
    const parsed = parseLawMarkdown(NO_SENTINEL, '测试.md')
    expect(parsed.name).toBe('测试法律')
    expect(parsed.articles).toHaveLength(1)
    expect(parsed.articles[0]!.number).toBe(1)
  })

  it('falls back to file-name date when metadata has no adoption date', () => {
    const content = `# 测试法

<!-- INFO END -->

## 第一章 总则

第一条 测试。
`
    const parsed = parseLawMarkdown(content, '测试法(2023-06-15).md')
    expect(parsed.adoptDate).toBe('2023-06-15')
  })

  it('handles multi-paragraph articles (continuation lines)', () => {
    const content = `# 测试法

2020年1月1日 通过

<!-- INFO END -->

## 第一章 总则

第一条 第一款内容。

第二款内容。

第二条 另一条。
`
    const parsed = parseLawMarkdown(content, '测试.md')
    expect(parsed.articles[0]!.text).toContain('第一款内容')
    expect(parsed.articles[0]!.text).toContain('第二款内容')
    expect(parsed.articles).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// Tests: parseFilename
// ---------------------------------------------------------------------------

describe('parseFilename', () => {
  it('extracts name and date from a dated file name', () => {
    const result = parseFilename('/path/to/公司法(2023-12-29).md')
    expect(result.stem).toBe('公司法')
    expect(result.date).toBe('2023-12-29')
  })

  it('handles a file name without a date', () => {
    const result = parseFilename('/path/to/宪法.md')
    expect(result.stem).toBe('宪法')
    expect(result.date).toBe('')
  })
})
