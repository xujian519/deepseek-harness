// @vitest-environment jsdom
/**
 * BrowserView coverage round: the sandbox-token selection (GUI origin,
 * allowlisted loopback, unparsable input), address-bar navigation (ok,
 * invalid, scheme-blocked, loopback-blocked), the back/forward stack with
 * its disabled bounds, the tab persistence (path + host title), the probe
 * pipeline (embeddable, refused + load-anyway/open-external, unreachable),
 * the reload remount, the external-open button, and the local sandbox
 * unlock/restore surface.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { api, type SessionScope } from '../src/client/api.ts'
import {
  BROWSER_IFRAME_SANDBOX,
  BrowserEmbedBlocked,
  BrowserView,
  iframeSandboxFor,
} from '../src/client/BrowserView.tsx'
import { createBetterSidebarService } from '../src/client/service.ts'
import { createSidebarStore, type SidebarTab } from '../src/client/state.ts'
import type { Context } from '../src/context-types.ts'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

describe('iframeSandboxFor', () => {
  const SELF = 'http://127.0.0.1:3080'

  it('keeps the GUI origin and unparsable input on the opaque sandbox', () => {
    expect(iframeSandboxFor(undefined, 'localhost')).toBeUndefined()
    expect(iframeSandboxFor('http://127.0.0.1:3080/app', '127.0.0.1:3080', SELF)).toBe(BROWSER_IFRAME_SANDBOX)
    expect(iframeSandboxFor('not a url', 'localhost', SELF)).toBe(BROWSER_IFRAME_SANDBOX)
  })

  it('grants allow-same-origin only to an allowlisted loopback address', () => {
    expect(iframeSandboxFor('http://localhost:5173/', 'localhost:5173', SELF))
      .toContain('allow-same-origin')
    expect(iframeSandboxFor('https://example.com/', 'localhost:5173', SELF)).toBe(BROWSER_IFRAME_SANDBOX)
    // No selfOrigin given: the allowlist answers alone.
    expect(iframeSandboxFor('http://localhost:5173/', 'localhost:5173'))
      .toContain('allow-same-origin')
  })
})

describe('BrowserEmbedBlocked (panel)', () => {
  it('shows the refused host with its two escapes', () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const opened = vi.fn()
    const anyway = vi.fn()
    act(() => {
      root.render(createElement(BrowserEmbedBlocked, { url: 'https://refuser.test/x', onOpenInBrowser: opened, onLoadAnyway: anyway }))
    })
    expect(container.textContent).toContain('refuser.test')
    const buttons = [...container.querySelectorAll('button')]
    act(() => { buttons[0]!.click() })
    act(() => { buttons[1]!.click() })
    expect(opened).toHaveBeenCalledTimes(1)
    expect(anyway).toHaveBeenCalledTimes(1)
    act(() => { root.unmount() })
    container.remove()
  })
})

describe('BrowserView', () => {
  const SCOPE: SessionScope = { sessionId: 's1', cwd: '/ws' }
  let opened: ReturnType<typeof vi.fn>
  let probe: ReturnType<typeof vi.fn>

  function setup(prefs: Record<string, unknown> = {}): {
    store: ReturnType<typeof createSidebarStore>
    tab: SidebarTab
    mount: () => { container: HTMLDivElement; unmount: () => void }
  } {
    const store = createSidebarStore()
    store.setSession('s1')
    store.setPrefs({ ...store.getPrefs(), ...prefs })
    const service = createBetterSidebarService(store)
    // Register + open the browser tab so the reducer can persist onto it.
    service.registerTab({ id: 'browser', title: 'Browser', dedupeKey: t => t.path, component: () => null })
    service.openTab({ type: 'browser', title: 'Browser', id: 'browser:1' }, { sessionId: 's1' })
    const ctx = { betterSidebar: service, get: (name: string) => name === 'betterSidebar' ? service : undefined } as unknown as Context
    const tab: SidebarTab = { id: 'browser:1', type: 'browser', title: 'Browser' }
    const mount = (): { container: HTMLDivElement; unmount: () => void } => {
      const container = document.createElement('div')
      document.body.append(container)
      const root = createRoot(container)
      act(() => {
        root.render(createElement(BrowserView, { ctx, store, scope: SCOPE, tab, visible: true } as never))
      })
      return {
        container,
        unmount: () => {
          act(() => { root.unmount() })
          container.remove()
        },
      }
    }
    return { store, tab, mount }
  }

  /** Type into the address bar and commit with Enter. */
  function navigate(container: HTMLDivElement, value: string): void {
    const input = container.querySelector<HTMLInputElement>('input')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
  }

  beforeEach(() => {
    opened = vi.fn()
    vi.stubGlobal('open', opened)
    probe = vi.spyOn(api, 'browserProbe').mockResolvedValue({ reachable: true })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('starts empty; a valid navigation renders the sandboxed frame and persists the tab', () => {
    const { store, mount } = setup()
    const { container, unmount } = mount()
    expect(container.textContent).toContain('Enter a URL to start browsing')
    navigate(container, 'example.com')
    const frame = container.querySelector('iframe')!
    expect(frame.getAttribute('src')).toBe('https://example.com/')
    expect(frame.getAttribute('sandbox')).toBe(BROWSER_IFRAME_SANDBOX)
    // The visited URL persists onto the tab with the host as its title.
    const tabs = store.getSnapshot().state!.splits
    const persisted = JSON.stringify(tabs)
    expect(persisted).toContain('"path":"https://example.com/"')
    expect(persisted).toContain('"title":"example.com"')
    unmount()
  })

  it('blocked input renders the localized reason instead of a frame', () => {
    const { mount } = setup()
    const { container, unmount } = mount()
    navigate(container, 'has spaces')
    expect(container.textContent).toContain('Invalid URL')
    navigate(container, 'javascript:alert(1)')
    expect(container.textContent).toContain('only http/https URLs are allowed')
    navigate(container, 'localhost:4000')
    expect(container.textContent).toContain('local and internal addresses')
    expect(container.querySelector('iframe')).toBeNull()
    unmount()
  })

  it('the address-bar stack navigates back and forward with disabled bounds', () => {
    const { mount } = setup()
    const { container, unmount } = mount()
    navigate(container, 'https://a.test/')
    navigate(container, 'https://b.test/')
    const back = () => container.querySelector<HTMLButtonElement>('button[aria-label="Back"]')!
    const forward = () => container.querySelector<HTMLButtonElement>('button[aria-label="Forward"]')!
    expect(forward().disabled).toBe(true)
    act(() => { back().click() })
    expect(container.querySelector('iframe')!.getAttribute('src')).toBe('https://a.test/')
    expect(back().disabled).toBe(true)
    expect(forward().disabled).toBe(false)
    act(() => { forward().click() })
    expect(container.querySelector('iframe')!.getAttribute('src')).toBe('https://b.test/')
    // A fresh navigation drops the stale forward entry.
    navigate(container, 'https://c.test/')
    act(() => { back().click() })
    expect(container.querySelector('iframe')!.getAttribute('src')).toBe('https://b.test/')
    unmount()
  })

  it('a refused embed shows the reason panel; the escapes open externally or force the frame', async () => {
    probe.mockResolvedValue({ reachable: true, xFrameOptions: 'DENY' })
    const { mount } = setup()
    const { container, unmount } = mount()
    navigate(container, 'https://refuser.test/x')
    await act(async () => {})
    const panel = container.querySelector('[class*="browserBlocked"]')!
    expect(panel.textContent).toContain('refuser.test')
    // Load anyway restores the plain iframe.
    const anyway = [...panel.querySelectorAll('button')].at(-1)!
    act(() => { anyway.click() })
    expect(container.querySelector('iframe')!.getAttribute('src')).toBe('https://refuser.test/x')
    unmount()
  })

  it('the refused panel can open the URL in a real browser window instead', async () => {
    probe.mockResolvedValue({ reachable: true, frameAncestors: ['https://self'] })
    const { mount } = setup()
    const { container, unmount } = mount()
    navigate(container, 'https://refuser2.test/')
    await act(async () => {})
    const panel = container.querySelector('[class*="browserBlocked"]')!
    const open = [...panel.querySelectorAll('button')][0]!
    act(() => { open.click() })
    expect(opened).toHaveBeenCalledWith('https://refuser2.test/', '_blank', 'noopener')
    unmount()
  })

  it('an unreachable target keeps the plain iframe (probe failure is not fatal)', () => {
    probe.mockRejectedValue(new Error('probe unreachable'))
    const { mount } = setup()
    const { container, unmount } = mount()
    navigate(container, 'https://offline.test/')
    expect(container.querySelector('iframe')!.getAttribute('src')).toBe('https://offline.test/')
    unmount()
  })

  it('the external-open button mirrors the current URL and stays disabled before one exists', () => {
    const { mount } = setup()
    const { container, unmount } = mount()
    const external = () => container.querySelector<HTMLButtonElement>('button[aria-label="Open in browser"]')!
    expect(external().disabled).toBe(true)
    navigate(container, 'https://example.com/')
    act(() => { external().click() })
    expect(opened).toHaveBeenCalledWith('https://example.com/', '_blank', 'noopener')
    unmount()
  })

  it('the reload button remounts the frame; the sandbox toggle swaps the token set', () => {
    const { mount } = setup()
    const { container, unmount } = mount()
    navigate(container, 'https://example.com/')
    const keyBefore = container.querySelector('iframe')!.getAttribute('title')
    act(() => { container.querySelector<HTMLButtonElement>('button[aria-label="Refresh"]')!.click() })
    expect(container.querySelector('iframe')!.getAttribute('title')).toBe(keyBefore)
    // The status bar's unlock drops the sandbox attribute entirely.
    const unlock = [...container.querySelectorAll('button')].find(button => button.textContent!.startsWith('Temporarily disable'))
    act(() => { unlock!.click() })
    expect(container.querySelector('iframe')!.getAttribute('sandbox')).toBeNull()
    unmount()
  })

  it('the browserNoSandbox pref renders the frame without a sandbox attribute', () => {
    const { mount } = setup({ browserNoSandbox: true })
    const { container, unmount } = mount()
    navigate(container, 'https://example.com/')
    expect(container.querySelector('iframe')!.getAttribute('sandbox')).toBeNull()
    unmount()
  })

  it('an allowlisted loopback address carries allow-same-origin in the sandbox', () => {
    const { mount } = setup({ browserAllowedLoopback: 'localhost:5173' })
    const { container, unmount } = mount()
    navigate(container, 'http://localhost:5173/')
    expect(container.querySelector('iframe')!.getAttribute('sandbox')).toContain('allow-same-origin')
    unmount()
  })
})
