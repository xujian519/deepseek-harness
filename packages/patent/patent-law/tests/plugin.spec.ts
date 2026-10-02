import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as Pkg from '../src/index.ts'

/** The shipped citation policy, which the schema also defaults every field to. */
const SHIPPED = Pkg.DEFAULT_CITATION_POLICY

/** A complete plugin config: the shipped policy and cnlaw base, with the overrides applied. */
function resolveConfig(overrides: Partial<Pkg.Config> = {}): Pkg.Config {
  return {
    cnlawEnabled: overrides.cnlawEnabled ?? true,
    cnlawSearchUrl: overrides.cnlawSearchUrl ?? Pkg.DEFAULT_CNLAW_SEARCH_URL,
    cnlawGraphUrl: overrides.cnlawGraphUrl ?? Pkg.DEFAULT_CNLAW_GRAPH_URL,
    onMismatch: overrides.onMismatch ?? SHIPPED.mismatch,
    onOutOfRange: overrides.onOutOfRange ?? SHIPPED.outOfRange,
    onNotIndexed: overrides.onNotIndexed ?? SHIPPED.notIndexed,
    onUnverified: overrides.onUnverified ?? SHIPPED.unverified,
    ...(overrides.baselineDir === undefined ? {} : { baselineDir: overrides.baselineDir }),
  }
}

async function install(overrides: Partial<Pkg.Config> = {}) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const fiber = await ctx.plugin(Pkg, resolveConfig(overrides))
  return { ctx, fiber }
}

describe('@deepseek-ai/dsh-patent-law plugin surface', () => {
  it('exports the function-plugin surface', () => {
    expect(Pkg.name).toBe('patent-law')
    expect(Pkg.inject).toEqual(['tools'])
    expect(typeof Pkg.apply).toBe('function')
    expect(typeof Pkg.Config).toBe('function')
  })

  it('exports the library API', () => {
    expect(typeof Pkg.parseLawReference).toBe('function')
    expect(typeof Pkg.parseCnNumber).toBe('function')
    expect(typeof Pkg.formatCnNumber).toBe('function')
    expect(typeof Pkg.extractLawReferences).toBe('function')
    expect(typeof Pkg.formatLawReference).toBe('function')
    expect(typeof Pkg.parseLawBaseline).toBe('function')
    expect(typeof Pkg.loadLawBaselines).toBe('function')
    expect(typeof Pkg.findArticle).toBe('function')
    expect(typeof Pkg.findSection).toBe('function')
    expect(typeof Pkg.verifyCitation).toBe('function')
    expect(typeof Pkg.verifyCitations).toBe('function')
    expect(typeof Pkg.resolveCitationPolicy).toBe('function')
    expect(typeof Pkg.renderCitationFindings).toBe('function')
    expect(typeof Pkg.renderCitationRows).toBe('function')
    expect(typeof Pkg.createLawVerifyTool).toBe('function')
    expect(typeof Pkg.renderCnlawDeclaration).toBe('function')
    expect(Pkg.CNLAW_DECLARATION_SECTION).toBe('patent-law:cnlaw')
    expect(Pkg.LAW_FILE_NAMES).toEqual([
      'cn-patent-law.yaml',
      'cn-implementing-regulations.yaml',
      'cn-examination-guidelines.yaml',
    ])
  })

  it('registers law_verify and unregisters it on dispose (HMR-safety)', async () => {
    const { ctx, fiber } = await install()
    expect(ctx.tools.schemas().some(schema => schema.name === 'law_verify')).toBe(true)
    await fiber.dispose()
    expect(ctx.tools.schemas().some(schema => schema.name === 'law_verify')).toBe(false)
  })

  it('defaults every policy field to the shipped citation policy', () => {
    // An empty input: schemastery fills each field from its schema default.
    expect(Pkg.Config({} as Pkg.Config)).toEqual(resolveConfig())
  })

  it('applies the configured citation policy', async () => {
    const { ctx } = await install({ onUnverified: 'block' })
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('law-verify-policy'),
      name: 'law_verify',
      // A guideline section is still awaiting transcription in the shipped
      // index, so it is what an `onUnverified` policy has to act on.
      arguments: { references: ['审查指南第二部分第四章3.2.1.1'] },
    })
    expect(result.isError).toBe(false)
    expect((result.value as { blocked: boolean }).blocked).toBe(true)
  })

  it('fails loud at load when the configured baseline directory has no index', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await expect(ctx.plugin(Pkg, resolveConfig({ baselineDir: '/nonexistent/law-dir' }))).rejects.toThrow(/法条索引目录不可读/)
  })

  it('declares the cnlaw base in the assembled prompt, and withdraws it on dispose', async () => {
    const { ctx, fiber } = await install()
    expect(sectionNames(await ctx.systemPrompt.assemble())).toContain(Pkg.CNLAW_DECLARATION_SECTION)
    await fiber.dispose()
    expect(sectionNames(await ctx.systemPrompt.assemble())).not.toContain(Pkg.CNLAW_DECLARATION_SECTION)
  })

  it('declares the endpoints the deployment configured', async () => {
    const { ctx } = await install({ cnlawSearchUrl: 'http://10.0.0.8:9100', cnlawGraphUrl: 'http://10.0.0.8:9101' })
    const text = declarationText(await ctx.systemPrompt.assemble())
    expect(text).toContain('http://10.0.0.8:9100')
    expect(text).toContain('http://10.0.0.8:9101')
  })

  it('names the retrieval channel for guideline rule text', async () => {
    // 指南条文不在 cnlaw 索引、随包索引也不含条文，故声明段必须点名取原文的工具，
    // 让 `law_verify` 判「未核验」的指南节号有落点。
    const { ctx } = await install()
    const text = declarationText(await ctx.systemPrompt.assemble())
    expect(text).toContain('law_search')
    expect(text).toContain('scope=guideline')
    expect(text).toContain('未核验')
  })

  it('declares the absence of the base when the deployment disables it', async () => {
    // A disabled base must name no endpoint at all, and must say what to verify
    // through instead, so the model does not probe a service that is not there.
    const { ctx } = await install({ cnlawEnabled: false })
    const text = declarationText(await ctx.systemPrompt.assemble())
    expect(text).toContain('cnlawEnabled=false')
    expect(text).toContain('patent_case_search')
    expect(text).not.toContain('127.0.0.1')
  })
})

/** The names of the sections one assembly carries. */
function sectionNames(assembly: { sections: Array<{ name: string }> }): string[] {
  return assembly.sections.map(section => section.name)
}

/** The declaration section's text in one assembly, or `''` while it is absent. */
function declarationText(assembly: { sections: Array<{ name: string; text: string }> }): string {
  return assembly.sections.find(section => section.name === Pkg.CNLAW_DECLARATION_SECTION)?.text ?? ''
}
