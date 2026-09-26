import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as Pkg from '../src/index.ts'

/** The shipped citation policy, which the schema also defaults every field to. */
const SHIPPED = Pkg.DEFAULT_CITATION_POLICY

/** A complete plugin config: the shipped policy, with the overrides applied. */
function resolveConfig(overrides: Partial<Pkg.Config> = {}): Pkg.Config {
  return {
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
})
