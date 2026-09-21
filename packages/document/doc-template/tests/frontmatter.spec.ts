// 上游来源：Mady 项目 `domains/doctmpl/loader_test.go`（`TestParseDocTemplate` 系列、
// `TestExtractFrontmatterRaw` 的边界）。上游对未知 format 是静默丢弃，本包改为报错，
// 故此处断言对应报错信息。

import { describe, expect, it } from 'vitest'
import { parseTemplate, splitFrontmatter } from '../src/frontmatter.ts'
import { DocTemplateError } from '../src/types.ts'

/** Build one template asset from a front-matter block and a body. */
function asset(frontmatter: string, body = '正文 {{a}}'): string {
  return `---\n${frontmatter}---\n${body}\n`
}

/** Parse one asset, expecting it to be rejected. */
function rejects(source: string): DocTemplateError {
  try {
    parseTemplate(source, 't.md')
  } catch (error) {
    if (error instanceof DocTemplateError) return error
    throw error
  }
  throw new Error('expected the asset to be rejected')
}

describe('splitFrontmatter', () => {
  it('splits a fenced asset into header and body', () => {
    expect(splitFrontmatter('---\nname: a\n---\nbody\n')).toEqual({ header: 'name: a', body: 'body\n' })
  })

  it('accepts a closing fence at the end of the file', () => {
    expect(splitFrontmatter('---\nname: a\n---')).toEqual({ header: 'name: a', body: '' })
  })

  it('keeps the whole text as the body when there is no fence', () => {
    expect(splitFrontmatter('name: a\n---\nbody\n')).toEqual({ header: '', body: 'name: a\n---\nbody\n' })
  })

  it('keeps the whole text as the body when the fence never closes', () => {
    expect(splitFrontmatter('---\nname: a\nbody\n')).toEqual({ header: '', body: '---\nname: a\nbody\n' })
  })
})

describe('parseTemplate', () => {
  it('parses every front-matter field', () => {
    const template = parseTemplate(
      asset([
        'name: search-report',
        'title: 专利检索报告',
        'category: patent-report',
        'description: 检索报告',
        'domain: patent',
        'version: "1.0.0"',
        'language: zh-CN',
        'style: patent-standard',
        'use_when: 需要检索时',
        'formats:',
        '  - markdown',
        '  - html',
        'vars:',
        '  - name: firm_name',
        '    type: string',
        '    required: true',
        '    description: 机构名称',
        '  - name: doc_no',
        '    type: number',
        '    required: false',
        '    default: "0"',
        '    description: 编号',
        'changelog:',
        '  - version: "1.0.0"',
        '    date: 2026-01-01',
        '    description: 初版',
        'shared_vars:',
        '  - firm_name',
        'extends:',
        '  - base',
        '',
      ].join('\n'), '  <p>{{firm_name}}</p>  '),
      '/tmp/search-report.md',
    )
    expect(template.name).toBe('search-report')
    expect(template.title).toBe('专利检索报告')
    expect(template.category).toBe('patent-report')
    expect(template.description).toBe('检索报告')
    expect(template.domain).toBe('patent')
    expect(template.version).toBe('1.0.0')
    expect(template.language).toBe('zh-CN')
    expect(template.styleName).toBe('patent-standard')
    expect(template.useWhen).toBe('需要检索时')
    expect(template.supportedFormats).toEqual(['markdown', 'html'])
    expect(template.varSchema.definitions).toEqual([
      { name: 'firm_name', type: 'string', required: true, description: '机构名称' },
      { name: 'doc_no', type: 'number', required: false, default: '0', description: '编号' },
    ])
    expect(template.changelog).toEqual([{ version: '1.0.0', date: '2026-01-01', description: '初版' }])
    expect(template.sharedVars).toEqual(['firm_name'])
    expect(template.extends).toEqual(['base'])
    expect(template.filePath).toBe('/tmp/search-report.md')
    expect(template.body).toBe('<p>{{firm_name}}</p>')
  })

  it('defaults every optional field of a minimal asset', () => {
    const template = parseTemplate(asset('name: minimal\n'), 'm.md')
    expect(template).toMatchObject({
      name: 'minimal',
      title: '',
      category: '',
      description: '',
      domain: '',
      version: '',
      language: '',
      styleName: '',
      useWhen: '',
      supportedFormats: ['markdown'],
      changelog: [],
      sharedVars: [],
      extends: [],
      filePath: 'm.md',
      body: '正文 {{a}}',
    })
    expect(template.varSchema.definitions).toEqual([])
  })

  it('normalizes CRLF newlines before parsing', () => {
    expect(parseTemplate('---\r\nname: a\r\n---\r\nbody\r\n', 'a.md').name).toBe('a')
  })

  it('rejects an asset without front-matter', () => {
    expect(rejects('name: a\n').message).toContain('缺少 YAML front-matter')
    expect(rejects('---\nname: a\n').message).toContain('缺少 YAML front-matter')
  })

  it('rejects a front-matter that is not a mapping', () => {
    expect(rejects('---\n- a\n---\nbody\n').message).toContain('front-matter 必须是 YAML 对象')
  })

  it('rejects a missing or blank name, and non-string text fields', () => {
    expect(rejects(asset('title: T\n')).message).toContain('name 必须是非空字符串')
    expect(rejects(asset('name: ""\n')).message).toContain('name 必须是非空字符串')
    expect(rejects(asset('name: a\ntitle: 3\n')).message).toContain('title 必须是字符串')
    expect(rejects(asset('name: a\ncategory: 3\n')).message).toContain('category 必须是字符串')
    expect(rejects(asset('name: a\ndescription: 3\n')).message).toContain('description 必须是字符串')
    expect(rejects(asset('name: a\ndomain: 3\n')).message).toContain('domain 必须是字符串')
    expect(rejects(asset('name: a\nversion: 3\n')).message).toContain('version 必须是字符串')
    expect(rejects(asset('name: a\nlanguage: 3\n')).message).toContain('language 必须是字符串')
    expect(rejects(asset('name: a\nstyle: 3\n')).message).toContain('style 必须是字符串')
    expect(rejects(asset('name: a\nuse_when: 3\n')).message).toContain('use_when 必须是字符串')
  })

  it('validates the declared formats', () => {
    expect(rejects(asset('name: a\nformats: markdown\n')).message).toContain('formats 必须是格式数组')
    expect(rejects(asset('name: a\nformats:\n  - pdf\n')).message).toContain('不支持输出格式 "pdf"')
    expect(parseTemplate(asset('name: a\nformats: []\n'), 'a.md').supportedFormats).toEqual(['markdown'])
    expect(parseTemplate(asset('name: a\nformats:\n  - docx\n'), 'a.md').supportedFormats).toEqual(['docx'])
  })

  it('validates the declared variables', () => {
    expect(rejects(asset('name: a\nvars: x\n')).message).toContain('vars 必须是变量数组')
    expect(rejects(asset('name: a\nvars:\n  - x\n')).message).toContain('vars[0] 必须是对象')
    expect(rejects(asset('name: a\nvars:\n  - type: string\n')).message).toContain('vars[0].name 必须是非空字符串')
    expect(rejects(asset('name: a\nvars:\n  - name: v\n    type: list\n')).message).toContain('vars[0].type 必须是')
    expect(rejects(asset('name: a\nvars:\n  - name: v\n    required: yes\n')).message).toContain('vars[0].required 必须是布尔值')
    expect(rejects(asset('name: a\nvars:\n  - name: v\n    default: 3\n')).message).toContain('vars[0].default 必须是字符串')
    expect(rejects(asset('name: a\nvars:\n  - name: v\n    description: 3\n')).message).toContain('vars[0].description 必须是字符串')
    const declared = parseTemplate(asset('name: a\nvars:\n  - name: v\n    default: ""\n'), 'a.md').varSchema.definitions[0]
    expect(declared).toEqual({ name: 'v', type: 'string', required: false, default: '', description: '' })
  })

  it('validates the change history', () => {
    expect(rejects(asset('name: a\nchangelog: x\n')).message).toContain('changelog 必须是数组')
    expect(rejects(asset('name: a\nchangelog:\n  - x\n')).message).toContain('changelog[0] 必须是对象')
    expect(rejects(asset('name: a\nchangelog:\n  - date: d\n    description: c\n')).message).toContain('changelog[0].version 必须是非空字符串')
    expect(rejects(asset('name: a\nchangelog:\n  - version: v\n    description: c\n')).message).toContain('changelog[0].date 必须是非空字符串')
    expect(rejects(asset('name: a\nchangelog:\n  - version: v\n    date: d\n')).message).toContain('changelog[0].description 必须是非空字符串')
  })

  it('validates the shared-variable and extension lists', () => {
    expect(rejects(asset('name: a\nshared_vars: x\n')).message).toContain('shared_vars 必须是字符串数组')
    expect(rejects(asset('name: a\nextends: x\n')).message).toContain('extends 必须是字符串数组')
    expect(rejects(asset('name: a\nshared_vars:\n  - ""\n')).message).toContain('shared_vars 必须是非空字符串')
    expect(parseTemplate(asset('name: a\nextends:\n  - base\n'), 'a.md').extends).toEqual(['base'])
  })
})
