/**
 * Tests for the `ctx.desktop` Service Definition.
 */

import { describe, expect, it } from 'vitest'
import { DesktopError } from '../src/invariant.ts'

describe('DesktopError', () => {
  it('carries a closed business code', () => {
    const error = new DesktopError('bridge-disconnected', 'test')
    expect(error.code).toBe('bridge-disconnected')
    expect(error.message).toBe('test')
    expect(error.name).toBe('DesktopError')
  })
})
