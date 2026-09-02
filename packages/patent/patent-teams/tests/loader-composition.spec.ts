// Real-Loader composition test: boots a test cordis.yml through the real
// Loader mounting @deepseek-ai/dsh-patent-teams over the services it needs
// (dsh-subagent, dsh-tools, dsh-system-prompt), and asserts the service, all
// ten patent_teams_* tools, and the usage section are live on the real
// context. This is the shipped entry path: a hand-mounted plugin would not
// catch invalid Loader exports or missing inject services.
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as plugin from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function boot(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-patent-teams-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-subagent'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-patent-teams'",
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-subagent', SubagentRuntime],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-patent-teams', plugin],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error('unexpected Loader import: ' + specifier)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return ctx
}

describe('dsh-patent-teams real Loader composition', () => {
  it('mounts the service, all eleven tools, and the usage section', async () => {
    const ctx = await boot()
    expect(ctx.get('patentTeams')).toBeDefined()
    for (const name of [
      'patent_teams_create',
      'patent_teams_add_member',
      'patent_teams_remove_member',
      'patent_teams_create_task',
      'patent_teams_reassign_task',
      'patent_teams_claim_task',
      'patent_teams_update_task',
      'patent_teams_send_message',
      'patent_teams_status',
      'patent_teams_archive',
      'patent_teams_delete',
    ]) {
      expect(ctx.tools.get(name), `tool ${name} should be registered`).toBeDefined()
    }
    const assembly = await ctx.get('systemPrompt')!.assemble()
    const sectionNames = assembly.sections.map(section => section.name)
    expect(sectionNames).toContain('patent-teams:usage')
  })
})
