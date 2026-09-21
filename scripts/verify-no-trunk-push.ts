/**
 * Refuse a local push whose destination is the trunk branch. Trunk changes land
 * through a pull request, so the remote ruleset's required status checks run
 * before the merge; this checkpoint says so in the terminal instead of at the
 * server. The ruleset owns the enforcement: `git push --no-verify` skips this
 * hook, and a bypass-listed account pushes to trunk regardless.
 *
 * Git writes one `<local ref> <local oid> <remote ref> <remote oid>` line per
 * pushed ref to the hook's stdin. When no line arrives the destination is
 * unknowable, so a checkout on trunk is refused instead: starting a push from
 * trunk is the case this guard exists for.
 *
 * Lefthook skips pre-push jobs when a push carries no file change, so a push that
 * git reports as updating nothing is not examined; every push that updates a
 * remote ref runs this check.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

/** Trunk branch: the protected ref of the `master` ruleset and every PR's base. */
export const TRUNK_BRANCH = 'master'

/** The trunk ref as Git names it in a `pre-push` line. */
const TRUNK_REF = `refs/heads/${TRUNK_BRANCH}`

/** Remote object id Git reports for a deletion. */
const ZERO_OID = '0'.repeat(40)

/** Field count of a `pre-push` ref line: local ref, local oid, remote ref, remote oid. */
const REF_LINE_FIELDS = 4

/**
 * Decide whether a push must be refused.
 * @param refLines - Lines Git wrote to the hook's stdin; empty when the hook received none.
 * @param headBranch - Checked-out branch, consulted only when `refLines` is empty.
 * @returns the refusal with its reason, or undefined when the push may proceed.
 */
export function trunkPushViolation(refLines: readonly string[], headBranch?: string): string | undefined {
  const lines = refLines.map(line => line.trim()).filter(line => line !== '')
  if (lines.length === 0) {
    return headBranch === TRUNK_BRANCH
      ? `a push started on ${TRUNK_BRANCH} is refused; the hook received no ref line, so the destination is unknown`
      : undefined
  }
  for (const line of lines) {
    const fields = line.split(/\s+/u)
    if (fields.length !== REF_LINE_FIELDS) return `a pushed ref could not be read from ${JSON.stringify(line)}`
    if (fields[2] !== TRUNK_REF) continue
    return fields[3] === ZERO_OID
      ? `deleting ${TRUNK_BRANCH} is refused`
      : `pushing to ${TRUNK_BRANCH} is refused`
  }
  return undefined
}

/** The checked-out branch, or undefined when HEAD names none (detached, or no repository). */
function headBranch(): string | undefined {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    /* Without a readable HEAD the ref lines alone decide. */
    return undefined
  }
}

if (import.meta.main) {
  // A terminal on stdin means the hook context is absent; the branch fallback decides.
  const input = process.stdin.isTTY ? '' : readFileSync(0, 'utf8')
  const violation = trunkPushViolation(input.split('\n'), headBranch())
  if (violation !== undefined) {
    console.error(`verify-no-trunk-push: ${violation}; open a pull request instead (gh stack submit), or pass --no-verify to push anyway`)
    process.exitCode = 1
  }
}
