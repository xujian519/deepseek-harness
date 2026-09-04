/**
 * Self-evolve bundle glue: the runtime plugin mounts without throwing.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/index.ts'

describe('dsh-self-evolve-app glue', () => {
  it('apply mounts without throwing', () => {
    expect(() => { apply(new Context()) }).not.toThrow()
  })
})
