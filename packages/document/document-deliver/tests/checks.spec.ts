/**
 * Deterministic document checks: residual placeholders and their fenced
 * exemption, same-document anchors, empty sections, style forbidden words, and
 * the declared character budget.
 */
import { describe, expect, it } from 'vitest'
import type { AntiPattern, DocumentStyle, StyleSections } from '@deepseek-ai/dsh-doc-style'
import { checkDocumentText, DOCUMENT_CHECK_IDS } from '../src/checks.ts'

/** A style whose sections default to empty, so a test declares only what it exercises. */
function style(antiPatterns: readonly AntiPattern[]): DocumentStyle {
  const sections: StyleSections = {
    tone: { formality: '', perspective: '', language: '' },
    voice: { principles: [] },
    antiPatterns,
    disclaimers: new Map(),
    citation: { style: '', format: '' },
    outputConventions: { confidenceLabel: false, weakVisual: false },
  }
  return { name: 'test-style', domain: 'test', version: '1', sections }
}

const FORBIDDEN = style([
  { word: '绝对', replace: '通常', severity: 'block' },
  { word: '完全', replace: '基本', severity: 'warn' },
])

describe('checkDocumentText', () => {
  it('reports nothing for a document that passes every check', () => {
    expect(checkDocumentText('# 报告\n\n正文内容。\n\n## 结论\n\n有内容。\n')).toEqual([])
  })

  it('exposes the check ids a caller can key on', () => {
    expect([...DOCUMENT_CHECK_IDS]).toEqual(['placeholder', 'broken_anchor', 'empty_section', 'anti_pattern', 'length_budget'])
  })

  it('blocks a residual placeholder outside a code fence and only warns inside one', () => {
    expect(checkDocumentText('# 报告\n\n正文。\n\n客户名称：{{client_name}}\n')).toEqual([
      { check: 'placeholder', level: 'block', detail: '第 5 行仍有残余占位符 "{{client_name}}"', line: 5 },
    ])

    expect(checkDocumentText('# 报告\n\n正文。\n\n```\n{{client_name}}\n```\n')).toEqual([
      { check: 'placeholder', level: 'warn', detail: '第 6 行仍有残余占位符 "{{client_name}}"', line: 6 },
    ])
  })

  it('recognizes every marker form and reports the fenced occurrences after the unfenced ones', () => {
    const findings = checkDocumentText([
      '# 报告', '', 'Lorem ipsum 待补充。', '', '```', '[TBD] [REPLACE]', '```', '',
    ].join('\n'))
    expect(findings.map(finding => finding.detail)).toEqual([
      '第 3 行仍有残余占位符 "Lorem ipsum"',
      '第 3 行仍有残余占位符 "待补充"',
      '第 6 行仍有残余占位符 "[TBD]"',
      '第 6 行仍有残余占位符 "[REPLACE]"',
    ])
    expect(findings.map(finding => finding.level)).toEqual(['block', 'block', 'warn', 'warn'])
  })

  it('matches the bracketed markers without case', () => {
    expect(checkDocumentText('[placeholder]\n\n[todo] [xxx]\n').map(finding => finding.detail)).toEqual([
      '第 1 行仍有残余占位符 "[placeholder]"',
      '第 3 行仍有残余占位符 "[todo]"',
      '第 3 行仍有残余占位符 "[xxx]"',
    ])
  })

  it('caps one check at five findings and reports how many were left out', () => {
    const findings = checkDocumentText(Array.from({ length: 7 }, () => '{{slot}}').join('\n\n'))
    expect(findings).toHaveLength(6)
    expect(findings[5]).toEqual({ check: 'placeholder', level: 'block', detail: '另有 2 处同类问题未逐条列出' })
  })

  it('warns about a fragment the document declares no anchor for', () => {
    expect(checkDocumentText('# 报告\n\n正文。\n\n见 [结论](#结论)。\n')).toEqual([
      { check: 'broken_anchor', level: 'warn', detail: '第 5 行链接到本文档未声明的锚点 "#结论"', line: 5 },
    ])
  })

  it('accepts heading slugs, explicit anchors, and GitHub collision suffixes', () => {
    expect(checkDocumentText('# 报告\n\n正文。\n\n## 结论\n\n有内容。\n\n见 [结论](#结论)。\n')).toEqual([])
    expect(checkDocumentText('# 报告\n\n正文。\n\n<h2 id="custom">小节</h2>\n\n有内容。\n\n见 [该节](#custom)。\n')).toEqual([])
    expect(checkDocumentText('# 重复\n\n一二。\n\n# 重复\n\n三四。\n\n见 [第二次](#重复-1)。\n')).toEqual([])
    expect(checkDocumentText('# 重复\n\n一二。\n\n# 重复\n\n三四。\n\n见 [第三次](#重复-2)。\n')).toEqual([
      { check: 'broken_anchor', level: 'warn', detail: '第 9 行链接到本文档未声明的锚点 "#重复-2"', line: 9 },
    ])
  })

  it('renders heading markup before slugging, as a renderer would', () => {
    expect(checkDocumentText('# 报告\n\n正文。\n\n## `web_fetch` 用法\n\n有内容。\n\n见 [用法](#web_fetch-用法)。\n')).toEqual([])
    expect(checkDocumentText('# 报告\n\n正文。\n\n## **重点**：结论\n\n有内容。\n\n见 [结论](#重点结论)。\n')).toEqual([])
  })

  it('checks HTML fragments and decodes percent escapes', () => {
    expect(checkDocumentText('<h1>报告</h1>\n<p>正文。</p>\n<a href="#%E7%BB%93%E8%AE%BA">结论</a>\n')).toEqual([
      { check: 'broken_anchor', level: 'warn', detail: '第 3 行链接到本文档未声明的锚点 "#结论"', line: 3 },
    ])
    expect(checkDocumentText('<h1>报告</h1>\n<p>正文。</p>\n<a href="#%zz">坏转义</a>\n')).toEqual([
      { check: 'broken_anchor', level: 'warn', detail: '第 3 行链接到本文档未声明的锚点 "#%zz"', line: 3 },
    ])
  })

  it('ignores an empty fragment, a repeated fragment, and a link inside a code fence', () => {
    expect(checkDocumentText('<h1>报告</h1>\n<p>正文。</p>\n<a href="#">空</a>\n<a href="#x">一</a>\n<a href="#x">二</a>\n')).toEqual([
      { check: 'broken_anchor', level: 'warn', detail: '第 4 行链接到本文档未声明的锚点 "#x"', line: 4 },
    ])
    expect(checkDocumentText('# 报告\n\n正文。\n\n```\n[x](#x)\n```\n')).toEqual([])
  })

  it('warns about a heading whose section holds nothing', () => {
    expect(checkDocumentText('# 报告\n\n正文。\n\n## 待办\n\n## 结论\n\n完成。\n')).toEqual([
      { check: 'empty_section', level: 'warn', detail: '第 5 行的标题 "待办" 下没有任何内容', line: 5 },
    ])
    expect(checkDocumentText('<h1>报告</h1>\n<p>正文。</p>\n<h2>空节</h2>\n<h2>结论</h2>\n<p>完成。</p>\n')).toEqual([
      { check: 'empty_section', level: 'warn', detail: '第 3 行的标题 "空节" 下没有任何内容', line: 3 },
    ])
  })

  it('treats a comment-only section as empty and a trailing heading as empty', () => {
    expect(checkDocumentText('# 报告\n\n正文。\n\n## 空节\n\n<!-- 待填 -->\n')).toEqual([
      { check: 'empty_section', level: 'warn', detail: '第 5 行的标题 "空节" 下没有任何内容', line: 5 },
    ])
  })

  it('does not treat a fenced hash line as a heading', () => {
    expect(checkDocumentText('# 报告\n\n正文。\n\n```sh\n# 注释\n```\n')).toEqual([])
  })

  it('ignores headings and explicit anchors inside a fence, because a fence registers nothing', () => {
    expect(checkDocumentText('# 报告\n\n正文。\n\n```html\n<h2>样例</h2>\n<h2 id="anchor">样例</h2>\n```\n')).toEqual([])
  })

  it('treats an unterminated fence as extending to the end of the document', () => {
    expect(checkDocumentText('# 报告\n\n正文。\n\n```\n{{slot}}\n')).toEqual([
      { check: 'placeholder', level: 'warn', detail: '第 6 行仍有残余占位符 "{{slot}}"', line: 6 },
    ])
  })

  it('carries the style severity of each forbidden word', () => {
    expect(checkDocumentText('# 报告\n\n正文。\n\n绝对可行，完全没问题。\n', { style: FORBIDDEN })).toEqual([
      { check: 'anti_pattern', level: 'block', detail: '第 5 行出现样式禁用词 "绝对"，建议改用 "通常"', line: 5 },
      { check: 'anti_pattern', level: 'warn', detail: '第 5 行出现样式禁用词 "完全"，建议改用 "基本"', line: 5 },
    ])
  })

  it('matches a forbidden word literally and without case', () => {
    const literalPattern = style([{ word: 'a+b', replace: 'a plus b', severity: 'warn' }])
    expect(checkDocumentText('aaab\n', { style: literalPattern })).toEqual([])
    expect(checkDocumentText('a+b\n', { style: literalPattern })).toEqual([
      { check: 'anti_pattern', level: 'warn', detail: '第 1 行出现样式禁用词 "a+b"，建议改用 "a plus b"', line: 1 },
    ])
    expect(checkDocumentText('todo\n', { style: style([{ word: 'TODO', replace: '待办', severity: 'block' }]) })).toEqual([
      { check: 'anti_pattern', level: 'block', detail: '第 1 行出现样式禁用词 "TODO"，建议改用 "待办"', line: 1 },
    ])
  })

  it('orders findings by line across the syntaxes and the anti-pattern list', () => {
    // The Markdown pass runs before the HTML one, so only the sort can put the
    // earlier line first.
    expect(checkDocumentText('<h1>报告</h1>\n<p>正文。</p>\n<a href="#c">c</a>\n[b](#b)\n')).toEqual([
      { check: 'broken_anchor', level: 'warn', detail: '第 3 行链接到本文档未声明的锚点 "#c"', line: 3 },
      { check: 'broken_anchor', level: 'warn', detail: '第 4 行链接到本文档未声明的锚点 "#b"', line: 4 },
    ])
    // The style lists "绝对" first, so only the sort can put line 1 first.
    expect(checkDocumentText('完全\n\n绝对\n', { style: FORBIDDEN }).map(finding => finding.line)).toEqual([1, 3])
  })

  it('reports a declared budget the document misses and stays silent inside the tolerance', () => {
    const text = `# 报告\n\n${'字'.repeat(100)}\n`
    expect(checkDocumentText(text, { charBudget: 100 })).toEqual([])
    expect(checkDocumentText(text, { charBudget: 300 })).toEqual([
      { check: 'length_budget', level: 'warn', detail: '全文 103 字，低于声明的 300 字预算（允许 240–360 字）' },
    ])
    expect(checkDocumentText(text, { charBudget: 80 })).toEqual([
      { check: 'length_budget', level: 'warn', detail: '全文 103 字，超出声明的 80 字预算（允许 64–96 字）' },
    ])
  })

  it('caps each check independently', () => {
    const text = `${Array.from({ length: 6 }, () => '{{slot}}').join('\n\n')}\n\n${Array.from({ length: 6 }, () => '## 空').join('\n\n')}\n`
    const findings = checkDocumentText(text)
    expect(findings.filter(finding => finding.check === 'placeholder')).toHaveLength(6)
    expect(findings.filter(finding => finding.check === 'empty_section')).toHaveLength(6)
    expect(findings.at(-1)?.detail).toBe('另有 1 处同类问题未逐条列出')
  })

  it('takes the summary line level from the dropped findings', () => {
    // 6 条 warn 禁用词之后还有一条 block 级禁用词：汇总行必须仍是 block，否则门禁被绕过。
    const words = style([
      ...Array.from({ length: 6 }, (_, i) => ({ word: `warn${String(i)}`, replace: 'x', severity: 'warn' as const })),
      { word: 'blocked', replace: 'y', severity: 'block' as const },
    ])
    const text = `${Array.from({ length: 6 }, (_, i) => `warn${String(i)}`).join(' ')} blocked\n`
    const findings = checkDocumentText(text, { style: words })
    expect(findings.filter(finding => finding.check === 'anti_pattern')).toHaveLength(6)
    expect(findings.at(-1)?.level).toBe('block')
    // 反向：被丢弃的都是只上报的草稿（围栏内占位符）时，汇总行不得升级为 block。
    const fenced = `${Array.from({ length: 6 }, (_, i) => `\`\`\`\n{{slot${String(i)}}}\n\`\`\``).join('\n')}\n`
    expect(checkDocumentText(fenced).filter(finding => finding.level === 'block')).toEqual([])
  })

  it('reports a placeholder quoted in inline code instead of blocking it', () => {
    // 复述检查规则的交付文档正文本身就带这些串，行内代码是它在谈论这些串的写法。
    const quoted = '- [ ] 无占位残留：无 `Lorem ipsum`、无 `[TBD]` / `{{变量}}` / 空槽\n'
    expect(checkDocumentText(quoted)).toEqual([
      { check: 'placeholder', level: 'warn', detail: '第 1 行仍有残余占位符 "{{变量}}"', line: 1 },
      { check: 'placeholder', level: 'warn', detail: '第 1 行仍有残余占位符 "[TBD]"', line: 1 },
      { check: 'placeholder', level: 'warn', detail: '第 1 行仍有残余占位符 "Lorem ipsum"', line: 1 },
    ])
    // 引号里提及仍按残余占位符处理：豁免只给代码跨度，不给"引号引用"。
    expect(checkDocumentText('- 无 "Lorem ipsum" 之类占位\n').filter(finding => finding.level === 'block')).toHaveLength(1)
    expect(checkDocumentText('- 客户名称：{{client_name}}\n').filter(finding => finding.level === 'block')).toHaveLength(1)
    expect(checkDocumentText('- 未填的 `` `{{x}}` `` 与 `{{y}}` 都要替换\n').filter(finding => finding.level === 'block')).toEqual([])
  })
})
