// The fixture's in-memory file system: the read-only workspace-file remotes
// every world shares, plus the directory-picker remotes whose browse tree is
// created per world.

import type { DirectoryListing as FixtureDirectoryListing } from '@deepseek-ai/dsh-host-directory-picker/types'
import type { ConnectionRpcResult } from '../rpc.ts'

/**
 * The Session workspace the replayed conversation writes into: `list` walks a
 * fixed tree under it so the file-tree tab has directories, files, one entry
 * of neither kind, and one cut listing to draw.
 */
export const WORKSPACE_FILES_ROOT = '/tmp/fixture'
type FixtureWorkspaceEntry = { name: string; type: 'file' | 'directory' | 'other'; size?: number }
const workspaceFileTree = new Map<string, FixtureWorkspaceEntry[]>([
  ['', [
    { name: '.gitignore', type: 'file', size: 24 },
    { name: 'dev.sock', type: 'other' },
    { name: 'notes', type: 'directory' },
    { name: 'package.json', type: 'file', size: 512 },
    { name: 'README.md', type: 'file', size: 640 },
    { name: 'src', type: 'directory' },
  ]],
  ['notes', [
    { name: 'demo.txt', type: 'file', size: 14 },
    { name: 'new-demo.txt', type: 'file', size: 14 },
  ]],
  ['src', [
    { name: 'config.ts', type: 'file', size: 211 },
    { name: 'index.ts', type: 'file', size: 88 },
    { name: 'lib', type: 'directory' },
  ]],
  ['src/lib', Array.from({ length: 24 }, (_, index) => ({
    name: `module-${String(index + 1).padStart(2, '0')}.ts`,
    type: 'file' as const,
    size: 96 + index,
  }))],
])
/** Resolve a `list` argument to its workspace-relative path, or undefined when it leaves the root. */
const workspaceFilePath = (path: string): string | undefined => {
  const segments: string[] = []
  for (const segment of (path.startsWith('/') ? path : `${WORKSPACE_FILES_ROOT}/${path}`).split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  const absolute = `/${segments.join('/')}`
  if (absolute !== WORKSPACE_FILES_ROOT && !absolute.startsWith(`${WORKSPACE_FILES_ROOT}/`)) return undefined
  return absolute.slice(WORKSPACE_FILES_ROOT.length + 1)
}
// Page cap mirrored from the Host default so an over-limit request fails here too.
const WORKSPACE_FILE_PAGE_LINES = 5000
/**
 * Sample text for any readable path: a heading plus two lines of copy. The
 * replayed conversation's `demo` files, and any `huge` path, run past two
 * default pages so paging can be exercised without a real workspace.
 */
const workspaceFileLines = (path: string): string[] => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const head = [`# ${name}`, '', 'fixture 模式下的示例文本，用于验收侧栏的文本预览。', '真实构建从工作区读取同名文件。']
  return path.includes('demo') || path.includes('huge')
    ? [...head, ...Array.from({ length: 12_000 }, (_, index) => `第 ${index + 5} 行：用于验收分页与滚动的长文本样本。`)]
    : head
}
/**
 * Workspace text reads under `?fixture`.
 *
 * The sample content is deliberately more than one shape: the panel's states
 * (text, oversized, unreadable) are only demonstrable if the fixture can
 * produce each of them, and a preview that can only ever succeed hides its
 * own failure rendering.
 */
export const workspaceFileRemotes = {
  list(path: string): ConnectionRpcResult<{
    path: string
    entries: readonly FixtureWorkspaceEntry[]
    truncated: boolean
  }> {
    if (path.length === 0) {
      return { ok: false, error: { code: 'gateway/bad-request', message: 'path is required', details: {} } }
    }
    const relative = workspaceFilePath(path)
    if (relative === undefined) {
      return {
        ok: false,
        error: { code: 'workspace-file/outside-workspace', message: `${path} is outside the workspace`, details: { path } },
      }
    }
    const entries = workspaceFileTree.get(relative)
    if (entries === undefined) {
      const cut = relative.lastIndexOf('/')
      const name = relative.slice(cut + 1)
      const sibling = workspaceFileTree.get(cut === -1 ? '' : relative.slice(0, cut))?.find(entry => entry.name === name)
      if (sibling === undefined) {
        return { ok: false, error: { code: 'workspace-file/not-found', message: `no entry at ${path}`, details: { path } } }
      }
      return {
        ok: false,
        error: {
          code: 'workspace-file/not-directory',
          message: `${path} is a ${sibling.type}`,
          details: { path, kind: sibling.type === 'file' ? 'file' : 'other' },
        },
      }
    }
    return { ok: true, value: { path: relative, entries, truncated: relative === 'src/lib' } }
  },
  read(path: string, range: { offset?: number; limit?: number }): ConnectionRpcResult<{
    absolutePath: string
    version: string
    bytes: number
    offset: number
    text: string
    lines: number
    eof: boolean
  }> {
    const located = workspaceFileRemotes.stat(path)
    if (!located.ok) return located
    const offset = range.offset ?? 1
    const limit = range.limit ?? WORKSPACE_FILE_PAGE_LINES
    if (!Number.isInteger(offset) || offset < 1 || !Number.isInteger(limit) || limit < 1 || limit > WORKSPACE_FILE_PAGE_LINES) {
      return { ok: false, error: { code: 'gateway/bad-request', message: 'offset and limit must be positive integers within the page cap', details: {} } }
    }
    const lines = workspaceFileLines(path)
    const page = lines.slice(offset - 1, offset - 1 + limit)
    return {
      ok: true,
      value: {
        ...located.value,
        offset,
        text: page.join('\n'),
        lines: page.length,
        eof: offset - 1 + limit >= lines.length,
      },
    }
  },
  stat(path: string): ConnectionRpcResult<{ absolutePath: string; version: string; bytes: number }> {
    if (path.length === 0) {
      return { ok: false, error: { code: 'gateway/bad-request', message: 'path is required', details: {} } }
    }
    if (path.endsWith('.png') || path.endsWith('.bin')) {
      return {
        ok: false,
        error: { code: 'workspace-file/not-text', message: `${path} is not UTF-8 text`, details: { path } },
      }
    }
    return {
      ok: true,
      value: {
        absolutePath: path.startsWith('/') ? path : `/${path}`,
        version: 'fx-v1',
        bytes: new TextEncoder().encode(workspaceFileLines(path).join('\n')).byteLength,
      },
    }
  },
}

interface FixtureDirectoryPickerRemotes {
  pick(): ConnectionRpcResult<string | null>
  list(path?: string): ConnectionRpcResult<FixtureDirectoryListing>
  createDirectory(parent: string, name: string): ConnectionRpcResult<string>
}

/**
 * Build the fixture's directory-picker remotes over a browse tree rooted at
 * `home`. Each call returns an independent tree, so directories a world
 * creates stay inside that world.
 * @param home - absolute path of the picker's home directory; must be
 *   `/home/fixture`, the leaf the tree's fixed `/` → `/home` ancestors
 *   descend to. Any other value lists a `fixture` child that is not under it.
 * @returns the picker remotes the connection RPC dispatch delegates to.
 */
export function createDirectoryPickerRemotes(home: string): FixtureDirectoryPickerRemotes {
  // In-memory browse tree behind the fixture's `browse` picker capability —
  // deterministic content mirroring the design mock so assembled Web tests
  // and snapshots can walk it. Leaves are materialized lazily: a child listed
  // by its parent lists as empty until something is created inside it.
  const directoryTree = new Map<string, string[]>([
    ['/', ['home']],
    ['/home', ['fixture']],
    [home, ['Documents', 'Downloads', '.config']],
    [`${home}/Documents`, [
      'project', 'deepseek-iOS', 'deepseek-android', 'deepseek-platform',
      'deepseek-web', 'deepseek-harness', 'deepseek-app', 'deepseek-landing-blog',
    ]],
  ])
  const childrenOf = (path: string): string[] | undefined => {
    const known = directoryTree.get(path)
    if (known !== undefined) return known
    const parent = path.slice(0, path.lastIndexOf('/')) || '/'
    const name = path.slice(path.lastIndexOf('/') + 1)
    return directoryTree.get(parent)?.includes(name) === true ? [] : undefined
  }
  const crumbsOf = (path: string): { name: string; path: string; hidden: boolean }[] => {
    const crumbs = [{ name: '/', path: '/', hidden: false }]
    let acc = ''
    for (const segment of path.split('/').filter(Boolean)) {
      acc += `/${segment}`
      crumbs.push({ name: segment, path: acc, hidden: false })
    }
    return crumbs
  }

  /**
   * Canonical fixture implementation of the generated Directory Picker Remote
   * contract. The pick is deterministic — the keyless lanes drive the full
   * pick-then-adopt path without an OS chooser — over the same design-mock
   * tree the browse primitives serve.
   */
  const directoryPickerRemotes: FixtureDirectoryPickerRemotes = {
    pick() {
      return { ok: true, value: `${home}/Documents/project` }
    },
    list(path?: string) {
      const target = path ?? home
      const children = childrenOf(target)
      if (children === undefined) {
        return {
          ok: false,
          error: { code: 'directory-picker/unreadable', message: `cannot list ${target}: not in the fixture tree`, details: { path: target } },
        }
      }
      return {
        ok: true,
        value: {
          path: target,
          home,
          crumbs: crumbsOf(target),
          entries: [...children].sort((a, b) => a.localeCompare(b))
            .map(name => ({ name, path: target === '/' ? `/${name}` : `${target}/${name}`, hidden: name.startsWith('.') })),
          // The fixture tree is tiny; no level ever reaches a backend bound.
          truncated: false,
        },
      }
    },
    createDirectory(parent: string, name: string) {
      const children = childrenOf(parent)
      if (children === undefined) {
        return { ok: false, error: { code: 'directory-picker/create-failed', message: `missing parent ${parent}`, details: { path: parent } } }
      }
      // Same root special case as list's entry paths: a plain join under '/'
      // would mint '//name' and fork the tree's identity.
      const target = parent === '/' ? `/${name}` : `${parent}/${name}`
      if (children.includes(name)) {
        return { ok: false, error: { code: 'directory-picker/exists', message: `${target} already exists`, details: { path: target } } }
      }
      directoryTree.set(parent, [...children, name])
      directoryTree.set(target, [])
      return { ok: true, value: target }
    },
  }
  return directoryPickerRemotes
}
