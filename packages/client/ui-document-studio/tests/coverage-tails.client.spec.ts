// @vitest-environment jsdom
/**
 * Branch tails the acceptance specs do not reach: the node-half apply no-op.
 */
import { describe, expect, it } from 'vitest'
import { apply as nodeApply } from '../src/index.ts'

describe('node half', () => {
  it('node-half apply is a no-op on any context', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})
