// @vitest-environment jsdom
/**
 * Coverage round for the two click/open interceptors: the link capture's
 * defensive early returns (already-defaulted events, non-Element targets,
 * clicks with no anchor ancestor) and the openPath wrapper's folder-reveal
 * gesture, which routes "Show in folder" into the explorer instead of an
 * editor tab.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerLinkInterception } from '../src/client/link-intercept.ts'
import { isFolderRevealPath, wrapOpenPath, type OpenPathInterceptDeps, type OpenPathService } from '../src/client/openpath-intercept.ts'

const SELF = 'http://127.0.0.1:3080'

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('registerLinkInterception defensive returns', () => {
  /** Register the capture with a gate that fails the test when consulted. */
  const register = () => registerLinkInterception({
    takeoverEnabled: () => { throw new Error('gate must not be consulted') },
    openInSidebar: () => { throw new Error('must not open') },
    selfOrigin: SELF,
  })

  it('leaves an already-defaulted click alone', () => {
    const dispose = register()
    // A window-capture listener runs before the document-capture interceptor,
    // so preventDefault there marks the event as already handled.
    const defaulting = (event: Event): void => { event.preventDefault() }
    window.addEventListener('click', defaulting, true)
    const anchor = document.createElement('a')
    anchor.href = 'https://example.com/page'
    document.body.append(anchor)
    try {
      anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    } finally {
      window.removeEventListener('click', defaulting, true)
      anchor.remove()
    }
    dispose()
  })

  it('ignores a click whose target is not an Element (no closest to walk)', () => {
    const dispose = register()
    // Dispatched on the document itself, the event's target is the Document,
    // which has no `closest` method.
    document.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    dispose()
  })

  it('ignores a click outside any anchor', () => {
    const dispose = register()
    const span = document.createElement('span')
    span.textContent = 'plain prose'
    document.body.append(span)
    span.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    span.remove()
    dispose()
  })
})

describe('folder-reveal gesture (openpath-intercept)', () => {
  it('recognizes every "Show in folder" spelling', () => {
    for (const path of ['.', './', 'a/.', 'a/./', 'a\\.', 'a\\.\\']) {
      expect(isFolderRevealPath(path), path).toBe(true)
    }
    for (const path of ['/w/a.ts', 'a', '..', 'a/..', '/w/.env', 'a.b/.c']) {
      expect(isFolderRevealPath(path), path).toBe(false)
    }
  })

  /** The workspaces service fake: records what the original funnel received. */
  const service = (): OpenPathService & { opened: string[] } => {
    const fake = {
      opened: [] as string[],
      async openPath(path: string): Promise<void> { this.opened.push(path) },
    }
    return fake
  }

  const deps = (): OpenPathInterceptDeps & { revealed: string[]; editor: string[] } => {
    const revealed: string[] = []
    const editor: string[] = []
    return {
      revealed,
      editor,
      takeoverEnabled: () => true,
      currentSessionId: () => 's1',
      openInSidebar: (path, sessionId) => { editor.push(`${sessionId}:${path}`) },
      revealInExplorer: (path, sessionId) => { revealed.push(`${sessionId}:${path}`) },
    }
  }

  it('routes the gesture into the explorer and resolves as success', async () => {
    const ws = service()
    const d = deps()
    const restore = wrapOpenPath(ws, d)
    await ws.openPath('.')
    expect(d.revealed).toEqual(['s1:.'])
    expect(d.editor).toEqual([])
    expect(ws.opened).toEqual([])
    restore()
    // After restore the gesture reaches the original funnel untouched.
    await ws.openPath('./')
    expect(ws.opened).toEqual(['./'])
  })

  it('a file open still goes to the editor, not the explorer', async () => {
    const ws = service()
    const d = deps()
    const restore = wrapOpenPath(ws, d)
    await ws.openPath('/w/src/a.ts')
    expect(d.editor).toEqual(['s1:/w/src/a.ts'])
    expect(d.revealed).toEqual([])
    restore()
  })
})
