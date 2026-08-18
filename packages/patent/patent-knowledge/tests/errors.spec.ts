import { describe, expect, it } from 'vitest'
import { errorMessage } from '@deepseek-ai/dsh-patent-knowledge/src/shared/errors.ts'

describe('errorMessage', () => {
  it('uses the message of an Error value', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom')
  })

  it('stringifies non-Error values', () => {
    expect(errorMessage('plain text')).toBe('plain text')
    expect(errorMessage(42)).toBe('42')
  })
})
