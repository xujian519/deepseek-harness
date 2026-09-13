/**
 * Verify root-relative documentation paths in repo-authored TypeScript. The
 * textual scan covers `docs/*.md` and `.agents/notes/*.md`, requires the
 * extension, checks matching string literals too, and excludes built
 * declarations and vendored source.
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { findReferenceViolations, uniqueRepoFiles, type ReferenceViolation as Violation } from './repo-files.ts'

const root = resolve(import.meta.dirname, '..')

/**
 * Repo-authored source that may cite docs in comments. `apps/` stays out of
 * the corpus: its only doc-shaped tokens are fixture paths inside synthetic
 * tool-call galleries (`docs/press.md` and `docs/guide.md` in
 * `apps/web/tests/clickable-links-gallery.e2e.ts`), which name no repository file.
 */
export const PATTERNS = ['packages/**/*.ts', 'packages/**/*.tsx']

/**
 * Paths excluded from the scan: built output and vendored upstream source.
 * @param p - repository-relative path to classify.
 * @returns whether the path is outside the authored source tree.
 */
export const isExcluded = (p: string): boolean =>
  p.includes('/lib/') || p.endsWith('.d.ts') || p.startsWith('vendor/')

/**
 * Root-relative Markdown path token, excluding trailing prose. A token reached
 * through a `./`/`../` chain stays in scope because it resolves against the
 * repository root, which is where {@link findViolations} checks it. A token
 * that continues a longer named path is not root-relative and is skipped: in
 * `/ws/docs/README.md` the `docs` component belongs to a fixture's virtual
 * workspace, so the gate would otherwise report an authoring error for a path
 * the repository never contained.
 */
const DOC_REF = /(?<![\w-])(?<![\w-]\/)(?:\bdocs|\.agents\/notes)\/[A-Za-z0-9._/-]+\.md/g

/**
 * Find every broken documentation reference in one source file.
 * @param absPath - absolute path of the source file to scan.
 * @param scanRoot - repository root the references resolve against and violations are reported from.
 * @returns every rejected reference in source order.
 */
export function findViolations(absPath: string, scanRoot: string = root): Violation[] {
  return findReferenceViolations(
    scanRoot,
    absPath,
    DOC_REF,
    ref => ref,
    ref => !existsSync(resolve(scanRoot, ref)),
  )
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  const files = uniqueRepoFiles(root, PATTERNS, isExcluded)
  const all = files.flatMap(file => findViolations(file.abs))
  const checked = files.length

  if (all.length === 0) {
    console.log(`verify-doc-refs: ${checked} file(s) checked, all documentation references resolve.`)
    process.exit(0)
  }

  console.error('verify-doc-refs: broken documentation references found in source comments (target does not exist):')
  for (const v of all) {
    console.error(`  ${v.file}:${v.line}  ${v.ref}`)
  }
  process.exit(1)
}
