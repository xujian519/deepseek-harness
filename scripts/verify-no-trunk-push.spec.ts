/** Behavior of the local trunk-push guard: `scripts/verify-no-trunk-push.ts`. */

import { describe, expect, it } from 'vitest'
import { TRUNK_BRANCH, trunkPushViolation } from './verify-no-trunk-push.ts'

const OID = 'a'.repeat(40)
const ZERO = '0'.repeat(40)

/** One `pre-push` stdin line, with the local side set to a topic branch. */
function refLine(remoteRef: string, remoteOid = OID): string {
  return `refs/heads/topic ${OID} ${remoteRef} ${remoteOid}`
}

describe('trunkPushViolation', () => {
  it('refuses a push whose remote ref is trunk', () => {
    expect(trunkPushViolation([refLine(`refs/heads/${TRUNK_BRANCH}`)])).toContain(`pushing to ${TRUNK_BRANCH} is refused`)
  })

  it('refuses a deletion of trunk', () => {
    expect(trunkPushViolation([refLine(`refs/heads/${TRUNK_BRANCH}`, ZERO)])).toContain(`deleting ${TRUNK_BRANCH} is refused`)
  })

  it('allows a push to another branch', () => {
    expect(trunkPushViolation([refLine('refs/heads/topic')])).toBeUndefined()
  })

  it('allows a tag-only push', () => {
    expect(trunkPushViolation([`refs/tags/v1 ${OID} refs/tags/v1 ${OID}`])).toBeUndefined()
  })

  it('decides on the remote ref, not the local one', () => {
    expect(trunkPushViolation([`refs/heads/${TRUNK_BRANCH} ${OID} refs/heads/topic ${OID}`])).toBeUndefined()
  })

  it('refuses a push started on trunk when the hook received no ref line', () => {
    expect(trunkPushViolation([], TRUNK_BRANCH)).toContain('received no ref line')
  })

  it('allows a push started on a topic branch when the hook received no ref line', () => {
    expect(trunkPushViolation([], 'topic')).toBeUndefined()
    expect(trunkPushViolation([], undefined)).toBeUndefined()
  })

  it('refuses a ref line it cannot read', () => {
    expect(trunkPushViolation(['refs/heads/topic'])).toContain('could not be read')
  })

  it('ignores blank lines around the ref lines', () => {
    expect(trunkPushViolation(['', refLine('refs/heads/topic'), ''])).toBeUndefined()
  })

  it('refuses when trunk appears after another ref in the same push', () => {
    expect(trunkPushViolation([refLine('refs/heads/topic'), refLine(`refs/heads/${TRUNK_BRANCH}`)])).toContain('is refused')
  })
})
