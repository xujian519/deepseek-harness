/**
 * Verify that every lint suppression states why it is safe.
 *
 * A suppression is load-bearing documentation: the reader must be able to tell which
 * invariant makes it correct there, and the change that removes that invariant must find
 * the directives it invalidates. The admitted reason forms are an inline clause on the
 * directive (`// oxlint-disable-next-line <rule> -- why`), the trailing text TypeScript
 * itself parses for `@ts-expect-error <why>`, and a comment in the directive's
 * blank-line-delimited block ahead of it. One heading carries the shared fact for the run
 * of directives beneath it, which is how `defineTool` documents its seven
 * `unbound-method` extractions with one property of `options`; a JSDoc doc-block documents
 * the declaration it precedes, so it never counts as a suppression reason.
 *
 * A directive that switches off several rules needs a reason for each of them; that is a
 * review rule, not a mechanically checkable one, because the reasons are prose.
 *
 * Discovery is syntax-aware, as `scripts/AGENTS.md` requires: a line-wise regex also
 * matches directive text written inside string and template literals, which
 * `scripts/oxlint-contract.spec.ts` does on purpose to exercise oxlint's own contracts.
 */

import { globSync, readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '..')

/** Directives that switch a lint rule off. `@ts-ignore`/`@ts-nocheck`, which need no reason, stay out. */
const DIRECTIVE = /^(?:oxlint-disable(?:-next-line|-line)?|eslint-disable(?:-next-line|-line)?|@ts-expect-error)\b/

/** The files the lint configuration reaches, mirrored so an unlinted directive is not this gate's finding. */
const LINTED_GLOBS = [
  'packages/*/*/src/**/*.{ts,tsx}',
  'packages/*/*/tests/**/*.{ts,tsx}',
  'apps/*/src/**/*.{ts,tsx}',
  'apps/*/tests/**/*.{ts,tsx}',
  'examples/**/*.{ts,tsx}',
  'scripts/**/*.{ts,tsx}',
  'website/**/*.{ts,tsx}',
] as const

/** One suppression directive and where it sits. */
export interface SuppressionFinding {
  /** One-based line number of the directive. */
  readonly line: number
  /** The directive's comment text with whitespace collapsed, for the report. */
  readonly text: string
}

/** Every suppression directive in one file, split by whether it states a reason. */
export interface SuppressionScan {
  /** Number of suppression directives found. */
  readonly directives: number
  /** The directives that state no reason, in source order. */
  readonly unexplained: readonly SuppressionFinding[]
}

/** Strip a comment's delimiters and surrounding whitespace. */
function commentBody(raw: string): string {
  return raw.replace(/^\/\*+/, '').replace(/^\/\//, '').replace(/\*\/$/, '').trim()
}

/**
 * Whether the directive's own comment states why the suppression is safe.
 *
 * @param raw - the complete comment text, delimiters included.
 * @param body - `raw` without delimiters, as `commentBody` returns it.
 * @returns true for an inline `-- why` clause or `@ts-expect-error` trailing text.
 */
function carriesInlineReason(raw: string, body: string): boolean {
  if (/ --(?:\s|$)/.test(raw)) return true
  return body.startsWith('@ts-expect-error') && body.slice('@ts-expect-error'.length).trim().length > 0
}

/**
 * Scan one source file's suppression directives.
 *
 * @param file - repository-relative path; its extension selects the parser's script kind.
 * @param source - the file's contents.
 * @returns the directive count and every directive without a reason.
 */
export function scanSuppressions(file: string, source: string): SuppressionScan {
  // A directive in one of these words is the only thing this gate reports, and parsing
  // every file in the repository to find none of them is the whole cost of the gate.
  if (!source.includes('oxlint-disable') && !source.includes('eslint-disable') && !source.includes('@ts-expect-error')) {
    return { directives: 0, unexplained: [] }
  }
  const parsed = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const comments: Array<{ pos: number; end: number }> = []
  const seen = new Set<number>()
  const collect = (node: ts.Node): void => {
    for (const range of ts.getLeadingCommentRanges(source, node.pos) ?? []) {
      if (seen.has(range.pos)) continue
      seen.add(range.pos)
      comments.push({ pos: range.pos, end: range.end })
    }
    ts.forEachChild(node, collect)
  }
  collect(parsed)
  // `forEachChild` skips the end-of-file token, whose leading trivia holds a trailing comment.
  collect(parsed.endOfFileToken)
  comments.sort((left, right) => left.pos - right.pos)

  const lines = source.split('\n')
  const lineAt = (pos: number): number => parsed.getLineAndCharacterOfPosition(pos).line + 1
  const unexplained: SuppressionFinding[] = []
  let directives = 0
  for (const comment of comments) {
    const raw = source.slice(comment.pos, comment.end)
    const body = commentBody(raw)
    if (!DIRECTIVE.test(body)) continue
    directives += 1
    if (carriesInlineReason(raw, body)) continue
    const line = lineAt(comment.pos)
    let top = line - 1
    while (top - 1 >= 0 && lines[top - 1]?.trim() !== '') top -= 1
    const heading = comments.some((candidate) => {
      if (candidate.pos >= comment.pos) return false
      if (lineAt(candidate.pos) < top + 1) return false
      const candidateRaw = source.slice(candidate.pos, candidate.end)
      return !DIRECTIVE.test(commentBody(candidateRaw)) && !candidateRaw.startsWith('/**')
    })
    if (heading) continue
    unexplained.push({ line, text: body.replace(/\s+/gu, ' ') })
  }
  return { directives, unexplained }
}

/**
 * Scan every linted file in the repository.
 *
 * @returns the repository-wide directive count and every directive without a reason.
 * @throws when the corpus or the directive count is empty, which would make the gate pass
 * by scanning nothing.
 */
export function scanRepository(): { directives: number; findings: Array<SuppressionFinding & { file: string }> } {
  const files = LINTED_GLOBS.flatMap(pattern => globSync(pattern, { cwd: root, exclude: ['**/.generated/**', '**/*.d.ts'] }))
  if (files.length === 0) throw new Error('verify-suppression-reasons: scanned an empty corpus; the globs no longer match.')
  let directives = 0
  const findings: Array<SuppressionFinding & { file: string }> = []
  for (const file of files) {
    const posix = file.replaceAll('\\', '/')
    const scan = scanSuppressions(posix, readFileSync(resolve(root, file), 'utf8'))
    directives += scan.directives
    for (const finding of scan.unexplained) findings.push({ file: posix, ...finding })
  }
  if (directives === 0) throw new Error('verify-suppression-reasons: found no suppression directives; discovery is broken.')
  return { directives, findings }
}

function main(): void {
  const { directives, findings } = scanRepository()
  if (findings.length === 0) {
    console.log(`verify-suppression-reasons: all ${String(directives)} suppressions state a reason.`)
    return
  }
  console.error('verify-suppression-reasons: these suppressions do not say why they are safe.\n')
  for (const finding of findings) {
    console.error(`  ${relative('.', finding.file)}:${String(finding.line)}  ${finding.text}`)
  }
  console.error('\nState the reason inline (`// oxlint-disable-next-line <rule> -- why`) or in a comment above the directive.')
  process.exit(1)
}

if (import.meta.filename === resolve(process.argv[1] ?? '')) main()
