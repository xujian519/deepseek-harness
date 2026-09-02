// Real-composition test: boots a test cordis.yml through the real Loader
// mounting @deepseek-ai/dsh-patent-workflow over the services it needs
// (dsh-session, dsh-user-approval with an answerer), and asserts ctx.patentWorkflow
// plus a workflow run against an injected port whose durable patent/workflow-run
// event lands on the real session log.
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SessionStore from '@deepseek-ai/dsh-session'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import PatentWorkflow from '@deepseek-ai/dsh-patent-workflow'
import type { WorkflowManifest } from '@deepseek-ai/dsh-patent-workflow'
import { registerBuiltinAtoms, type StageProvider } from '@deepseek-ai/dsh-patent-core'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function boot(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-patent-workflow-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-user-approval'",
    "- name: '@deepseek-ai/dsh-patent-workflow'",
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-user-approval', ApprovalService],
    ['@deepseek-ai/dsh-patent-workflow', PatentWorkflow],
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

describe('patent-workflow real Loader composition through cordis.yml', () => {
  it('mounts ctx.patentWorkflow and records a workflow run against an injected port', async () => {
    const ctx = await boot()
    expect(ctx.patentWorkflow).toBeInstanceOf(PatentWorkflow)

    ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('allowed-once'))

    registerBuiltinAtoms()
    const manifest: WorkflowManifest = {
      id: 'comp_test',
      name: '组合测试',
      caseType: 'disclosure_analysis',
      stages: [
        {
          id: 'extract',
          strategy: 'sub_agent',
          description: '提取特征',
          atom: 'extract',
          params: { extraction_type: '提取技术特征', output_key: 'features' },
        },
      ],
    }
    const provider: StageProvider = { callLLM: async () => JSON.stringify({ features: ['特征A'] }) }

    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    const agent = { session }

    const result = await ctx.patentWorkflow.runWorkflow(manifest, { text: '交底书' }, undefined, { provider }, agent)

    expect(result.completed).toBe(true)
    const events = session.snapshotEvents().filter(e => e.type === 'patent/workflow-run')
    expect(events).toHaveLength(1)
    expect(events[0]!.data.manifestId).toBe('comp_test')
    expect(events[0]!.data.stages.some(s => s.stageId === 'extract' && !s.degraded)).toBe(true)
  }, 30_000)
})
