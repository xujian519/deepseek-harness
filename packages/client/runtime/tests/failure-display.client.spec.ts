/**
 * displayFailureMessage: AUTH masking keeps provider auth wording (which may
 * echo a credential) out of the GUI, while every other code projects its real
 * message — a QUOTA failure must surface the account-limit reason, not the
 * generic auth copy.
 */

import { describe, expect, it } from 'vitest'
import { displayFailureMessage } from '../src/client/sessions/failure-display.ts'

describe('displayFailureMessage', () => {
  it('masks AUTH failures behind the generic copy, never echoing the provider message', () => {
    expect(displayFailureMessage({ code: 'AUTH', message: '401 {"error":{"message":"sk-preview-secret"}}' }))
      .toBe('API key is invalid')
  })

  it('projects the real provider message for QUOTA failures', () => {
    const message = "You've reached your usage limit for this billing cycle. Your quota will be refreshed in the next cycle."
    expect(displayFailureMessage({ code: 'QUOTA', message })).toBe(message)
  })

  it('projects the provider message for non-AUTH codes', () => {
    expect(displayFailureMessage({ code: 'RATE_LIMIT', message: 'retry later' })).toBe('retry later')
  })

  it('stringifies non-object failures', () => {
    expect(displayFailureMessage('boom')).toBe('boom')
    expect(displayFailureMessage(null)).toBe('null')
  })

  it('stringifies an object whose message is not a string', () => {
    expect(displayFailureMessage({ code: 'X', message: 42 })).toBe('{"code":"X","message":42}')
  })
})
