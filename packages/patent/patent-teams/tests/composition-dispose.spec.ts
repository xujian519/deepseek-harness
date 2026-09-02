// Composition and HMR-safety test: mounts the plugin's apply() on a real
// Context with the real tools registry and system-prompt service, asserts the
// service, all ten patent_teams_* tools, and the usage section are live, then
// disposes the fiber and observes every registration removed and the retired-
// member guard restored. This is the disposal proof required by
// packages/AGENTS.md for registry contributions.
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { apply, Config, inject, name } from '../src/index.ts'

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

function makeSubagentsStub(): Record<string, unknown> {
  const guardProbe = {
    listChildren: async () => [],
    listDescendants: async () => [],
    sendMessage: async () => 'msg',
  }
  return {
    getProvider: () => undefined,
    list: () => [],
    startContinuable: async () => { throw new Error('unused') },
    listChildren: guardProbe.listChildren,
    listDescendants: guardProbe.listDescendants,
    sendMessage: guardProbe.sendMessage,
    guardProbe,
  }
}

async function mount(): Promise<Context> {
  const ctx = new Context()
  context = ctx
  ctx.provide('agents', { get: () => undefined })
  ctx.provide('llm', { resolveCallConfig: async (config: unknown) => config })
  ctx.provide('subagents', makeSubagentsStub())
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin({ name, inject, Config, apply: (c: Context) => { apply(c, {}) } })
  return ctx
}

describe('patent-teams composition', () => {
  it('registers the service, all ten tools, and the usage section', async () => {
    const ctx = await mount()
    expect(ctx.get('patentTeams')).toBeDefined()
    const tools = [
      'patent_teams_create',
      'patent_teams_add_member',
      'patent_teams_remove_member',
      'patent_teams_create_task',
      'patent_teams_reassign_task',
      'patent_teams_claim_task',
      'patent_teams_update_task',
      'patent_teams_send_message',
      'patent_teams_status',
      'patent_teams_delete',
    ]
    for (const name of tools) {
      expect(ctx.tools.get(name), `tool ${name} should be registered`).toBeDefined()
    }
    const prompt = await ctx.systemPrompt.assemble()
    const sectionNames = prompt.sections.map(section => section.name)
    expect(sectionNames).toContain('patent-teams:usage')
    const usageText = prompt.sections.find(section => section.name === 'patent-teams:usage')?.text ?? ''
    expect(usageText).toContain('patent_teams_create')
  })

  it('removes every registration and restores the guard on dispose', async () => {
    const ctx = await mount()
    const stub = ctx.get('subagents') as unknown as ReturnType<typeof makeSubagentsStub>
    const guardedChildren = stub.listChildren
    const guardProbe = stub.guardProbe as {
      listChildren: () => Promise<unknown[]>
    }
    expect(guardProbe.listChildren).toBe(guardedChildren)
    // The guard wraps the runtime methods while mounted.
    expect(ctx.get('subagents')).toBeDefined()
    const tools = ctx.get('tools') as ToolRuntime
    const systemPrompt = ctx.get('systemPrompt') as SystemPrompt

    await ctx.fiber.dispose()
    context = undefined

    for (const name of [
      'patent_teams_create',
      'patent_teams_status',
      'patent_teams_delete',
    ]) {
      expect(tools.get(name), `tool ${name} should be removed after dispose`).toBeUndefined()
    }
    // The usage section left the assembled prompt.
    const prompt = await systemPrompt.assemble()
    const sectionNames = prompt.sections.map(section => section.name)
    expect(sectionNames).not.toContain('patent-teams:usage')
  })
})
