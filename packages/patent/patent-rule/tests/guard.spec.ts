import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import {
  EVIDENCE_COMPLIANCE_TOOL,
  createEvidenceComplianceGuards,
  evi011GuardConditionFields,
  patentAssetDir,
} from '@deepseek-ai/dsh-patent-rule'

const signal = new AbortController().signal

function exec(name: string, args: unknown): ToolExecution {
  return { callId: CallId('c'), name, arguments: args, signal } as unknown as ToolExecution
}

function evidenceTool() {
  return defineContentToolFixture({
    name: EVIDENCE_COMPLIANCE_TOOL,
    description: 'evaluate evidence',
    parameters: {},
    async execute(): Promise<Array<{ type: 'text'; text: string }>> { return [{ type: 'text', text: 'ok' }] },
  })
}

describe('EVI-011 evidence-compliance guards', () => {
  it('derives condition fields from the packaged evidence-rules.yaml', () => {
    const conditions = evi011GuardConditionFields([patentAssetDir()])
    expect([...conditions].sort()).toEqual(['legalized', 'notarized', 'translated'])
  })

  it('falls back to the hardcoded condition fields when assets are missing', () => {
    const conditions = evi011GuardConditionFields([])
    expect([...conditions].sort()).toEqual(['legalized', 'notarized', 'translated'])
  })

  it('abstains on non-matching tools and non-object arguments', () => {
    const [notarizationGuard] = createEvidenceComplianceGuards([])
    expect(notarizationGuard!(exec('other_tool', {}))).toBeUndefined()
    expect(notarizationGuard!(exec(EVIDENCE_COMPLIANCE_TOOL, null))).toBeUndefined()
  })

  it('denies overseas evidence missing notarization/legalization', () => {
    const [notarizationGuard] = createEvidenceComplianceGuards([])
    const denial = notarizationGuard!(exec(EVIDENCE_COMPLIANCE_TOOL, { evidenceType: 'overseas', notarized: false, legalized: false }))
    expect(denial).toMatch(/EVI-011-notarization/)
    expect(notarizationGuard!(exec(EVIDENCE_COMPLIANCE_TOOL, { evidenceType: 'overseas', notarized: true, legalized: true }))).toBeUndefined()
  })

  it('denies foreign-language evidence missing a translation', () => {
    const [, translationGuard] = createEvidenceComplianceGuards([])
    expect(translationGuard!(exec(EVIDENCE_COMPLIANCE_TOOL, { evidenceType: 'foreign_language', translated: false }))).toMatch(/EVI-011-translation/)
    expect(translationGuard!(exec(EVIDENCE_COMPLIANCE_TOOL, { evidenceType: 'foreign_language', translated: true }))).toBeUndefined()
  })

  it('is monotonic deny: a pre-execute allow cannot override it', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    ctx.tools.register(evidenceTool())
    for (const guard of createEvidenceComplianceGuards([patentAssetDir()])) {
      ctx.tools.guard(guard)
    }
    ctx.on('tools/pre-execute', () => Promise.resolve({ kind: 'allow' as const }), { prepend: true })

    const result = await ctx.tools.execute(exec(EVIDENCE_COMPLIANCE_TOOL, { evidenceType: 'overseas', notarized: false, legalized: false }))
    expect(result.isError).toBe(true)
    expect(result.error?.message).toMatch(/EVI-011-notarization/)
  })
})
