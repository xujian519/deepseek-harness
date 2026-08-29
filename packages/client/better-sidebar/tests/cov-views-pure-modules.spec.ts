/**
 * Coverage round for the pure client modules: the terminal-link scheme gate
 * without a page `window`, the local-image resolver's Windows/UNC/relative
 * roots, the jobs tree walk's non-subagent chain break and the settled-row
 * ordering fallbacks, the loopback allowlist matcher's port entries, and the
 * upload queue's degenerate inputs (unnamed files, non-file drops, non-API
 * failures).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, SidebarApiError, type SessionScope } from '../src/client/api.ts'
import {
  isAllowedLoopbackUrl,
  normalizeBrowserUrl,
  parseLoopbackAllowlist,
} from '../src/client/browser.ts'
import { openTerminalUrl } from '../src/client/terminal-links.ts'
import { resolveLocalMediaDest, rewriteLocalImageUrls } from '../src/client/markdown-images.ts'
import { orderJobs, treeSessionIds } from '../src/client/subagent-jobs.ts'
import {
  MAX_UPLOAD_BYTES, uploadItemsFromDrop, uploadItemsFromFiles, uploadToDir, type UploadItem,
} from '../src/client/upload.ts'
import type { SidebarSessionSummary, SidebarJobView } from '../src/context-types.ts'

const scope: SessionScope = { sessionId: 's1', cwd: '/ws' }
const ORIGIN = 'http://127.0.0.1:3080'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('openTerminalUrl without a page window', () => {
  it('rejects before parsing when no window exists (the node test lane)', () => {
    expect(typeof window).toBe('undefined')
    expect(openTerminalUrl('https://example.com/')).toBe(false)
  })
})

describe('resolveLocalMediaDest path roots', () => {
  it('resolves a destination against the file\'s own directory when the path has no slash', () => {
    const url = resolveLocalMediaDest('./img.png', scope, 'README.md', ORIGIN)
    const path = new URL(url).searchParams.get('path')
    expect(path).toBe('/img.png')
  })

  it('keeps a UNC destination whole (double-backslash root, backslash separators)', () => {
    const unc = '\\\\srv\\share\\img.png'
    const url = resolveLocalMediaDest(unc, scope, '/ws/README.md', ORIGIN)
    const path = new URL(url).searchParams.get('path')
    expect(path).toBe(unc)
    // Relative resolution inside a backslash directory keeps backslashes too.
    const nested = resolveLocalMediaDest('sub\\img.png', scope, '\\\\srv\\share\\README.md', ORIGIN)
    expect(new URL(nested).searchParams.get('path')).toBe('\\\\srv\\share\\sub\\img.png')
  })
})

describe('rewriteLocalImageUrls root coverage', () => {
  it('rewrites a bare relative destination without a leading separator', () => {
    const out = rewriteLocalImageUrls('![u](img.png)', scope, '/ws/README.md', ORIGIN)
    expect(out).toContain(`(${ORIGIN}/sidebar/file?sessionId=s1&path=%2Fws%2Fimg.png&cwd=%2Fws)`)
  })

  it('rewrites a UNC destination without collapsing its double backslash', () => {
    const out = rewriteLocalImageUrls('![u](\\\\srv\\share\\img.png)', scope, '/ws/README.md', ORIGIN)
    expect(out).toContain('path=%5C%5Csrv%5Cshare%5Cimg.png')
  })
})

describe('treeSessionIds chain break', () => {
  it('excludes a non-subagent session even when its id sits in the map', () => {
    const byId = {
      root: summary('root'),
      user: summary('user'),
      child: summary('child', { origin: 'subagent', parentId: 'user' }),
    }
    expect(treeSessionIds(byId, 'root')).toEqual(new Set(['root']))
    // The user session's own subtree (a subagent child hangs off it) is in.
    expect(treeSessionIds(byId, 'user')).toEqual(new Set(['user', 'child']))
  })
})

describe('orderJobs settled-row fallbacks', () => {
  const row = (id: string, startedAt: number, finishedAt?: number) => ({
    ownerSessionId: 'root',
    ownerTitle: 'root',
    job: settled(id, startedAt, finishedAt),
  })

  it('falls back to startedAt for a settled job that never recorded finishedAt', () => {
    const rows = [
      row('old', 1_000, 5_000),
      row('no-finish', 2_000, undefined),
      row('mid', 3_000, 4_000),
    ]
    // Newest finish first; the finish-less row settles at its start time.
    expect(orderJobs(rows).map(r => r.job.id)).toEqual(['old', 'mid', 'no-finish'])
  })

  it('breaks a finishedAt tie by start order (no reliance on host map iteration)', () => {
    const rows = [row('late', 2_000, 9_000), row('early', 1_000, 9_000)]
    expect(orderJobs(rows).map(r => r.job.id)).toEqual(['early', 'late'])
  })
})

describe('loopback allowlist matching', () => {
  it('a host:port entry allows exactly that authority', () => {
    const matcher = parseLoopbackAllowlist('localhost:3000')
    expect(matcher('localhost', '3000')).toBe(true)
    expect(matcher('localhost', '8080')).toBe(false)
    // A portless match falls back to the empty-port rule: default-port URLs
    // carry no port, so the host entry answers only an exact host hit.
    expect(matcher('otherhost', '')).toBe(false)
  })

  it('a bare-host entry allows every port including the empty default port', () => {
    const matcher = parseLoopbackAllowlist('MyHost')
    expect(matcher('myhost', '4000')).toBe(true)
    expect(matcher('myhost', '')).toBe(true)
    expect(matcher('other', '4000')).toBe(false)
  })

  it('isAllowedLoopbackUrl refuses malformed URLs and non-loopback hosts', () => {
    expect(isAllowedLoopbackUrl('not a url', 'localhost')).toBe(false)
    expect(isAllowedLoopbackUrl('https://example.com/', 'localhost')).toBe(false)
    expect(isAllowedLoopbackUrl('https://localhost/', '   ')).toBe(false)
  })

  it('isAllowedLoopbackUrl answers the matcher for loopback URLs', () => {
    expect(isAllowedLoopbackUrl('http://localhost:3000/app', 'localhost:3000')).toBe(true)
    expect(isAllowedLoopbackUrl('http://localhost:9999/app', 'localhost:3000')).toBe(false)
  })

  it('the navigation gate allows an allowlisted loopback and blocks a non-matching one', () => {
    // A bare `localhost:3000` has no recognized scheme, so it normalizes to https.
    expect(normalizeBrowserUrl('localhost:3000', ORIGIN, 'localhost:3000'))
      .toEqual({ kind: 'ok', url: 'https://localhost:3000/' })
    expect(normalizeBrowserUrl('http://localhost:3000/', ORIGIN, 'localhost:3000'))
      .toEqual({ kind: 'ok', url: 'http://localhost:3000/' })
    expect(normalizeBrowserUrl('localhost:9999', ORIGIN, 'localhost:3000'))
      .toEqual({ kind: 'blocked', reason: 'loopback' })
  })
})

describe('upload degenerate inputs', () => {
  /** A File with an optional webkitRelativePath (folder entries). */
  const fileOf = (name: string, rel?: string): File => {
    const file = new File(['x'], name)
    if (rel !== undefined) Object.defineProperty(file, 'webkitRelativePath', { value: rel })
    return file
  }
  const items = (names: string[]): UploadItem[] =>
    names.map(name => ({ file: fileOf(name), relativePath: name }))

  it('drops a picker entry with neither a relative path nor a name', () => {
    expect(uploadItemsFromFiles([fileOf('')])).toEqual([])
  })

  it('skips a drop entry that is neither a file nor a directory', async () => {
    const neither = { isFile: false, isDirectory: false, name: 'weird' } as unknown as FileSystemEntry
    const data = { files: [], items: [{ kind: 'file', webkitGetAsEntry: () => neither }] } as unknown as DataTransfer
    expect(await uploadItemsFromDrop(data)).toEqual([])
  })

  it('falls back to the flat file list when no drop item carries an entry', async () => {
    const data = {
      files: [fileOf('a.txt')],
      items: [{ kind: 'string', webkitGetAsEntry: () => null }],
    } as unknown as DataTransfer
    expect((await uploadItemsFromDrop(data)).map(item => item.relativePath)).toEqual(['a.txt'])
  })

  it('records a non-API route failure without a wire code', async () => {
    vi.spyOn(api, 'uploadFile').mockRejectedValueOnce(new Error('network died'))
    const results = await uploadToDir(scope, '/ws', items(['a.txt']))
    expect(results).toEqual([{ relativePath: 'a.txt', ok: false, code: undefined, error: 'network died' }])
  })

  it('stringifies a rejection that is not an Error', async () => {
    vi.spyOn(api, 'uploadFile').mockRejectedValueOnce('plain string failure')
    const results = await uploadToDir(scope, '/ws', items(['a.txt']))
    expect(results).toEqual([{
      relativePath: 'a.txt', ok: false, code: undefined, error: 'plain string failure',
    }])
    // Sanity: the API-error branch still carries its wire code.
    vi.spyOn(api, 'uploadFile').mockRejectedValueOnce(new SidebarApiError('forbidden', 'no'))
    expect((await uploadToDir(scope, '/ws', items(['b.txt'])))[0]?.code).toBe('forbidden')
    expect(MAX_UPLOAD_BYTES).toBeGreaterThan(0)
  })
})

/** A settled job view (completed, optionally without a finishedAt stamp). */
function settled(id: string, startedAt: number, finishedAt?: number): SidebarJobView {
  return {
    id, kind: 'bash', label: id, status: 'completed', startedAt,
    ...(finishedAt !== undefined ? { finishedAt } : {}),
  }
}

function summary(id: string, over: Partial<SidebarSessionSummary> = {}): SidebarSessionSummary {
  return { id, displayTitle: `title-${id}`, ...over }
}
