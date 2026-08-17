import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import PatentWorkflow from '@deepseek-ai/dsh-patent-workflow'

describe('@deepseek-ai/dsh-patent-workflow', () => {
  it('default-exports its service class and serves ctx.patentWorkflow', async () => {
    const ctx = new Context()
    await ctx.plugin(PatentWorkflow)
    try {
      expect(ctx.patentWorkflow).toBeInstanceOf(PatentWorkflow)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
