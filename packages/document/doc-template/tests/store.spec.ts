// 上游来源：Mady 项目 `domains/doctmpl/store_test.go`：`TestTemplateStore_List`
// （类别/领域/语言/关键字过滤）、`TestTemplateStore_FindByName`、`TestTemplateStore_Render`
// （渲染 + 格式支持校验）、`TestTemplateStore_MergeVarContext`、`TestTemplateStore_ListConflicts`。
// 上游对缺失必填变量只在 `ValidatedResolve` 里给警告；本包的渲染路径把它升级为错误，
// 该差异由 `fails loud when a required variable is missing` 固定。

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadStyles, stylesDirectory, type DocumentStyle } from '@deepseek-ai/dsh-doc-style'
import { templatesDirectory } from '../src/asset-location.ts'
import { RendererRegistry } from '../src/renderer-registry.ts'
import { createTemplateStore, type TemplateStoreOptions } from '../src/store.ts'
import { DocTemplateError } from '../src/types.ts'

let roots: string[] = []

afterEach(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true })
  roots = []
})

/** Create an empty temporary directory tracked for teardown. */
async function tempDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-doc-template-store-'))
  roots.push(root)
  return root
}

/** Write one template asset, creating its directory. */
async function writeTemplate(root: string, relativePath: string, frontmatter: string, body = '# 标题\n\n{{a}}\n'): Promise<void> {
  const path = join(root, relativePath)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `---\n${frontmatter}---\n${body}`)
}

/** The packaged styles, loaded the way the plugin loads them. */
const PACKAGED_STYLES: readonly DocumentStyle[] = loadStyles([stylesDirectory()])

/** The variables that satisfy the required set of the packaged search-report template. */
const SEARCH_REPORT_VARIABLES = {
  firm_name: '某所',
  invention_title: '图像处理',
  search_type: '新颖性',
  search_strategy: 's',
  databases_covered: 'd',
  key_hits: 'k',
  analysis: 'a',
  conclusion: 'c',
}

/** Build a store over the packaged assets plus any overrides. */
function storeOf(overrides: Partial<TemplateStoreOptions> = {}) {
  return createTemplateStore({
    templateDirs: [templatesDirectory()],
    styles: PACKAGED_STYLES,
    defaultLanguage: 'zh-CN',
    includeDisclaimer: true,
    ...overrides,
  })
}

describe('TemplateStore construction', () => {
  it('loads the packaged templates and their declared language', () => {
    const store = storeOf()
    expect(store.count).toBe(17)
    expect(store.allTemplates).toHaveLength(17)
    expect(store.findByName('search-report')?.language).toBe('zh-CN')
    expect(store.languageOf(store.findByName('search-report')!)).toBe('zh-CN')
  })

  it('applies the configured default language to a template that declares none', async () => {
    const root = await tempDir()
    await writeTemplate(root, 'a.md', 'name: a\n')
    const store = createTemplateStore(storeOptions({ templateDirs: [root], defaultLanguage: 'en-US' }))
    expect(store.languageOf(store.findByName('a')!)).toBe('en-US')
  })

  it('requires at least one template root', () => {
    expect(() => storeOf({ templateDirs: [] })).toThrow(/未提供模板目录/)
  })

  it('fails loud when a root holds no template', async () => {
    const root = await tempDir()
    expect(() => storeOf({ templateDirs: [root] })).toThrow(/没有 .md 模板资产/)
  })

  it('lets a later root override a template of the same name', async () => {
    const root = await tempDir()
    await writeTemplate(root, 'search-report.md', 'name: search-report\nversion: "2.0.0"\n', '覆盖后的正文')
    const store = storeOf({ templateDirs: [templatesDirectory(), root] })
    expect(store.count).toBe(17)
    expect(store.findByName('search-report')?.version).toBe('2.0.0')
    expect(store.findByName('search-report')?.body).toBe('覆盖后的正文')
    expect(store.listConflicts()).toEqual([
      { templateName: 'search-report', packagedVersion: '1.0.0', overrideVersion: '2.0.0', severity: 'info' },
    ])
  })

  it('reports an override that compares older than the packaged version as a warning', async () => {
    const root = await tempDir()
    await writeTemplate(root, 'search-report.md', 'name: search-report\nversion: "0.9.0"\n')
    const store = storeOf({ templateDirs: [templatesDirectory(), root] })
    expect(store.listConflicts()).toEqual([
      { templateName: 'search-report', packagedVersion: '1.0.0', overrideVersion: '0.9.0', severity: 'warn' },
    ])
  })

  it('orders versions by segment, so a two-digit segment is newer rather than earlier', async () => {
    // A code-unit string comparison orders '10.0.0' before '1.0.0' and would
    // call this upgrade a downgrade.
    const root = await tempDir()
    await writeTemplate(root, 'search-report.md', 'name: search-report\nversion: "10.0.0"\n')
    const newer = storeOf({ templateDirs: [templatesDirectory(), root] })
    expect(newer.listConflicts()).toEqual([
      { templateName: 'search-report', packagedVersion: '1.0.0', overrideVersion: '10.0.0', severity: 'info' },
    ])
    // The same two segments in the downgrade direction: 1.0.0 overriding 10.0.0
    // is older by the same rule, not newer as a string comparison claims.
    const downgradedRoot = await tempDir()
    await writeTemplate(downgradedRoot, 'search-report.md', 'name: search-report\nversion: "1.0.0"\n')
    const newerRoot = await tempDir()
    await writeTemplate(newerRoot, 'search-report.md', 'name: search-report\nversion: "10.0.0"\n')
    const downgraded = storeOf({ templateDirs: [newerRoot, downgradedRoot] })
    expect(downgraded.listConflicts()).toEqual([
      { templateName: 'search-report', packagedVersion: '10.0.0', overrideVersion: '1.0.0', severity: 'warn' },
    ])
  })

  it('treats a missing version segment as zero, so a shorter override is not a downgrade', async () => {
    const root = await tempDir()
    await writeTemplate(root, 'search-report.md', 'name: search-report\nversion: "1.0"\n')
    expect(storeOf({ templateDirs: [templatesDirectory(), root] }).listConflicts()).toEqual([
      { templateName: 'search-report', packagedVersion: '1.0.0', overrideVersion: '1.0', severity: 'info' },
    ])
  })

  it('reports no conflict when every template keeps its first-loaded version', async () => {
    const root = await tempDir()
    await writeTemplate(root, 'search-report.md', 'name: search-report\nversion: "1.0.0"\n')
    expect(storeOf({ templateDirs: [templatesDirectory(), root] }).listConflicts()).toEqual([])
    expect(storeOf().listConflicts()).toEqual([])
  })
})

/** Store options over the packaged root, for the language cases. */
function storeOptions(overrides: Partial<TemplateStoreOptions>): TemplateStoreOptions {
  return {
    templateDirs: [templatesDirectory()],
    styles: PACKAGED_STYLES,
    defaultLanguage: 'zh-CN',
    includeDisclaimer: true,
    ...overrides,
  }
}

describe('TemplateStore listing and lookup', () => {
  const store = storeOf()

  it('filters by category, domain, and language', () => {
    expect(store.list({ category: 'claims' }).map(template => template.name)).toEqual([
      'apparatus-claim',
      'method-claim',
      'system-claim',
    ])
    expect(store.list({ category: 'legal' })).toEqual([])
    expect(store.list({ domain: 'legal' })).toEqual([])
    expect(store.list({ domain: 'patent' })).toHaveLength(17)
    expect(store.list({ language: 'zh-CN' })).toHaveLength(17)
    expect(store.list({ language: 'en-US' })).toEqual([])
  })

  it('searches the name, title, description, and use-when text', () => {
    expect(store.list({ query: 'SEARCH-REPORT' }).map(template => template.name)).toEqual(['search-report'])
    expect(store.list({ query: '检索报告' }).map(template => template.name)).toEqual(['search-report'])
    expect(store.list({ query: '装置' }).map(template => template.name)).toEqual(['apparatus-claim'])
    expect(store.list({ query: '不需要检索时' })).toEqual([])
    expect(store.list({ query: '  ' })).toHaveLength(17)
    expect(store.list()).toHaveLength(17)
  })

  it('searches the use-when text of a template that declares one', async () => {
    const root = await tempDir()
    await writeTemplate(root, 'x.md', 'name: x\nuse_when: 仅在答复审查意见时使用\n')
    const scoped = createTemplateStore(storeOptions({ templateDirs: [root] }))
    expect(scoped.list({ query: '答复审查意见' }).map(template => template.name)).toEqual(['x'])
  })

  it('finds a template by name and by name plus language', () => {
    expect(store.findByName('search-report')?.category).toBe('patent-report')
    expect(store.findByName('nope')).toBeUndefined()
    expect(store.findByNameAndLanguage('search-report', '')?.name).toBe('search-report')
    expect(store.findByNameAndLanguage('search-report', 'zh-CN')?.name).toBe('search-report')
    expect(store.findByNameAndLanguage('search-report', 'en-US')).toBeUndefined()
    expect(store.findByNameAndLanguage('nope', 'zh-CN')).toBeUndefined()
  })

  it('exposes its renderer registry', () => {
    expect(store.rendererRegistry.formats()).toEqual(['docx', 'html', 'markdown'])
  })
})

describe('TemplateStore.mergeVarContext', () => {
  const store = storeOf()

  it('merges the variable spaces, keeping the last definition of a shared variable', async () => {
    const root = await tempDir()
    await writeTemplate(root, 'a.md', [
      'name: a',
      'vars:',
      '  - name: shared',
      '    type: number',
      '    description: 来自 a',
      '  - name: only_a',
      '    description: 仅 a',
      'shared_vars:',
      '  - external',
      '',
    ].join('\n'))
    await writeTemplate(root, 'b.md', [
      'name: b',
      'vars:',
      '  - name: shared',
      '    type: string',
      '    description: 来自 b',
      '',
    ].join('\n'))
    const scoped = createTemplateStore(storeOptions({ templateDirs: [root] }))
    const context = scoped.mergeVarContext(['a', 'b'])
    expect(context.templates.map(template => template.name)).toEqual(['a', 'b'])
    expect(context.sharedVars).toEqual(['shared'])
    expect(context.allVars.map(definition => definition.description)).toEqual(['来自 b', '仅 a'])
    expect(context.allVars.map(definition => definition.name)).toEqual(['shared', 'only_a'])
  })

  it('counts a shared variable the template does not declare as its own', async () => {
    const root = await tempDir()
    await writeTemplate(root, 'a.md', 'name: a\nvars:\n  - name: x\n\nshared_vars:\n  - y\n')
    await writeTemplate(root, 'b.md', 'name: b\nvars:\n  - name: y\n')
    await writeTemplate(root, 'c.md', 'name: c\nvars:\n  - name: x\n\nshared_vars:\n  - x\n')
    const scoped = createTemplateStore(storeOptions({ templateDirs: [root] }))
    expect(scoped.mergeVarContext(['a', 'b']).sharedVars).toEqual(['y'])
    expect(scoped.mergeVarContext(['a']).sharedVars).toEqual([])
    expect(scoped.mergeVarContext(['a']).allVars.map(definition => definition.name)).toEqual(['x'])
    // A shared_vars entry the same template already declares is not counted twice.
    expect(scoped.mergeVarContext(['c']).sharedVars).toEqual([])
    expect(scoped.mergeVarContext(['a', 'c']).sharedVars).toEqual(['x'])
  })

  it('fails loud on an unknown template name', () => {
    expect(() => store.mergeVarContext(['nope'])).toThrow(DocTemplateError)
    expect(() => store.mergeVarContext(['nope'])).toThrow(/未找到模板 "nope"/)
  })
})

describe('TemplateStore.render', () => {
  it('renders a Markdown document with the template title and the style disclaimer', () => {
    const outcome = storeOf().render({ template: 'search-report', variables: SEARCH_REPORT_VARIABLES })
    expect(outcome.format).toBe('markdown')
    expect(outcome.fileName).toBe('search-report.md')
    expect(outcome.mimeType).toBe('text/markdown')
    expect(outcome.encoding).toBe('utf8')
    // The upstream renderer writes the disclaimer first and keeps the body's own heading.
    expect(outcome.content.startsWith('> ⚠️ 本分析由 AI 辅助生成，不构成正式法律意见。')).toBe(true)
    expect(outcome.content).toContain('\n\n---\n\n# 专利检索报告')
    expect(outcome.markdown).toContain('**机构：** 某所')
    // doc_no and case_no have no default, so they stay as residual placeholders.
    expect(outcome.residual).toEqual(['doc_no', 'case_no'])
    expect(outcome.warnings).toEqual([])
  })

  it('renders HTML with the escaped variables, the author metadata, and the patent stylesheet', () => {
    const outcome = storeOf().render({
      template: 'search-report',
      variables: { ...SEARCH_REPORT_VARIABLES, firm_name: '<b>某所</b>', invention_title: '图像处理 & 检索' },
      format: 'html',
      author: '代理人甲',
      date: '2026-01-01',
      filename: 'report',
    })
    expect(outcome.fileName).toBe('report.html')
    expect(outcome.markdown).toContain('&lt;b&gt;某所&lt;/b&gt;')
    expect(outcome.content).toContain('&lt;b&gt;某所&lt;/b&gt;')
    expect(outcome.content).toContain('图像处理 &amp; 检索')
    expect(outcome.content).toContain('<meta name="author" content="代理人甲">')
    expect(outcome.content).toContain('<html lang="zh-CN">')
    expect(outcome.content).toContain('@page { size: A4;')
  })

  it('renders a DOCX package and keeps the resolved Markdown beside it', () => {
    const outcome = storeOf().render({ template: 'method-claim', variables: {}, format: 'docx' })
    expect(outcome.fileName).toBe('method-claim.docx')
    expect(outcome.encoding).toBe('base64')
    expect(outcome.mimeType).toContain('wordprocessingml')
    expect(Buffer.from(outcome.content, 'base64').subarray(0, 2).toString()).toBe('PK')
    expect(outcome.markdown).toContain('# 权利要求书')
    expect(outcome.residual).toContain('method_name')
  })

  it('returns the injection-free body in markdown while content carries title and disclaimer', async () => {
    const packaged = storeOf().render({ template: 'search-report', variables: SEARCH_REPORT_VARIABLES })
    // The delivered text is the injected body: the style disclaimer precedes it.
    expect(packaged.markdown.startsWith('# 专利检索报告')).toBe(true)
    expect(packaged.content.endsWith(packaged.markdown)).toBe(true)
    expect(packaged.content.length).toBeGreaterThan(packaged.markdown.length)
    // An injected title reaches `content` only, so a file written from the body loses it.
    const root = await tempDir()
    await writeTemplate(root, 'a.md', 'name: a\n', '正文 {{a}}\n')
    const injected = createTemplateStore(storeOptions({ templateDirs: [root] }))
      .render({ template: 'a', variables: { a: 'x' }, title: '自定义标题' })
    expect(injected.content).toBe('# 自定义标题\n\n正文 x')
    expect(injected.markdown).toBe('正文 x')
  })

  it('omits the title heading when the template declares none', async () => {
    const root = await tempDir()
    await writeTemplate(root, 'a.md', 'name: a\n', '正文 {{a}}\n')
    const outcome = createTemplateStore(storeOptions({ templateDirs: [root] })).render({ template: 'a', variables: { a: 'x' } })
    expect(outcome.content).toBe('正文 x')
    expect(outcome.markdown).toBe('正文 x')
  })

  it('honours the title and file-name overrides', async () => {
    const root = await tempDir()
    await writeTemplate(root, 'a.md', 'name: a\nformats:\n  - markdown\n  - html\n', '正文 {{a}}\n')
    const store = createTemplateStore(storeOptions({ templateDirs: [root] }))
    expect(store.render({ template: 'a', variables: { a: 'x' }, title: '自定义标题' }).content).toBe('# 自定义标题\n\n正文 x')
    const html = store.render({ template: 'a', variables: { a: 'x' }, format: 'html', filename: 'custom', title: '自定义标题' })
    expect(html.fileName).toBe('custom.html')
    expect(html.content).toContain('<h1>自定义标题</h1>')
  })

  it('keeps the body title of a template that writes its own level-1 heading', () => {
    const outcome = storeOf().render({ template: 'method-claim', variables: {}, title: '自定义标题' })
    expect(outcome.content.startsWith('# 权利要求书')).toBe(true)
    expect(outcome.content).not.toContain('自定义标题')
  })

  it('injects the style disclaimer unless the deployment disables it', async () => {
    const root = await tempDir()
    await writeTemplate(root, 'a.md', 'name: a\nstyle: patent-standard\n', '正文\n')
    const enabled = createTemplateStore(storeOptions({ templateDirs: [root] }))
    expect(enabled.render({ template: 'a', variables: {} }).content).toContain('> ⚠️ 本分析由 AI 辅助生成')
    const disabled = createTemplateStore(storeOptions({ templateDirs: [root], includeDisclaimer: false }))
    const outcome = disabled.render({ template: 'a', variables: {} })
    expect(outcome.content).not.toContain('⚠️')
    expect(outcome.content).toBe('正文')
  })

  it('renders a template that declares no style without a disclaimer', async () => {
    const root = await tempDir()
    await writeTemplate(root, 'a.md', 'name: a\nformats:\n  - html\n', '正文\n')
    const outcome = createTemplateStore(storeOptions({ templateDirs: [root] })).render({ template: 'a', variables: {}, format: 'html' })
    expect(outcome.content).not.toContain('⚠️')
    expect(outcome.content).toContain('font-family:-apple-system')
  })

  it('fails loud on an unknown template', () => {
    expect(() => storeOf().render({ template: 'nope', variables: {} })).toThrow(/未找到模板 "nope"/)
  })

  it('fails loud on an unsupported format', () => {
    expect(() => storeOf().render({ template: 'search-report', variables: { firm_name: 'x' }, format: 'docx' }))
      .toThrow(/不支持 docx 格式（支持 markdown\/html）/)
  })

  it('fails loud on a missing required variable', () => {
    expect(() => storeOf().render({ template: 'search-report', variables: {} }))
      .toThrow(/缺少必填变量：firm_name、invention_title/)
  })

  it('fails loud when the template declares a style that is not loaded', async () => {
    const root = await tempDir()
    await writeTemplate(root, 'a.md', 'name: a\nstyle: no-such-style\n', '正文\n')
    expect(() => createTemplateStore(storeOptions({ templateDirs: [root] })).render({ template: 'a', variables: {} }))
      .toThrow(/声明的样式 "no-such-style" 未加载/)
  })

  it('fails loud when the format has no renderer', () => {
    const store = storeOf({ renderers: new RendererRegistry() })
    expect(() => store.render({ template: 'search-report', variables: SEARCH_REPORT_VARIABLES }))
      .toThrow(/没有注册 markdown 格式的渲染器/)
  })

  it('renders through a renderer registered by a consumer', () => {
    const registry = new RendererRegistry()
    registry.register({ format: 'markdown', render: () => '自定义渲染' })
    const store = storeOf({ renderers: registry, includeDisclaimer: false })
    expect(store.render({ template: 'search-report', variables: SEARCH_REPORT_VARIABLES }).content).toBe('自定义渲染')
  })
})
