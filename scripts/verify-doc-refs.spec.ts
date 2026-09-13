/**
 * Acceptance-path coverage for `verify-doc-refs`: the corpus is the `.ts`
 * and `.tsx` authored source, a citation reached through a `../` chain
 * resolves against the repository root, and a doc-shaped component of a
 * longer absolute path — a fixture's virtual workspace — is not a citation.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { uniqueRepoFiles } from './repo-files.ts'
import { PATTERNS, findViolations, isExcluded } from './verify-doc-refs.ts'

const sandbox = mkdtempSync(join(tmpdir(), 'doc-refs-'))
afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true })
})

let trees = 0

/** Materialize a fabricated source tree inside the file's sandbox and return its root. */
function layout(files: Record<string, string>): string {
  const root = join(sandbox, `tree-${String(trees++)}`)
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), content)
  }
  return root
}

describe('verify-doc-refs', () => {
  it('scans .tsx sources alongside .ts while excluding vendored and built output', () => {
    const root = layout({
      'packages/a/src/view.tsx': 'export {}\n',
      'packages/a/src/index.ts': 'export {}\n',
      'packages/a/src/lib/built.tsx': 'export {}\n',
      'packages/a/src/api.d.ts': 'export {}\n',
      'vendor/b/src/view.tsx': 'export {}\n',
    })
    const files = uniqueRepoFiles(root, PATTERNS, isExcluded).map(file => relative(root, file.abs))
    expect(files.sort()).toEqual(['packages/a/src/index.ts', 'packages/a/src/view.tsx'])
  })

  it('reports a citation whose target does not exist', () => {
    const root = layout({ 'a.ts': '// see docs/missing.md\n' })
    expect(findViolations(join(root, 'a.ts'), root)).toEqual([
      { file: 'a.ts', line: 1, ref: 'docs/missing.md' },
    ])
  })

  it('checks a citation reached through a relative chain against the repository root', () => {
    const root = layout({
      'packages/a/src/index.ts': '// see ../../../.agents/notes/kept.md\n',
      '.agents/notes/kept.md': '# kept\n',
    })
    expect(findViolations(join(root, 'packages/a/src/index.ts'), root)).toEqual([])
  })

  it('reports a broken citation reached through a relative chain', () => {
    const root = layout({ 'packages/a/src/index.ts': '// see ../../../.agents/notes/gone.md\n' })
    expect(findViolations(join(root, 'packages/a/src/index.ts'), root)).toEqual([
      { file: 'packages/a/src/index.ts', line: 1, ref: '.agents/notes/gone.md' },
    ])
  })

  it('ignores a docs component inside a longer named path', () => {
    // `'/ws/docs/README.md'` names a fixture's virtual workspace file, so the
    // absent repository target is not an authoring error.
    const root = layout({ 'a.tsx': "export const p = '/ws/docs/README.md'\n" })
    expect(findViolations(join(root, 'a.tsx'), root)).toEqual([])
  })

  it('still checks a citation that opens a token with a leading slash', () => {
    const root = layout({ 'a.ts': '// see /docs/missing.md\n' })
    expect(findViolations(join(root, 'a.ts'), root)).toEqual([
      { file: 'a.ts', line: 1, ref: 'docs/missing.md' },
    ])
  })
})
