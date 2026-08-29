/**
 * Client API wire contract (coverage): every `/sidebar/api` call posts the
 * session scope as JSON to the method route, folds cwd/repoRoot/worktree into
 * the payload only when present, and maps every failure shape (network throw,
 * invalid JSON, non-ok status, ok:false, missing value) to a
 * {@link SidebarApiError} carrying the wire code. The raw upload route keeps
 * the body as-is and re-throws an AbortError untouched.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  api,
  downloadUrl,
  htmlUrl,
  mediaUrl,
  SidebarApiError,
  type SessionScope,
} from '../src/client/api.ts'

/** The recorded fetch call (URL + init) of the last request. */
let lastUrl = ''
let lastInit: RequestInit | undefined
/** Wrapper marking a fetch rejection (the rejection value may be any type). */
class Reject {
  constructor(readonly value: unknown) {}
}
/** The response (or rejection) the next call sees. */
let next: Response | Reject = { ok: true, status: 200, json: async () => ({ ok: true, value: { echoed: true } }) } as unknown as Response

function jsonResponse(value: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => ({ ok: true, value }) } as unknown as Response
}

function wireResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response
}

afterEach(() => {
  vi.restoreAllMocks()
})

/** The JSON payload of the recorded request (the api surface posts stringified JSON). */
function postedJson(init?: RequestInit): unknown {
  const { body } = init ?? {}
  if (typeof body !== 'string') throw new Error(`expected a stringified JSON body, got ${typeof body}`)
  return JSON.parse(body)
}

/** Install the fetch stub returning `next` and recording the request. */
function stubFetch(): void {
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    lastUrl = input
    lastInit = init
    if (next instanceof Reject) throw next.value
    return next
  }))
}

const scope: SessionScope = { sessionId: 's1', cwd: '/w', repoRoot: '/w/repo' }

describe('api surface payload folding', () => {
  it('sessionCwd posts the scope with cwd and repoRoot', async () => {
    stubFetch()
    await api.sessionCwd(scope)
    expect(lastUrl).toBe('/sidebar/api/session.cwd')
    expect(postedJson(lastInit)).toEqual({ sessionId: 's1', cwd: '/w', repoRoot: '/w/repo' })
  })

  it('omits empty-string cwd/repoRoot from the payload', async () => {
    stubFetch()
    await api.sessionCwd({ sessionId: 's1', cwd: '', repoRoot: '' })
    expect(postedJson(lastInit)).toEqual({ sessionId: 's1' })
  })

  it('fsTree and fsSearch carry path/query', async () => {
    stubFetch()
    await api.fsTree(scope, '/w/src')
    expect(lastUrl).toBe('/sidebar/api/fs.tree')
    expect(postedJson(lastInit)).toMatchObject({ sessionId: 's1', cwd: '/w', path: '/w/src' })
    await api.fsSearch(scope, 'needle')
    expect(lastUrl).toBe('/sidebar/api/fs.search')
    expect(postedJson(lastInit)).toMatchObject({ query: 'needle' })
  })

  it('fsRead and fsWrite carry the path (write adds the content)', async () => {
    stubFetch()
    await api.fsRead(scope, '/w/a.ts')
    expect(lastUrl).toBe('/sidebar/api/fs.read')
    await api.fsWrite(scope, '/w/a.ts', 'body')
    expect(lastUrl).toBe('/sidebar/api/fs.write')
    expect(postedJson(lastInit)).toMatchObject({ path: '/w/a.ts', content: 'body' })
  })

  it('git methods fold the worktree in only when non-empty', async () => {
    stubFetch()
    await api.gitStatus(scope)
    expect(postedJson(lastInit)).not.toHaveProperty('worktree')
    await api.gitStatus(scope, '')
    expect(postedJson(lastInit)).not.toHaveProperty('worktree')
    await api.gitStatus(scope, 'wt')
    expect(postedJson(lastInit)).toMatchObject({ worktree: 'wt' })
    await api.gitWorktrees(scope)
    expect(lastUrl).toBe('/sidebar/api/git.worktrees')
  })

  it('gitDiff carries the path only when given, plus the staged flag', async () => {
    stubFetch()
    await api.gitDiff(scope, undefined, true, 'wt')
    expect(postedJson(lastInit)).toEqual({ sessionId: 's1', cwd: '/w', repoRoot: '/w/repo', worktree: 'wt', staged: true })
    await api.gitDiff(scope, '/w/a.ts', false)
    expect(postedJson(lastInit)).toMatchObject({ path: '/w/a.ts', staged: false })
    expect(postedJson(lastInit)).not.toHaveProperty('worktree')
  })

  it('gitStage/gitUnstage/gitCommit/gitCheckout/gitBranch thread the scope', async () => {
    stubFetch()
    await api.gitStage(scope, '/w/a.ts', 'wt')
    expect(postedJson(lastInit)).toMatchObject({ path: '/w/a.ts', worktree: 'wt' })
    await api.gitUnstage(scope)
    expect(postedJson(lastInit)).not.toHaveProperty('path')
    await api.gitCommit(scope, 'msg', 'wt')
    expect(postedJson(lastInit)).toMatchObject({ message: 'msg', worktree: 'wt' })
    await api.gitBranch(scope)
    expect(lastUrl).toBe('/sidebar/api/git.branch')
    await api.gitCheckout(scope, 'main')
    expect(postedJson(lastInit)).toMatchObject({ branch: 'main' })
    await api.gitStage(scope)
    expect(postedJson(lastInit)).not.toHaveProperty('path')
    await api.gitUnstage(scope, '/w/a.ts', 'wt')
    expect(postedJson(lastInit)).toMatchObject({ path: '/w/a.ts', worktree: 'wt' })
    await api.subagentsLive('root-session')
    expect(lastUrl).toBe('/sidebar/api/subagents.live')
    expect(postedJson(lastInit)).toEqual({ rootSessionId: 'root-session' })
  })

  it('gitLog omits unset paging, gitCommitDiff/gitDiscard/gitRevert/gitCherryPick carry their target', async () => {
    stubFetch()
    await api.gitLog(scope)
    expect(postedJson(lastInit)).not.toHaveProperty('count')
    await api.gitLog(scope, 10, 5, 'wt')
    expect(postedJson(lastInit)).toMatchObject({ count: 10, skip: 5, worktree: 'wt' })
    await api.gitCommitDiff(scope, 'abc')
    expect(postedJson(lastInit)).toMatchObject({ hash: 'abc' })
    await api.gitDiscard(scope, '/w/a.ts')
    expect(lastUrl).toBe('/sidebar/api/git.discard')
    await api.gitRevert(scope, 'abc')
    expect(lastUrl).toBe('/sidebar/api/git.revert')
    await api.gitCherryPick(scope, 'abc')
    expect(lastUrl).toBe('/sidebar/api/git.cherry-pick')
  })

  it('terminal/jobs helpers post their payloads', async () => {
    stubFetch()
    await api.ptyClose(scope, 'tab-1')
    expect(lastUrl).toBe('/sidebar/api/pty.close')
    expect(postedJson(lastInit)).toMatchObject({ tab: 'tab-1' })
    await api.agentPtyClose('uuid-1')
    expect(lastUrl).toBe('/sidebar/api/agent-pty.close')
    expect(postedJson(lastInit)).toEqual({ uuid: 'uuid-1' })
    await api.terminalDeps()
    expect(lastUrl).toBe('/sidebar/api/terminal.deps')
    await api.jobOutput(scope, 'job-1')
    expect(lastUrl).toBe('/sidebar/api/jobs.output')
    await api.jobKill(scope, 'job-1')
    expect(postedJson(lastInit)).not.toHaveProperty('reason')
    await api.jobKill(scope, 'job-1', 'user')
    expect(postedJson(lastInit)).toMatchObject({ reason: 'user' })
  })

  it('sidechat helpers post thread payloads; start defaults the question to empty', async () => {
    stubFetch()
    await api.sidechatStart('s1')
    expect(postedJson(lastInit)).toEqual({ sessionId: 's1', question: '' })
    await api.sidechatStart('s1', 'hello')
    expect(postedJson(lastInit)).toEqual({ sessionId: 's1', question: 'hello' })
    await api.sidechatPrompt('c1', 'text')
    expect(lastUrl).toBe('/sidebar/api/sidechat.prompt')
    await api.sidechatCancel('c1')
    expect(lastUrl).toBe('/sidebar/api/sidechat.cancel')
    await api.sidechatDispose('c1')
    expect(lastUrl).toBe('/sidebar/api/sidechat.dispose')
    await api.sidechatInfo('c1')
    expect(lastUrl).toBe('/sidebar/api/sidechat.info')
  })

  it('settings/shell/probe/open helpers post their payloads', async () => {
    stubFetch()
    await api.shellGet()
    expect(lastUrl).toBe('/sidebar/api/shell.get')
    await api.settingsGet()
    expect(lastUrl).toBe('/sidebar/api/settings.get')
    await api.settingsUpdate({ openByDefault: true })
    expect(postedJson(lastInit)).toEqual({ patch: { openByDefault: true } })
    await api.settingsUpdate({ openByDefault: true }, 7)
    expect(postedJson(lastInit)).toEqual({ patch: { openByDefault: true }, expectedRevision: 7 })
    await api.browserProbe('https://example.com/')
    expect(postedJson(lastInit)).toEqual({ url: 'https://example.com/' })
    await api.openExternal({ action: 'reveal', path: '/w/a.ts' })
    expect(lastUrl).toBe('/sidebar/api/open.external')
    expect(postedJson(lastInit)).toEqual({ action: 'reveal', path: '/w/a.ts' })
    await api.openExternal({ action: 'url', url: 'vscode://file//w/a.ts' })
    expect(postedJson(lastInit)).toEqual({ action: 'url', url: 'vscode://file//w/a.ts' })
  })

  it('passes an AbortSignal through to fetch when given', async () => {
    stubFetch()
    const controller = new AbortController()
    await api.fsTree(scope, '/w', controller.signal)
    expect(lastInit?.signal).toBe(controller.signal)
  })
})

describe('api failure mapping', () => {
  it('a network throw becomes code "network" with the Error message', async () => {
    stubFetch()
    next = new Reject(new Error('socket closed'))
    await expect(api.shellGet()).rejects.toMatchObject({ code: 'network', message: 'socket closed' })
  })

  it('a non-Error network rejection is stringified', async () => {
    stubFetch()
    next = new Reject('boom')
    await expect(api.shellGet()).rejects.toMatchObject({ code: 'network', message: 'boom' })
  })

  it('a non-ok response carries the wire error code and message', async () => {
    stubFetch()
    next = wireResponse({ ok: false, error: { code: 'forbidden', message: 'nope' } }, false, 403)
    const failure = api.shellGet()
    await expect(failure).rejects.toBeInstanceOf(SidebarApiError)
    await expect(failure).rejects.toMatchObject({ code: 'forbidden', message: 'nope' })
  })

  it('a non-ok response without a JSON body falls back to code "http" + the status', async () => {
    stubFetch()
    next = {
      ok: false,
      status: 500,
      json: async () => { throw new Error('not json') },
    } as unknown as Response
    await expect(api.shellGet()).rejects.toMatchObject({ code: 'http', message: 'HTTP 500' })
  })

  it('an ok:false body without an error record falls back to code "http"', async () => {
    stubFetch()
    next = wireResponse({ ok: false })
    await expect(api.shellGet()).rejects.toMatchObject({ code: 'http', message: 'HTTP 200' })
  })

  it('a malformed JSON body on a 200 falls back to code "http"', async () => {
    stubFetch()
    next = {
      ok: true,
      status: 200,
      json: async () => { throw new Error('bad json') },
    } as unknown as Response
    await expect(api.shellGet()).rejects.toMatchObject({ code: 'http', message: 'HTTP 200' })
  })

  it('an ok:true body without a value is a failure', async () => {
    stubFetch()
    next = wireResponse({ ok: true })
    await expect(api.shellGet()).rejects.toMatchObject({ code: 'http', message: 'HTTP 200' })
  })
})

describe('upload route (fetchUpload)', () => {
  it('posts raw bytes with the scope as query params', async () => {
    stubFetch()
    next = jsonResponse({ path: '/w/up.txt', size: 1 })
    const body = new Blob(['x'])
    await expect(api.uploadFile(scope, '/w', 'up.txt', body)).resolves.toEqual({ path: '/w/up.txt', size: 1 })
    const url = new URL(lastUrl, 'http://localhost')
    expect(url.pathname).toBe('/sidebar/upload')
    expect(url.searchParams.get('sessionId')).toBe('s1')
    expect(url.searchParams.get('dir')).toBe('/w')
    expect(url.searchParams.get('relativePath')).toBe('up.txt')
    expect(url.searchParams.get('cwd')).toBe('/w')
    expect(lastInit?.method).toBe('POST')
    expect(lastInit?.headers).toEqual({ 'content-type': 'application/octet-stream' })
    expect(lastInit?.body).toBe(body)
  })

  it('omits an absent or empty cwd from the query', async () => {
    stubFetch()
    next = jsonResponse({ path: '/w/up.txt', size: 1 })
    await api.uploadFile({ sessionId: 's1' }, '/w', 'up.txt', new Blob(['x']))
    expect(new URL(lastUrl, 'http://localhost').searchParams.has('cwd')).toBe(false)
    await api.uploadFile({ sessionId: 's1', cwd: '' }, '/w', 'up.txt', new Blob(['x']))
    expect(new URL(lastUrl, 'http://localhost').searchParams.has('cwd')).toBe(false)
  })

  it('re-throws an AbortError untouched and maps other network failures', async () => {
    stubFetch()
    next = new Reject(new DOMException('aborted', 'AbortError'))
    await expect(api.uploadFile(scope, '/w', 'a.txt', new Blob(['x']))).rejects.toMatchObject({ name: 'AbortError' })
    next = new Reject(new Error('disk gone'))
    await expect(api.uploadFile(scope, '/w', 'a.txt', new Blob(['x']))).rejects.toMatchObject({ code: 'network' })
    next = new Reject('nope')
    await expect(api.uploadFile(scope, '/w', 'a.txt', new Blob(['x']))).rejects.toMatchObject({ code: 'network', message: 'nope' })
  })

  it('maps the upload route failure shapes like every other call', async () => {
    stubFetch()
    next = wireResponse({ ok: false, error: { code: 'too-large', message: 'cap' } }, false, 413)
    await expect(api.uploadFile(scope, '/w', 'a.txt', new Blob(['x']))).rejects.toMatchObject({ code: 'too-large', message: 'cap' })
    next = {
      ok: true,
      status: 200,
      json: async () => { throw new Error('bad') },
    } as unknown as Response
    await expect(api.uploadFile(scope, '/w', 'a.txt', new Blob(['x']))).rejects.toMatchObject({ code: 'http', message: 'HTTP 200' })
    next = wireResponse({ ok: true })
    await expect(api.uploadFile(scope, '/w', 'a.txt', new Blob(['x']))).rejects.toMatchObject({ code: 'http' })
    next = new Reject(new DOMException('aborted', 'AbortError'))
    const signal = AbortSignal.abort()
    await expect(api.uploadFile(scope, '/w', 'a.txt', new Blob(['x']), signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('route URL builders', () => {
  it('mediaUrl and downloadUrl build /sidebar/file URLs (cwd only when present)', async () => {
    expect(mediaUrl(scope, '/w/a.png')).toBe('/sidebar/file?sessionId=s1&path=%2Fw%2Fa.png&cwd=%2Fw')
    expect(mediaUrl({ sessionId: 's1' }, '/w/a.png')).toBe('/sidebar/file?sessionId=s1&path=%2Fw%2Fa.png')
    const download = new URL(downloadUrl({ sessionId: 's1', cwd: '' }, '/w/a.bin'), 'http://localhost')
    expect(download.pathname).toBe('/sidebar/file')
    expect(download.searchParams.has('download')).toBe(true)
    expect(download.searchParams.has('cwd')).toBe(false)
  })

  it('htmlUrl encodes the session scope into the preview route', () => {
    expect(htmlUrl({ sessionId: 's1' }, '/w/a/index.html')).toBe('/sidebar/html/s1/w/a/index.html')
  })
})
