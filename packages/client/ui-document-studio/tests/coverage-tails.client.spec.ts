// @vitest-environment jsdom
/**
 * Branch tails the acceptance specs do not reach: the node-half apply no-op
 * and the invariant companion registration.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply as nodeApply } from '../src/index.ts'
import { apply as applyInvariant } from '../src/invariant.ts'

describe('node half and invariant', () => {
  it('node-half apply is a no-op on any context', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })

  it('the invariant companion registers ownership', async () => {
    const ctx = new Context()
    const registered: string[] = []
    ctx.provide('invariants')
    ctx.set('invariants', {
      register: (name: string) => {
        registered.push(name)
        return () => { registered.push(`dispose:${name}`) }
      },
    } as never)
    const dispose = await applyInvariant(ctx)
    expect(registered).toEqual(['@deepseek-ai/dsh-client-ui-document-studio'])
    dispose()
    expect(registered).toEqual([
      '@deepseek-ai/dsh-client-ui-document-studio',
      'dispose:@deepseek-ai/dsh-client-ui-document-studio',
    ])
  })
})
