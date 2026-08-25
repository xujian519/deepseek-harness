/** Shared repository file discovery and line-oriented reference scanning. */

import { globSync, readFileSync, realpathSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { relative, resolve, sep } from 'node:path'

/** One authored path plus its canonical target for symlink deduplication. */
export interface RepoFile {
  /** Absolute path matched by the caller's glob. */
  abs: string
  /** Absolute canonical path used only for deduplication. */
  real: string
}

/** A rejected line-oriented repository reference. */
export interface ReferenceViolation {
  /** Repo-relative file containing the reference. */
  file: string
  /** 1-based line containing the reference. */
  line: number
  /** Normalized reference text. */
  ref: string
}

/** Whether a repository path is frozen Agent Note history, not evolving source prose. */
export function isArchivedAgentNotePath(path: string): boolean {
  return path.replaceAll('\\', '/').startsWith('.agents/notes/archived/')
}

/**
 * Expand repository-relative globs and deduplicate symlinked files.
 * @param root - absolute repository root.
 * @param patterns - repository-relative glob patterns, processed in order.
 * @param isExcluded - optional predicate over each matched relative path.
 * @returns matched files in stable first-seen order.
 */
export function uniqueRepoFiles(
  root: string,
  patterns: readonly string[],
  isExcluded: (relativePath: string) => boolean = () => false,
): RepoFile[] {
  const seen = new Set<string>()
  const files: RepoFile[] = []
  const repoPaths: string[] = []
  for (const pattern of patterns) {
    for (const match of globSync(pattern, { cwd: root })) {
      const repoPath = match.split(sep).join('/')
      if (isExcluded(repoPath)) continue
      const abs = resolve(root, repoPath)
      const real = realpathSync(abs)
      if (seen.has(real)) continue
      seen.add(real)
      files.push({ abs, real })
      repoPaths.push(repoPath)
    }
  }
  // Exclude gitignored paths (e.g. local build output) so gates scan the
  // authored tree, not machine-generated artifacts a checkout never contains.
  const ignored = new Set<string>()
  if (repoPaths.length > 0) {
    const res = spawnSync('git', ['check-ignore', '--stdin'], {
      input: repoPaths.join('\n'),
      encoding: 'utf8',
      cwd: root,
    })
    if (res.status === 0 && res.stdout) {
      for (const p of res.stdout.split('\n')) if (p !== '') ignored.add(p)
    }
  }
  return files.filter((_, index) => !ignored.has(repoPaths[index] ?? ''))
}

/**
 * Scan regex matches line by line and return the normalized matches rejected by
 * a caller predicate.
 * @param root - absolute repository root used for violation paths.
 * @param absPath - absolute text-file path to scan.
 * @param pattern - global regex matched independently against each line.
 * @param normalize - maps raw regex text to the reference the gate evaluates.
 * @param isViolation - returns true when the normalized reference is invalid.
 * @returns every rejected reference in source order.
 */
export function findReferenceViolations(
  root: string,
  absPath: string,
  pattern: RegExp,
  normalize: (raw: string) => string,
  isViolation: (ref: string) => boolean,
): ReferenceViolation[] {
  const file = relative(root, absPath).split(sep).join('/')
  const out: ReferenceViolation[] = []
  const lines = readFileSync(absPath, 'utf8').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === undefined) continue
    for (const match of line.matchAll(pattern)) {
      const ref = normalize(match[0])
      if (isViolation(ref)) out.push({ file, line: i + 1, ref })
    }
  }
  return out
}
