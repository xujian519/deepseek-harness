/**
 * Git operations for the sidebar source-control panel. Everything goes
 * through the system `git` binary spawned per request (no library, no state),
 * with porcelain-parseable output formats (`-z` NUL framing, unit separators)
 * so parsing never depends on locale or color config. All commands run with
 * `-C <cwd>` on the session's working directory and `--no-pager` /
 * `-c color.ui=false` so output stays machine-readable.
 *
 * Commits use the user's git global identity untouched (never sets
 * user.name/user.email).
 */
import { existsSync, realpathSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { spawn } from 'node:child_process'

/** A parsed `git status --porcelain=v1 -z` entry. */
export interface GitStatusEntry {
  path: string
  /** Two-letter index/worktree status (X Y), e.g. 'M ', ' M', 'A ', '??'. */
  xy: string
}

/** The source-control panel snapshot. */
export interface GitStatusResult {
  isRepo: boolean
  branch?: string
  entries: GitStatusEntry[]
  /** True when the working tree had more rows than `GIT_STATUS_LIMIT`; the
   *  panel shows a truncation notice instead of freezing on a huge untracked
   *  set (issue #369). */
  truncated?: boolean
  /** Selected repository root, or the discovered roots when the cwd is a container. */
  root?: string
  repositories?: string[]
}

/** One linked checkout returned by `git worktree list --porcelain`. */
export interface GitWorktree {
  /** Absolute checkout root. */
  path: string
  /** Branch name without `refs/heads/`, or `HEAD` when detached. */
  branch: string
  /** Whether this checkout contains the session cwd. */
  current: boolean
  /** Number of staged + unstaged status rows (a file changed on both sides counts once). */
  changes: number
}

/** One `git log` row. */
export interface GitLogEntry {
  /** Short hash (7+ chars, display). */
  hash: string
  /** Full 40-char hash (advanced operations: revert / cherry-pick). */
  hashFull: string
  subject: string
  author: string
  /** ISO 8601 author date (`%ai`), e.g. `2024-01-01 10:00:00 +0800`. */
  date: string
  /** Ref decorations (`%D` with --decorate=short), e.g. `HEAD -> main, origin/main`; '' when none. */
  refs: string
}

/** Machine-readable git failure codes (surfaced on the wire by `writeError`).
 *  `git-error` is the generic command failure; `not-repo` is a cwd outside any
 *  work tree; `git-worktree` is an unknown linked checkout target. */
export type GitCommandErrorCode = 'git-error' | 'not-repo' | 'git-worktree'

/** One git failure (stderr text as the message). */
export class GitCommandError extends Error {
  constructor(
    message: string,
    readonly code: GitCommandErrorCode = 'git-error',
    readonly command: string,
  ) {
    super(message)
  }
}

/**
 * Parse porcelain v1 -z output into entries (rename/copy pairs collapse to one row).
 * @param output - raw stdout of `git status --porcelain=v1 -z`.
 * @returns one entry per path, in output order.
 */
export function parsePorcelainZ(output: string): GitStatusEntry[] {
  const tokens = output.split('\0')
  const entries: GitStatusEntry[] = []
  let index = 0
  while (index < tokens.length) {
    const token = tokens[index] as string
    index += 1
    if (token === '') continue
    const xy = token.slice(0, 2)
    const rest = token.slice(3)
    entries.push({ path: rest, xy })
    // Rename/copy entries carry the ORIGIN path as the next NUL field; the
    // new path (the file as it exists now) is the display path.
    if ((xy[0] === 'R' || xy[0] === 'C') && tokens[index] !== undefined && tokens[index] !== '') {
      index += 1
    }
  }
  return entries
}

/** One raw porcelain worktree record. Prunable checkouts are retained by
 * Git's administrative metadata after their directory disappears and must not
 * become selectable command targets. Locked checkouts remain usable. */
export interface GitWorktreeRecord {
  path: string
  branch: string
  locked: boolean
  prunable: boolean
}

/** Parse `git worktree list --porcelain` records. Production requests use
 * `-z` so even newlines and non-ASCII bytes in checkout paths stay lossless;
 * newline framing remains accepted for small fixtures and older Git output.
 * @param output - raw stdout of `git worktree list --porcelain`, NUL or newline framed.
 * @returns one record per checkout, locked and prunable included.
 */
export function parseWorktreeList(output: string): GitWorktreeRecord[] {
  const rows: GitWorktreeRecord[] = []
  let path: string | undefined
  let branch = 'HEAD'
  let locked = false
  let prunable = false
  const flush = (): void => {
    if (path !== undefined) rows.push({ path, branch, locked, prunable })
    path = undefined
    branch = 'HEAD'
    locked = false
    prunable = false
  }
  const sep = output.includes('\0') ? '\0' : '\n'
  const framed = output.endsWith(sep) ? output : `${output}${sep}`
  for (const line of framed.split(sep)) {
    if (line === '') {
      flush()
    } else if (line.startsWith('worktree ')) {
      path = line.slice('worktree '.length)
    } else if (line.startsWith('branch refs/heads/')) {
      branch = line.slice('branch refs/heads/'.length)
    } else if (line === 'locked' || line.startsWith('locked ')) {
      locked = true
    } else if (line === 'prunable' || line.startsWith('prunable ')) {
      prunable = true
    }
  }
  return rows
}

/**
 * Parse `git log --pretty=format:%h%x1f%s%x1f%an%x1f%ai%x1f%H%x1f%D` rows.
 * @param output - raw stdout of the `git log` format above, newline separated.
 * @returns one entry per non-empty row; rows missing the hash or subject are skipped.
 */
export function parseLogLines(output: string): GitLogEntry[] {
  const rows: GitLogEntry[] = []
  for (const line of output.split('\n')) {
    if (line === '') continue
    const [hash, subject, author, date, hashFull, refs] = line.split('\x1f')
    if (hash === undefined || subject === undefined) continue
    rows.push({
      hash,
      subject,
      author: author ?? '',
      date: date ?? '',
      hashFull: hashFull ?? hash,
      refs: refs ?? '',
    })
  }
  return rows
}

/** Run one git command; resolves with stdout, rejects with GitCommandError. */
function runGit(cwd: string, args: string[], timeoutMs = 30_000): Promise<string> {
  const full = ['-C', cwd, '--no-pager', '-c', 'color.ui=false', ...args]
  return new Promise<string>((resolvePromise, reject) => {
    const child = spawn('git', full, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new GitCommandError(`git ${args[0] ?? ''} timed out after ${timeoutMs}ms`, 'git-error', args.join(' ')))
    }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(new GitCommandError(`cannot run git: ${error.message}`, 'git-error', args.join(' ')))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) {
        resolvePromise(stdout)
      } else {
        reject(new GitCommandError(stderr.trim() || `git exited with ${String(code)}`, 'git-error', args.join(' ')))
      }
    })
  })
}

/** Cap on child directories probed by the workspace-container fallback scan.
 *  A home-directory cwd can hold hundreds of visible folders (Library, iCloud
 *  mounts…); probing them all serially is what froze the panel in #369. */
const DISCOVERY_LIMIT = 200
/** Per-probe and direct-discovery budget. `rev-parse` is millisecond-scale on
 *  a healthy checkout; a probe that needs longer is a stalled mount and is
 *  better abandoned than waited on. */
const DISCOVERY_TIMEOUT_MS = 5_000
/** Discovery results are cheap to recompute but expensive to storm: the panel
 *  polls every 2s and each poll fans out into several git.* calls that all
 *  resolve the same roots. A short TTL keeps fan-out at one scan per cwd. */
const DISCOVERY_CACHE_TTL_MS = 60_000

const repoRootsCache = new Map<string, { roots: string[]; expires: number }>()
const repoRootsInFlight = new Map<string, Promise<string[]>>()

/** Whether the directory is inside a git work tree (exit-0 `git rev-parse`).
 *  Probe timeout is short: a cwd on a stalled mount must not hold the panel
 *  hostage for the full command budget (issue #369).
 * @param cwd - directory probed via `git -C`.
 * @returns true when `git rev-parse --is-inside-work-tree` answers `true`; false on any failure.
 */
export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    const out = await runGit(cwd, ['rev-parse', '--is-inside-work-tree'], DISCOVERY_TIMEOUT_MS)
    return out.trim() === 'true'
  } catch {
    return false
  }
}

/** The repository top level containing `cwd` (`git rev-parse --show-toplevel`). */
async function directRepoRoot(cwd: string): Promise<string> {
  const out = await runGit(cwd, ['rev-parse', '--show-toplevel'], DISCOVERY_TIMEOUT_MS)
  return out.trim()
}

/** Discover the current repository or direct child repositories. Results are
 *  cached per cwd and concurrent callers share one in-flight scan, so opening
 *  the panel (three parallel git.* requests) costs a single discovery pass.
 * @param cwd - directory discovery starts from.
 * @returns the containing repository's root when cwd is inside one, otherwise
 *  the discovered direct child repositories; empty when neither applies.
 */
export function repoRoots(cwd: string): Promise<string[]> {
  const cached = repoRootsCache.get(cwd)
  if (cached !== undefined && cached.expires > Date.now()) return Promise.resolve(cached.roots)
  const pending = repoRootsInFlight.get(cwd)
  if (pending !== undefined) return pending
  const promise = discoverRepoRoots(cwd).then(
    (roots) => {
      repoRootsCache.set(cwd, { roots, expires: Date.now() + DISCOVERY_CACHE_TTL_MS })
      repoRootsInFlight.delete(cwd)
      return roots
    },
    (error: unknown) => {
      repoRootsInFlight.delete(cwd)
      throw error
    },
  )
  repoRootsInFlight.set(cwd, promise)
  return promise
}

async function discoverRepoRoots(cwd: string): Promise<string[]> {
  try {
    return [await directRepoRoot(cwd)]
  } catch {
    const entries = await readdir(cwd, { withFileTypes: true }).catch(() => [])
    const roots: string[] = []
    for (const entry of entries
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
      .sort((left, right) => left.name.localeCompare(right.name))
      .slice(0, DISCOVERY_LIMIT)) {
      try {
        const root = await directRepoRoot(join(cwd, entry.name))
        if (!roots.some(existing => pathIdentity(existing) === pathIdentity(root))) roots.push(root)
      } catch {
        // Ordinary child directory; keep discovering sibling repositories.
      }
    }
    return roots
  }
}

/**
 * Resolve the selected repository, defaulting to the first discovered root.
 * @param cwd - session working directory used for discovery.
 * @param selected - client-selected root, matched against discovery by platform identity.
 * @returns the matched root, or the first discovered root; rejects with `not-repo` when none exists.
 */
export async function repoRoot(cwd: string, selected?: string): Promise<string> {
  const roots = await repoRoots(cwd)
  if (roots.length === 0) throw new GitCommandError('not a git repository', 'not-repo', 'rev-parse')
  // Git for Windows may return forward-slash roots while callers pass
  // backslashes (or vice-versa); compare via the platform-aware identity.
  if (selected !== undefined) {
    const identity = pathIdentity(selected)
    const match = roots.find(root => pathIdentity(root) === identity)
    if (match !== undefined) return match
  }
  return roots[0] as string
}

/**
 * The current branch name (`git rev-parse --abbrev-ref HEAD`; 'HEAD' when detached).
 * @param cwd - repository root or any directory inside it.
 * @returns the branch name without `refs/heads/`.
 */
export async function currentBranch(cwd: string): Promise<string> {
  const out = await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  return out.trim()
}

/** Upper bound on status rows shipped to the client. Beyond this the result
 *  is truncated (with `truncated: true`) so a pathological untracked set —
 *  e.g. the working tree discovered under a home-directory cwd — cannot
 *  freeze the browser main thread on JSON parse or list render (#369). */
const GIT_STATUS_LIMIT = 2_000

/**
 * Working-tree status (untracked included). `--untracked-files=all` lists
 * the contents of new directories as individual entries, while preserving
 * repository discovery and explicit repository selection for workspace roots.
 * @param cwd - session working directory used for discovery.
 * @param selected - client-selected repository root; defaults to the first discovered root.
 * @returns the panel snapshot; `isRepo: false` with no entries outside any repository.
 */
export async function status(cwd: string, selected?: string): Promise<GitStatusResult> {
  const repositories = await repoRoots(cwd)
  if (repositories.length === 0) return { isRepo: false, entries: [], repositories: [] }
  const root = await repoRoot(cwd, selected)
  const [branch, raw] = await Promise.all([
    currentBranch(root).catch(() => 'HEAD'),
    runGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
  ])
  const parsed = parsePorcelainZ(raw)
  const truncated = parsed.length > GIT_STATUS_LIMIT
  return {
    isRepo: true,
    branch,
    entries: truncated ? parsed.slice(0, GIT_STATUS_LIMIT) : parsed,
    truncated,
    root,
    repositories,
  }
}

/** Platform-aware identity used only for comparing absolute checkout roots. */
function pathIdentity(path: string): string {
  const absolute = resolve(path).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute
}

/** Raw usable checkout records, shared by inventory and target validation.
 * Prunable records point at missing paths and are deliberately excluded from
 * both the selector and the command-target allowlist. */
async function listedWorktrees(cwd: string): Promise<GitWorktreeRecord[]> {
  const raw = await runGit(cwd, ['worktree', 'list', '--porcelain', '-z'])
  return parseWorktreeList(raw).filter(entry => !entry.prunable)
}

/** All linked checkouts of the repository containing `cwd`, enriched with a
 * live change count. The current checkout is first so a single-worktree repo
 * preserves the old UI ordering.
 * @param cwd - session working directory used for discovery.
 * @returns the checkouts with the containing one first; empty when cwd is not a repository.
 */
export async function worktrees(cwd: string): Promise<GitWorktree[]> {
  if (!await isGitRepo(cwd)) return []
  const currentRoot = await repoRoot(cwd)
  const listed = await listedWorktrees(cwd)
  const rows = await Promise.all(listed.map(async (entry): Promise<GitWorktree> => ({
    path: entry.path,
    branch: entry.branch,
    current: pathIdentity(entry.path) === pathIdentity(currentRoot),
    // One stale/permission-raced linked checkout must not hide the valid
    // current repository from the panel. Targeted operations still fail loud.
    changes: await status(entry.path).then(result => result.entries.length, () => 0),
  })))
  return rows.sort((left, right) => Number(right.current) - Number(left.current))
}

/** Resolve an optional client-selected linked checkout. A caller may never use
 * this seam to point Git operations at an unrelated repository: the target
 * must occur in the authoritative session repository's worktree list.
 * @param cwd - session working directory whose repository validates the request.
 * @param requested - client-selected checkout root; the session cwd when undefined or ''.
 * @returns the canonical checkout path; rejects with `git-worktree` for a target
 *  outside the session repository's worktree list.
 */
export async function resolveWorktree(cwd: string, requested?: string): Promise<string> {
  if (requested === undefined || requested === '') return cwd
  const identity = pathIdentity(requested)
  const match = (await listedWorktrees(cwd)).find(entry => pathIdentity(entry.path) === identity)
  if (match === undefined) {
    throw new GitCommandError(`unknown linked worktree: ${requested}`, 'git-worktree', 'worktree list')
  }
  return match.path
}

/**
 * Diff text of the worktree (unstaged) or the index (staged).
 * @param cwd - session working directory used for discovery.
 * @param path - single path to diff; the whole tree when undefined.
 * @param staged - true diffs the index against HEAD, false the worktree against the index.
 * @param selected - client-selected repository root; defaults to the first discovered root.
 * @returns unified diff text with three context lines.
 */
export async function diff(cwd: string, path: string | undefined, staged: boolean, selected?: string): Promise<string> {
  const root = await repoRoot(cwd, selected)
  const args = ['diff', '--no-ext-diff', '--no-color', '-U3']
  if (staged) args.push('--cached')
  if (path !== undefined) args.push('--', path)
  return runGit(root, args)
}

/**
 * Stage paths (all when path is undefined); rejects with `GitCommandError` when git fails.
 * @param cwd - session working directory used for discovery.
 * @param path - path to stage; every change when undefined.
 * @param selected - client-selected repository root; defaults to the first discovered root.
 */
export async function stage(cwd: string, path: string | undefined, selected?: string): Promise<void> {
  await runGit(await repoRoot(cwd, selected), ['add', '-A', ...(path !== undefined ? ['--', path] : [])])
}

/**
 * Unstage paths (all when path is undefined); rejects with `GitCommandError` when git fails.
 * @param cwd - session working directory used for discovery.
 * @param path - path to unstage; every staged path when undefined.
 * @param selected - client-selected repository root; defaults to the first discovered root.
 */
export async function unstage(cwd: string, path: string | undefined, selected?: string): Promise<void> {
  await runGit(await repoRoot(cwd, selected), ['reset', '-q', ...(path !== undefined ? ['--', path] : [])])
}

/**
 * Commit the staged changes with a message (global identity untouched); rejects
 * with `GitCommandError` when git fails.
 * @param cwd - session working directory used for discovery.
 * @param message - commit message, passed to `git commit -m` verbatim.
 * @param selected - client-selected repository root; defaults to the first discovered root.
 */
export async function commit(cwd: string, message: string, selected?: string): Promise<void> {
  await runGit(await repoRoot(cwd, selected), ['commit', '-m', message])
}

/**
 * Branch names (current first).
 * @param cwd - session working directory used for discovery.
 * @param selected - client-selected repository root; defaults to the first discovered root.
 * @returns local branch names with the current branch first.
 */
export async function branches(cwd: string, selected?: string): Promise<{ current: string; names: string[] }> {
  const root = await repoRoot(cwd, selected)
  const [current, raw] = await Promise.all([
    currentBranch(root).catch(() => 'HEAD'),
    runGit(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']),
  ])
  const names = raw.split('\n').filter(line => line !== '')
  return { current, names: names.includes(current) ? names : [current, ...names] }
}

/**
 * Switch to an existing branch; rejects with `GitCommandError` when git fails.
 * @param cwd - session working directory used for discovery.
 * @param branch - existing local branch to check out.
 * @param selected - client-selected repository root; defaults to the first discovered root.
 */
export async function checkout(cwd: string, branch: string, selected?: string): Promise<void> {
  await runGit(await repoRoot(cwd, selected), ['checkout', branch])
}

/**
 * Recent commit history (newest first), lazily pageable via skip/count.
 * @param cwd - session working directory used for discovery.
 * @param count - page size.
 * @param skip - number of newer commits to skip.
 * @param selected - client-selected repository root; defaults to the first discovered root.
 * @returns the requested page, newest first.
 */
export async function log(cwd: string, count = 30, skip = 0, selected?: string): Promise<GitLogEntry[]> {
  const raw = await runGit(await repoRoot(cwd, selected), [
    'log', '-n', String(count), '--skip', String(skip), '--decorate=short',
    '--pretty=format:%h%x1f%s%x1f%an%x1f%ai%x1f%H%x1f%D',
  ])
  return parseLogLines(raw)
}

/**
 * Content of a file at a revision (`git show <rev>:<path>`), or null when the
 * revision has no such path (a new/untracked file has no HEAD side).
 * @param cwd - session working directory used for discovery.
 * @param rev - revision to read (e.g. `HEAD`, a commit hash).
 * @param path - workspace path, made repository-relative before the lookup.
 * @param selected - client-selected repository root; defaults to the first discovered root.
 * @returns the file content, or null when the path is absent at the revision (any git failure included).
 */
export async function show(cwd: string, rev: string, path: string, selected?: string): Promise<string | null> {
  try {
    const root = await repoRoot(cwd, selected)
    // `git show <rev>:<path>` resolves the path against the repository tree
    // and rejects an absolute form, so the workspace-bound absolute path must
    // be expressed relative to the repo root. The cwd may differ from git's
    // canonical root on symlinked platforms (macOS /tmp → /private/tmp), so
    // canonicalize the enclosing directory before relativizing; a path whose
    // directory is gone is already rooted in the canonical repo root.
    const normalized = isAbsolute(path) && existsSync(dirname(path))
      ? join(realpathSync.native(dirname(path)), basename(path))
      : path
    const treePath = isAbsolute(normalized) ? relative(root, normalized) : normalized
    return await runGit(root, ['show', `${rev}:${treePath}`])
  } catch {
    return null
  }
}

/** Full patch text of one commit (`git show` with the commit header suppressed).
 *  Merge commits show their diff against the first parent (`-m --first-parent`
 *  is a no-op for regular commits), so a history click always has content.
 * @param cwd - session working directory used for discovery.
 * @param hash - commit to render.
 * @param selected - client-selected repository root; defaults to the first discovered root.
 * @returns the patch text without the commit header.
 */
export async function commitDiff(cwd: string, hash: string, selected?: string): Promise<string> {
  return runGit(await repoRoot(cwd, selected), ['show', '--no-ext-diff', '--no-color', '--format=', '-m', '--first-parent', hash])
}

/**
 * Discard the worktree changes of one path (`git checkout -- <path>`; the index is
 * untouched); rejects with `GitCommandError` when git fails.
 * @param cwd - session working directory used for discovery.
 * @param path - path whose worktree changes are discarded.
 * @param selected - client-selected repository root; defaults to the first discovered root.
 */
export async function discard(cwd: string, path: string, selected?: string): Promise<void> {
  await runGit(await repoRoot(cwd, selected), ['checkout', '--', path])
}

/**
 * Revert one commit onto the current branch with an auto-generated message; rejects
 * with `GitCommandError` when git fails.
 * @param cwd - session working directory used for discovery.
 * @param hash - commit to revert.
 * @param selected - client-selected repository root; defaults to the first discovered root.
 */
export async function revert(cwd: string, hash: string, selected?: string): Promise<void> {
  await runGit(await repoRoot(cwd, selected), ['revert', '--no-edit', hash])
}

/**
 * Cherry-pick one commit onto the current branch; rejects with `GitCommandError` when git fails.
 * @param cwd - session working directory used for discovery.
 * @param hash - commit to cherry-pick.
 * @param selected - client-selected repository root; defaults to the first discovered root.
 */
export async function cherryPick(cwd: string, hash: string, selected?: string): Promise<void> {
  await runGit(await repoRoot(cwd, selected), ['cherry-pick', hash])
}
