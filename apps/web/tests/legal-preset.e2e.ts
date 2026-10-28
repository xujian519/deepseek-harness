import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-skill'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { compareOrRefreshGolden, launchWebScaffold, webSnapshotMode } from './scaffold.ts'
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'

/** Model-facing composition golden for the legal preset. */
const COMPOSITION = fileURLToPath(new URL('./expected/legal-preset/composition.expected.md', import.meta.url))

/**
 * The legal preset resolves its skills through this bundle's package path, not
 * through an ambient user root. This keyless boot mounts the real Web
 * composition and the `legal` preset, then reads the agent-scoped catalog the
 * browser would see; a broken `customSkillDirs` expression or a row that waits
 * on a missing service fails here instead of in the first legal session.
 */
it('mounts the legal preset with its packaged skill catalog', async () => {
  const mode = webSnapshotMode()
  const scaffold = await launchWebScaffold()
  try {
    const ctx = scaffold.ctx
    const resolved = await ctx.agentPresets.resolve('legal')
    expect(resolved.broken).toBeUndefined()

    const handle = await ctx.agents.create({
      sessionId: SessionId('legal-preset-smoke'),
      meta: { cwd: scaffold.workspaceCwd, agentPreset: 'legal' },
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'legal').then(() => undefined),
    })
    try {
      const skills = ctx.get('skills')
      if (skills === undefined) throw new Error('the composition mounts no skill registry')
      const names = (await skills.list({ cwd: scaffold.workspaceCwd, scope: handle.agent }))
        .map(skill => skill.name)
        .filter(name => name.startsWith('legal-'))
        .sort()
      expect(names).toHaveLength(130)
      for (const name of [
        'legal-setup',
        'legal-matter',
        'legal-research',
        'legal-citation-check',
        'legal-quality-gate',
      ]) {
        expect(names).toContain(name)
      }
      for (const prefix of [
        'legal-ai-',
        'legal-commercial-',
        'legal-corporate-',
        'legal-criminal-',
        'legal-employment-',
        'legal-ip-',
        'legal-litigation-',
        'legal-practice-',
        'legal-privacy-',
        'legal-procurement-',
        'legal-product-',
        'legal-regulatory-',
        'legal-research-',
      ]) {
        expect(names.some(name => name.startsWith(prefix))).toBe(true)
      }

      const tools = ctx.tools.schemas(handle.agent).map(tool => tool.name)
      for (const name of ['bash', 'web_fetch', 'document_deliver', 'list_doc_templates', 'render_doc_template']) {
        expect(tools).toContain(name)
      }
      expect(tools).not.toContain('web_search')

      // The preset's `templateDirs` expression must reach the party-document
      // assets through the installed package path, not only in the source tree.
      const listed = await executeToolFixture(ctx, {
        signal: new AbortController().signal,
        callId: ToolCallId('legal-list-party-document-templates'),
        name: 'list_doc_templates',
        arguments: { domain: 'legal' },
        agent: handle.agent,
      })
      expect(listed.isError).toBe(false)
      const listing = listed.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
      expect(listing).toContain('13 document templates')
      expect(listing).toContain('legal-civil-complaint-natural-person')
      expect(listing).toContain('legal-party-document')

      const composition = [
        'tools:',
        ...tools.toSorted((left, right) => left.localeCompare(right)).map(name => `- ${name}`),
        '',
        'skills:',
        ...names.map(name => `- ${name}`),
      ].join('\n')
      if (mode === 'refresh') await mkdir(dirname(COMPOSITION), { recursive: true })
      await compareOrRefreshGolden(COMPOSITION, composition, mode)
    } finally {
      await handle.dispose()
    }
  } finally {
    await scaffold.close()
  }
})
