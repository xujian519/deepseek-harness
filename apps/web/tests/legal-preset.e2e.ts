import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import type {} from '@deepseek-ai/dsh-skill'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { compareOrRefreshGolden, launchWebScaffold, webSnapshotMode } from './scaffold.ts'

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
      expect(names).toHaveLength(59)
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
        'legal-commercial-',
        'legal-litigation-',
        'legal-employment-',
        'legal-research-',
      ]) {
        expect(names.some(name => name.startsWith(prefix))).toBe(true)
      }

      const tools = ctx.tools.schemas(handle.agent).map(tool => tool.name)
      for (const name of ['bash', 'web_fetch', 'document_deliver', 'render_doc_template']) {
        expect(tools).toContain(name)
      }
      expect(tools).not.toContain('web_search')

      const composition = [
        'tools:',
        ...tools.toSorted((left, right) => left.localeCompare(right)).map(name => `- ${name}`),
        '',
        'skills:',
        ...names.map(name => `- ${name}`),
      ].join('\n')
      const mode = webSnapshotMode()
      if (mode === 'refresh') await mkdir(dirname(COMPOSITION), { recursive: true })
      await compareOrRefreshGolden(COMPOSITION, composition, mode)
    } finally {
      await handle.dispose()
    }
  } finally {
    await scaffold.close()
  }
})
