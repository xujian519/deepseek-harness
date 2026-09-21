import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as Pkg from '../src/index.ts'
import { WRITING_PATTERNS_SECTION_NAME } from '../src/prompt.ts'
import type { QueryWritingPatternsOutput } from '../src/tool/query-writing-patterns.ts'

let root: string | undefined

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function install(config: Record<string, unknown> = {}) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const fiber = await ctx.plugin(Pkg, config)
  return { ctx, fiber }
}

describe('@deepseek-ai/dsh-writing-patterns plugin surface', () => {
  it('exports the function-plugin surface', () => {
    expect(Pkg.name).toBe('writing-patterns')
    expect(Pkg.inject).toEqual(['tools', 'systemPrompt'])
    expect(typeof Pkg.apply).toBe('function')
    expect(typeof Pkg.Config).toBe('function')
  })

  it('exports the library API', () => {
    expect(typeof Pkg.PatternStore).toBe('function')
    expect(typeof Pkg.loadPatternStore).toBe('function')
    expect(typeof Pkg.loadPatternCorpus).toBe('function')
    expect(typeof Pkg.parsePatternFile).toBe('function')
    expect(typeof Pkg.patternKeywords).toBe('function')
    expect(typeof Pkg.compileWritingSkills).toBe('function')
    expect(typeof Pkg.escapeXmlText).toBe('function')
    expect(typeof Pkg.evaluateQuality).toBe('function')
    expect(typeof Pkg.renderWritingSkillsSection).toBe('function')
    expect(typeof Pkg.createQueryWritingPatternsTool).toBe('function')
    expect(typeof Pkg.renderQueryWritingPatterns).toBe('function')
    expect(typeof Pkg.isPatternCategory).toBe('function')
    expect(Pkg.PATTERN_FILE_SUFFIX).toBe('.yaml')
    expect(Pkg.PATTERN_CATEGORIES).toHaveLength(9)
    expect(Pkg.DEFAULT_PATTERN_QUALITY).toBe(0.8)
    expect(Pkg.WRITING_PATTERNS_SECTION_NAME).toBe('writing-patterns:skills')
  })

  it('registers the tool and the section, and removes both on dispose', async () => {
    const { ctx, fiber } = await install()
    expect(ctx.tools.schemas().some(schema => schema.name === 'query_writing_patterns')).toBe(true)
    expect((await ctx.systemPrompt.assemble()).sections.map(section => section.name))
      .toContain(WRITING_PATTERNS_SECTION_NAME)
    await fiber.dispose()
    expect(ctx.tools.schemas().some(schema => schema.name === 'query_writing_patterns')).toBe(false)
    expect((await ctx.systemPrompt.assemble()).sections.map(section => section.name))
      .not.toContain(WRITING_PATTERNS_SECTION_NAME)
  })

  it('injects the whole library by default and narrows it to the configured categories', async () => {
    const whole = await install()
    const wholeText = (await whole.ctx.systemPrompt.assemble()).sections
      .find(section => section.name === WRITING_PATTERNS_SECTION_NAME)?.text ?? ''
    expect(wholeText).toContain(Pkg.WRITING_PATTERNS_PROMPT_TEXT)
    expect(wholeText).toContain('<skill id="wp-claim-utility-model">')
    expect(wholeText).toContain('<skill id="wp-oa-inventiveness-3step">')

    const narrow = await install({ sectionCategories: ['claim_drafting'] })
    const narrowText = (await narrow.ctx.systemPrompt.assemble()).sections
      .find(section => section.name === WRITING_PATTERNS_SECTION_NAME)?.text ?? ''
    expect(narrowText).toContain('<skill id="wp-claim-dependent-layering">')
    expect(narrowText).not.toContain('wp-oa-inventiveness-3step')
  })

  it('fences the compiled block so the section keeps one physical line per paragraph', async () => {
    const { ctx } = await install({ sectionCategories: ['claim_drafting'] })
    const text = (await ctx.systemPrompt.assemble()).sections
      .find(section => section.name === WRITING_PATTERNS_SECTION_NAME)?.text ?? ''
    expect(text).toContain('```xml\n<writing_skills>')
    expect(text.endsWith('</writing_skills>\n```')).toBe(true)
  })

  it('keeps the section out of the prompt when it is disabled', async () => {
    const { ctx } = await install({ registerSection: false })
    expect(ctx.tools.schemas().some(schema => schema.name === 'query_writing_patterns')).toBe(true)
    expect((await ctx.systemPrompt.assemble()).sections.map(section => section.name))
      .not.toContain(WRITING_PATTERNS_SECTION_NAME)
  })

  it('places the section at the configured order', async () => {
    const { ctx } = await install({ sectionCategories: [], sectionOrder: 700 })
    ctx.systemPrompt.section({ name: 'test:anchor', order: 900, text: 'anchor' })
    const names = (await ctx.systemPrompt.assemble()).sections.map(section => section.name)
    expect(names.indexOf(WRITING_PATTERNS_SECTION_NAME)).toBeLessThan(names.indexOf('test:anchor'))
  })

  it('applies the configured result cap to a call that omits its own limit', async () => {
    const { ctx } = await install({ matchLimit: 1 })
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('query-writing-patterns-cap'),
      name: 'query_writing_patterns',
      arguments: {},
    })
    if (result.isError) throw new Error('expected success')
    expect((result.value as QueryWritingPatternsOutput).patterns).toHaveLength(1)
  })

  it('fails loud at load when the configured corpus directory has no asset', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await expect(ctx.plugin(Pkg, { patternDir: '/nonexistent/pattern-dir' })).rejects.toThrow(/无法读取写作模式资产目录/)
  })

  it('replaces the packaged corpus with the configured directory', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-writing-patterns-config-'))
    await writeFile(join(root, 'custom.yaml'), [
      'id: deployment-pattern',
      'name: 本所独权模板',
      'category: claim_drafting',
      'summary: 本部署专用的独权写法',
      'quality: 1',
      '',
    ].join('\n'))
    const { ctx } = await install({ patternDir: root })

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('query-writing-patterns-custom'),
      name: 'query_writing_patterns',
      arguments: {},
    })
    if (result.isError) throw new Error('expected success')
    const value = result.value as QueryWritingPatternsOutput
    expect(value.patterns.map(pattern => pattern.id)).toEqual(['deployment-pattern'])
    expect(value.librarySize).toBe(1)

    const section = (await ctx.systemPrompt.assemble()).sections
      .find(candidate => candidate.name === WRITING_PATTERNS_SECTION_NAME)
    expect(section?.text).toContain('<skill id="deployment-pattern">')
    expect(section?.text).not.toContain('wp-claim-utility-model')
  })
})
