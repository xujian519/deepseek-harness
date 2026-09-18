// @vitest-environment jsdom
/**
 * Client-entry coverage round (src/client/index.tsx): one activation's
 * registrations, the mount gate (prefs, external disable, live settings
 * broadcasts), the panel-host geometry self-check, the takeover predicate
 * the entry hands to the link capture, and the fail-loud diagnostic strips. The plugin's children are boundary fakes —
 * their own behavior has its own suites; this one pins the entry's
 * orchestration, including the phases that must survive a child failing.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { act } from 'react'
import { apply } from '../src/client/index.tsx'
import { allLeaves, type SidebarStore, type SidebarTab } from '../src/client/state.ts'
import type { BetterSidebarService, TabDescriptor } from '../src/client/service.ts'
import { LOCALE_NS, attachLocale, en, t, zh } from '../src/client/locales.ts'
import { SIDEBAR_PREFS_DEFAULTS } from '../src/prefs-shared.ts'
import type { Context } from '../src/context-types.ts'

const mocks = vi.hoisted(() => ({
  api: { shellGet: vi.fn(), settingsGet: vi.fn() },
  setChunkModuleSystem: vi.fn(),
  revalidateChunksOnReactivate: vi.fn(),
  registerBuiltins: vi.fn(),
  registerTurnTailInterception: vi.fn(),
  registerOpenPathInterception: vi.fn(),
  registerLinkInterception: vi.fn(),
  registerImeGuard: vi.fn(),
  registerSettingsNavIcon: vi.fn(),
  /** Props of every mounted mock Sidebar, in mount order. */
  sidebarProps: [] as Array<{ ctx: unknown; store: unknown }>,
  /** Whether the mock Sidebar renders the panel-host layer element. */
  sidebarRenderLayer: true,
  raf: { queue: [] as FrameRequestCallback[], cancelled: [] as number[], nextId: 0 },
}))

vi.mock('../src/client/api.ts', () => ({ api: mocks.api }))
vi.mock('../src/client/chunk-loader.ts', () => ({
  setChunkModuleSystem: mocks.setChunkModuleSystem,
  revalidateChunksOnReactivate: mocks.revalidateChunksOnReactivate,
}))
vi.mock('../src/client/builtins/index.ts', () => ({ registerBuiltins: mocks.registerBuiltins }))
vi.mock('../src/client/intercept.tsx', () => ({
  registerTurnTailInterception: mocks.registerTurnTailInterception,
  registerOpenPathInterception: mocks.registerOpenPathInterception,
}))
vi.mock('../src/client/link-intercept.ts', () => ({ registerLinkInterception: mocks.registerLinkInterception }))
vi.mock('../src/client/ime-guard.ts', () => ({ registerImeGuard: mocks.registerImeGuard }))
vi.mock('../src/client/settings-nav-icon.ts', () => ({ registerSettingsNavIcon: mocks.registerSettingsNavIcon }))
vi.mock('../src/client/SideCardSection.tsx', () => ({ SideCardSection: () => null }))
vi.mock('../src/client/sidebar.module.css', () => ({
  default: { boundaryError: 'boundaryError', terminalRetry: 'terminalRetry' },
}))
vi.mock('../src/client/Sidebar.tsx', async () => {
  const { createElement } = await import('react')
  return {
    Sidebar: (props: { ctx: unknown; store: unknown }) => {
      mocks.sidebarProps.push(props)
      return mocks.sidebarRenderLayer
        ? createElement('div', { 'data-dsh-panel-host': '' }, 'stub-panel')
        : createElement('div', null, 'stub-panel')
    },
  }
})

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** Run every queued animation frame inside act(); returns how many ran. */
function runFrames(): number {
  const frames = mocks.raf.queue.splice(0)
  act(() => { for (const frame of frames) frame(0) })
  return frames.length
}

/** Flush one macrotask turn inside an act() scope. */
async function flush(): Promise<void> {
  await act(async () => { await new Promise<void>((resolve) => { setTimeout(resolve, 0) }) })
}

interface EffectRecord { label: string; dispose: () => void }

interface ActivationOptions {
  /** How `ctx.get('remote')` resolves (default: a working broadcast channel). */
  remote?: 'with-on' | 'without-on' | 'missing'
  /** Whether the settings shell has declared the slot inject waits for. */
  slotDeclared?: boolean
  /** Whether ctx.get('betterSidebar') resolves (default yes, via provide). */
  hideBetterSidebar?: boolean
}

interface Activation {
  ctx: Context
  effects: EffectRecord[]
  service: () => BetterSidebarService
  store: () => SidebarStore
  localeOffZh: Mock
  localeOffEn: Mock
  localeRegistrations: Array<{ ns: string; locale: string; dict: Record<string, string> }>
  slotInjectKeys: string[]
  slotInjectCallbacks: Array<() => () => void>
  slotRegistrations: Array<{ options: Record<string, unknown>; component: unknown }>
  fireBroadcast: () => void
  remoteOffCalls: () => number
  dispose: () => void
}

const live: Activation[] = []

function activate(options: ActivationOptions = {}): Activation {
  const effects: EffectRecord[] = []
  const provided = new Map<string, unknown>()
  const localeRegistrations: Activation['localeRegistrations'] = []
  const slotInjectKeys: string[] = []
  const slotInjectCallbacks: Array<() => () => void> = []
  const slotRegistrations: Activation['slotRegistrations'] = []
  const broadcastListeners: Array<() => void> = []
  let remoteOffCalls = 0
  const localeOffZh = vi.fn()
  const localeOffEn = vi.fn()

  const remote = ((): { $on?: (event: string, listener: () => void) => () => void } | undefined => {
    if (options.remote === 'missing') return undefined
    if (options.remote === 'without-on') return {}
    return {
      $on: (_event: string, listener: () => void) => {
        broadcastListeners.push(listener)
        return () => { remoteOffCalls += 1 }
      },
    }
  })()

  const ctx = {
    locale: {
      getSnapshot: () => ({ active: 'en' }),
      subscribe: () => () => {},
      register: (ns: string, locale: string, dict: Record<string, string>) => {
        localeRegistrations.push({ ns, locale, dict })
        return locale === 'zh' ? localeOffZh : localeOffEn
      },
    },
    effect: (body: () => (() => void) | undefined, label: string) => {
      const dispose = body()
      effects.push({ label, dispose: dispose ?? (() => {}) })
    },
    provide: (name: string, value: unknown) => { provided.set(name, value) },
    get: (name: string) => (name === 'betterSidebar' && options.hideBetterSidebar === true
      ? undefined
      : provided.get(name)) ?? (name === 'remote' ? remote : undefined),
    modules: { import: vi.fn() },
    slots: {
      inject: (key: string, callback: () => () => void) => {
        slotInjectKeys.push(key)
        slotInjectCallbacks.push(callback)
        if (options.slotDeclared === false) return () => {}
        const off = callback()
        return () => { off() }
      },
      register: (registerOptions: Record<string, unknown>, component: unknown) => {
        slotRegistrations.push({ options: registerOptions, component })
        return vi.fn()
      },
    },
  }
  apply(ctx as unknown as Context)

  const activation: Activation = {
    ctx: ctx as unknown as Context,
    effects,
    service: () => provided.get('betterSidebar') as BetterSidebarService,
    // The store rides the section registration's inject factory, so a test
    // can read it even when the mount gate kept the panel off screen.
    store: () => {
      const registration = slotRegistrations[slotRegistrations.length - 1]
      if (registration !== undefined) {
        return (registration.options.inject as () => { store: SidebarStore })().store
      }
      return mocks.sidebarProps[mocks.sidebarProps.length - 1]!.store as SidebarStore
    },
    localeOffZh,
    localeOffEn,
    localeRegistrations,
    slotInjectKeys,
    slotInjectCallbacks,
    slotRegistrations,
    fireBroadcast: () => { for (const listener of [...broadcastListeners]) listener() },
    remoteOffCalls: () => remoteOffCalls,
    dispose: () => {
      for (const effect of effects.splice(0).reverse()) effect.dispose()
    },
  }
  live.push(activation)
  return activation
}

/**
 * Activate with the mount round flushed inside one act() scope: the entry
 * mounts its root from a promise continuation, so the render must happen
 * while the scope is open.
 */
async function activateFlushed(options: ActivationOptions = {}): Promise<Activation> {
  let activation!: Activation
  await act(async () => {
    activation = activate(options)
    await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
  })
  return activation
}

/** Every tab in the mounted store's right and bottom trees, in tree order. */
function tabsOf(store: SidebarStore): SidebarTab[] {
  const state = store.getSnapshot().state
  if (state === undefined) return []
  return allLeaves(state.splits).concat(allLeaves(state.bottomSplits)).flatMap(leaf => leaf.tabs)
}

const host = (): HTMLElement | null => document.body.querySelector<HTMLElement>('[data-dsh-better-sidebar]')

const strips = (): string[] => [...document.querySelectorAll<HTMLElement>('body > div')]
  .map(element => element.textContent ?? '')
  .filter(text => text.startsWith('[dsh-better-sidebar]'))

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  }
}

let sessionSeq = 0
const nextSession = (): string => `entry-${++sessionSeq}`

beforeEach(() => {
  // mockReset (not clear) so a previous test's mockImplementationOnce queue
  // cannot answer this test's calls.
  for (const mock of [
    mocks.api.shellGet,
    mocks.api.settingsGet,
    mocks.setChunkModuleSystem,
    mocks.revalidateChunksOnReactivate,
    mocks.registerBuiltins,
    mocks.registerTurnTailInterception,
    mocks.registerOpenPathInterception,
    mocks.registerLinkInterception,
    mocks.registerImeGuard,
    mocks.registerSettingsNavIcon,
  ]) mock.mockReset()
  mocks.sidebarProps.length = 0
  mocks.sidebarRenderLayer = true
  mocks.raf.queue.length = 0
  mocks.raf.cancelled.length = 0
  mocks.api.shellGet.mockResolvedValue({ shell: '/bin/zsh', name: 'zsh' })
  mocks.api.settingsGet.mockResolvedValue({ value: {}, externalDisable: false })
  mocks.setChunkModuleSystem.mockImplementation(() => {})
  mocks.revalidateChunksOnReactivate.mockResolvedValue(undefined)
  mocks.registerBuiltins.mockImplementation(() => () => {})
  mocks.registerTurnTailInterception.mockImplementation(() => () => {})
  mocks.registerOpenPathInterception.mockImplementation(() => () => {})
  mocks.registerLinkInterception.mockImplementation(() => () => {})
  mocks.registerImeGuard.mockImplementation(() => () => {})
  mocks.registerSettingsNavIcon.mockImplementation(() => () => {})
  vi.stubGlobal('requestAnimationFrame', (frame: FrameRequestCallback) => {
    mocks.raf.queue.push(frame)
    mocks.raf.nextId += 1
    return mocks.raf.nextId
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { mocks.raf.cancelled.push(id) })
})

afterEach(async () => {
  const pending = live.splice(0)
  await act(async () => { for (const activation of pending) activation.dispose() })
  attachLocale(undefined)
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('activation', () => {
  it('registers the dictionaries, publishes the service, and wires every effect', async () => {
    const a = await activateFlushed()
    expect(a.localeRegistrations).toEqual([
      { ns: LOCALE_NS, locale: 'zh', dict: zh },
      { ns: LOCALE_NS, locale: 'en', dict: en },
    ])
    expect(a.effects.map(effect => effect.label)).toEqual([
      'dsh-better-sidebar: dictionaries',
      'dsh-better-sidebar: register built-in tabs and viewers',
      'dsh-better-sidebar: sidebar mount',
      'dsh-better-sidebar: turn-tail interception',
      'dsh-better-sidebar: open-path interception',
      'dsh-better-sidebar: link interception',
      'dsh-better-sidebar: IME composition guard',
      'dsh-better-sidebar: settings navigation icon',
    ])
    // The service is published before anything can consume it, and it is
    // the registry external plugins and the turn-tail interception share.
    expect(typeof a.service().registerTab).toBe('function')
    expect(mocks.registerTurnTailInterception).toHaveBeenCalledWith(a.ctx, a.store())
    expect(mocks.registerOpenPathInterception).toHaveBeenCalledWith(a.ctx, a.store())

    act(() => { a.dispose() })
    expect(a.localeOffZh).toHaveBeenCalledTimes(1)
    expect(a.localeOffEn).toHaveBeenCalledTimes(1)
  })

  it('registers built-ins lazily so the host shell name is read at tab creation', async () => {
    const a = await activateFlushed()
    const [, service, options] = mocks.registerBuiltins.mock.calls[0] as [
      Context,
      BetterSidebarService,
      { terminalTitle: () => string },
    ]
    expect(service).toBe(a.service())
    // The title getter is late-bound: it reports whatever the shell route
    // resolved by the time a terminal tab asks for its title.
    expect(options.terminalTitle()).toBe('zsh')
  })
})

describe('host shell title', () => {
  const descriptor = (id: string, mint: () => SidebarTab): TabDescriptor => ({
    id,
    title: id,
    component: () => null,
    createTab: () => ({ tab: mint() }),
  })

  it('retitles fallback terminal tabs and leaves agent, non-terminal and custom tabs alone', async () => {
    let deferredShell: ((value: { shell: string; name: string }) => void) | undefined
    mocks.api.shellGet.mockReturnValue(new Promise((resolve) => { deferredShell = resolve }))
    const a = await activateFlushed()

    const store = a.store()
    const service = a.service()
    store.setSession(nextSession())
    let terminalSeq = 0
    service.registerTab(descriptor('terminal', () => {
      terminalSeq += 1
      return { id: `term-${terminalSeq}`, type: 'terminal', title: t('terminal') }
    }))
    service.registerTab(descriptor('agent-host', () => ({ id: 'agent:u1', type: 'terminal', title: t('terminal') })))
    service.registerTab(descriptor('notes', () => ({ id: 'notes-1', type: 'notes', title: 'Notes' })))
    service.registerTab(descriptor('terminal-custom', () => ({ id: 'term-9', type: 'terminal', title: 'Custom' })))
    service.openTab({ type: 'terminal' })
    service.openTab({ type: 'agent-host' })
    service.openTab({ type: 'notes' })
    service.openTab({ type: 'terminal-custom' })

    deferredShell?.({ shell: '/bin/zsh', name: 'zsh' })
    await flush()

    const titles = new Map(tabsOf(store).map(tab => [tab.id, tab.title]))
    expect(titles.get('term-1')).toBe('zsh')
    expect(titles.get('agent:u1')).toBe(t('terminal'))
    expect(titles.get('notes-1')).toBe('Notes')
    expect(titles.get('term-9')).toBe('Custom')
  })

  it('leaves the fallback title in place when the shell route fails', async () => {
    mocks.api.shellGet.mockRejectedValue(new Error('offline'))
    await activateFlushed()
    const options = mocks.registerBuiltins.mock.calls[0]![2] as { terminalTitle: () => string }
    expect(options.terminalTitle()).toBe(t('terminal'))
    expect(document.body.querySelector('[data-dsh-better-sidebar]')).not.toBeNull()
  })

  it('a shell answer before the first session seeds changes no tabs', async () => {
    const a = await activateFlushed()
    const store = a.store()
    expect(store.getSnapshot().state).toBeUndefined()
    // The route resolved, but there is no session tree to walk: the guard
    // must skip the retitle pass instead of seeding a state from nowhere.
    expect(tabsOf(store)).toEqual([])
  })
})

describe('mount gate', () => {
  it('applies the resolved prefs to the mounted panel and hands it the service store', async () => {
    mocks.api.settingsGet.mockResolvedValue({
      value: { openByDefault: true, defaultWidthPercent: 33, tabsEnabled: { notes: false } },
      externalDisable: false,
    })
    const a = await activateFlushed()

    const mounted = host()
    expect(mounted).not.toBeNull()
    // The real RenderBoundary wraps the panel: the stub panel rendered.
    expect(mounted!.textContent).toContain('stub-panel')
    expect(mocks.setChunkModuleSystem).toHaveBeenCalledWith(a.ctx.modules)
    expect(mocks.revalidateChunksOnReactivate).toHaveBeenCalledTimes(1)

    const store = a.store()
    expect(store.getPrefs()).toMatchObject({ openByDefault: true, defaultWidthPercent: 33 })
    // One store per activation: the panel and the published service share it.
    expect(store.getSnapshot()).toBe(a.service().getSnapshot())
  })

  it('does not mount while the external panel provider is selected', async () => {
    mocks.api.settingsGet.mockResolvedValue({ value: { openByDefault: true }, externalDisable: true })
    const a = await activateFlushed()
    expect(host()).toBeNull()
    expect(a.store().getSuspended()).toBe(true)
    // The prefs still landed, so a later switch to this plugin is already
    // styled by the user's side card choices.
    expect(a.service().getSnapshot().prefs.openByDefault).toBe(true)
  })

  it('mounts on the schema defaults when the settings route never answers', async () => {
    vi.useFakeTimers()
    mocks.api.settingsGet
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockImplementationOnce(async () => ({ externalDisable: true }))
    let a!: Activation
    await act(async () => {
      a = activate()
      await vi.advanceTimersByTimeAsync(2000)
    })

    // The race lost: no prefs were installed, and the sidebar still reached
    // the mount decision on the schema defaults.
    expect(a.service().getSnapshot().prefs).toEqual(SIDEBAR_PREFS_DEFAULTS)
    expect(a.store().getSuspended()).toBe(true)
  })

  it('re-evaluates the mount state on every settings-document broadcast', async () => {
    const a = await activateFlushed()
    expect(host()).not.toBeNull()

    // A broadcast while mounted keeps the single host (no duplicate mount).
    a.fireBroadcast()
    await flush()
    expect(document.body.querySelectorAll('[data-dsh-better-sidebar]')).toHaveLength(1)

    // Live switch to the external provider tears the host down.
    mocks.api.settingsGet.mockResolvedValue({ value: {}, externalDisable: true })
    a.fireBroadcast()
    await flush()
    expect(host()).toBeNull()
    expect(a.store().getSuspended()).toBe(true)

    // And switching back re-mounts.
    mocks.api.settingsGet.mockResolvedValue({ value: {}, externalDisable: false })
    a.fireBroadcast()
    await flush()
    expect(host()).not.toBeNull()

    act(() => { a.dispose() })
    expect(a.remoteOffCalls()).toBe(1)
  })

  it('tolerates a runtime without the settings broadcast service', async () => {
    // No 'remote' service at all: the mount still happens and teardown has
    // nothing to unsubscribe.
    const withoutRemote = await activateFlushed({ remote: 'missing' })
    expect(host()).not.toBeNull()
    expect(withoutRemote.remoteOffCalls()).toBe(0)
    act(() => { withoutRemote.dispose() })
    expect(host()).toBeNull()

    // A 'remote' service without $on: the same best-effort behavior.
    const withoutOn = await activateFlushed({ remote: 'without-on' })
    expect(document.body.querySelectorAll('[data-dsh-better-sidebar]')).toHaveLength(1)
    expect(withoutOn.remoteOffCalls()).toBe(0)
    act(() => { withoutOn.dispose() })
  })

  it('a late broadcast after teardown starts no work', async () => {
    const a = await activateFlushed()
    const store = a.store()
    act(() => { a.dispose() })
    expect(host()).toBeNull()
    a.fireBroadcast()
    await flush()
    expect(host()).toBeNull()
    expect(store.getSuspended()).toBe(false)
  })

  it('abandons a pending sync when the activation is disposed mid-resolution', async () => {
    let resolvePrefs: ((view: { value: unknown }) => void) | undefined
    mocks.api.settingsGet
      .mockImplementationOnce(() => new Promise((resolve) => { resolvePrefs = resolve }))
      .mockImplementationOnce(async () => ({ externalDisable: true }))
    let a!: Activation
    await act(async () => { a = activate() })
    a.dispose()
    await act(async () => {
      resolvePrefs?.({ value: { openByDefault: true } })
      await Promise.resolve()
    })
    // The prefs landed on the discarded store, but the external-disable read
    // and the mount decision never ran.
    expect(a.store().getSuspended()).toBe(false)
    expect(a.service().getSnapshot().prefs.openByDefault).toBe(true)
    expect(host()).toBeNull()
  })

  it('abandons the mount decision when the activation is disposed mid-disable-read', async () => {
    let resolveDisable: ((view: { externalDisable: boolean }) => void) | undefined
    mocks.api.settingsGet
      .mockImplementationOnce(async () => ({ value: {} }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveDisable = resolve }))
    const a = await activateFlushed()
    a.dispose()
    await act(async () => {
      resolveDisable?.({ externalDisable: true })
      await Promise.resolve()
    })
    expect(a.store().getSuspended()).toBe(false)
    expect(host()).toBeNull()
  })
})

describe('panel host anchor and geometry', () => {
  it('re-attaches the host when the surrounding page removes it', async () => {
    await activateFlushed()
    const mounted = host()!
    mounted.remove()
    await flush()
    expect(document.body.contains(mounted)).toBe(true)
    expect(document.body.querySelectorAll('[data-dsh-better-sidebar]')).toHaveLength(1)

    // An unrelated mutation with the host still in place appends nothing.
    document.body.appendChild(document.createElement('span'))
    await flush()
    expect(document.body.querySelectorAll('[data-dsh-better-sidebar]')).toHaveLength(1)
  })

  it('leaves an untransformed page host alone', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await activateFlushed()
    const layer = host()!.querySelector<HTMLElement>('[data-dsh-panel-host]')!
    vi.spyOn(layer, 'getBoundingClientRect').mockImplementation(
      () => rect(0, 0, window.innerWidth, window.innerHeight),
    )
    expect(runFrames()).toBe(1)
    expect(layer.hasAttribute('data-dsh-panel-host-degraded')).toBe(false)
    expect(layer.style.transform).toBe('')
    expect(warn).not.toHaveBeenCalled()
    // The healthy path never starts the per-frame sync loop.
    expect(mocks.raf.queue).toHaveLength(0)
    expect(mocks.raf.cancelled).toHaveLength(0)
  })

  it('flags a size-mismatched host as degraded', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await activateFlushed()
    const layer = host()!.querySelector<HTMLElement>('[data-dsh-panel-host]')!
    vi.spyOn(layer, 'getBoundingClientRect').mockImplementation(
      () => rect(0, 0, window.innerWidth - 50, window.innerHeight),
    )
    expect(runFrames()).toBe(1)
    expect(layer.hasAttribute('data-dsh-panel-host-degraded')).toBe(true)
    expect(warn).toHaveBeenCalled()
  })

  it('compensates a page-level transform each frame and clears once it resolves', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await activateFlushed()
    const layer = host()!.querySelector<HTMLElement>('[data-dsh-panel-host]')!
    const width = window.innerWidth
    const height = window.innerHeight
    const frames = [rect(50, 50, width, height), rect(50, 50, width, height), rect(0, 0, width, height), rect(-50, -50, width, height)]
    vi.spyOn(layer, 'getBoundingClientRect').mockImplementation(
      () => frames.shift() ?? rect(-50, -50, width, height),
    )

    expect(runFrames()).toBe(1)
    expect(layer.hasAttribute('data-dsh-panel-host-degraded')).toBe(true)
    expect(warn).toHaveBeenCalled()

    // Frame 2 compensates the raw offset.
    runFrames()
    expect(layer.style.transform).toBe('translate(-50px, -50px)')
    // Frame 3 re-measures to the same raw offset: no redundant write.
    runFrames()
    expect(layer.style.transform).toBe('translate(-50px, -50px)')
    // Frame 4 sees the ancestor transform gone: degraded mode clears and the
    // sync loop stops.
    runFrames()
    expect(layer.hasAttribute('data-dsh-panel-host-degraded')).toBe(false)
    expect(layer.style.transform).toBe('')
    expect(mocks.raf.queue).toHaveLength(0)
  })

  it('cancels a pending frame on teardown and ignores a frame that lands anyway', async () => {
    const a = await activateFlushed()
    const layer = host()!.querySelector<HTMLElement>('[data-dsh-panel-host]')!
    vi.spyOn(layer, 'getBoundingClientRect').mockImplementation(
      () => rect(0, 0, window.innerWidth, window.innerHeight),
    )
    // A frame is pending from the mount; teardown cancels it.
    act(() => { a.dispose() })
    expect(mocks.raf.cancelled).toHaveLength(1)
    // A frame dispatched before the cancel reaches a host that is gone.
    expect(() => { runFrames() }).not.toThrow()
    expect(layer.hasAttribute('data-dsh-panel-host-degraded')).toBe(false)
  })

  it('skips the self-check when the panel layer is absent', async () => {
    mocks.sidebarRenderLayer = false
    await activateFlushed()
    const mounted = host()!
    expect(mounted.querySelector('[data-dsh-panel-host]')).toBeNull()
    expect(runFrames()).toBe(1)
    expect(mounted.querySelector('[data-dsh-panel-host-degraded]')).toBeNull()
  })
})

describe('fail-loud diagnostics', () => {
  /** A mount-stage DOM failure is reported and leaves the page alive. */
  it('reports a mount failure and survives a reporting failure of its own', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(document, 'createElement').mockImplementation(() => { throw new Error('no dom') })
    await activateFlushed()
    expect(error.mock.calls.some(call => String(call[0]).includes('mount error:'))).toBe(true)
    // Both the host and the diagnostic strip fail to build: the catch's own
    // catch swallows it rather than taking the page down.
    expect(strips()).toEqual([])
  })

  it('pins a strip and logs when a later load phase throws', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.setChunkModuleSystem.mockImplementationOnce(() => { throw new Error('boom') })
    activate()
    expect(strips()).toContain('[dsh-better-sidebar] load error: boom')
    expect(error).toHaveBeenCalled()

    const thrown = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.setChunkModuleSystem.mockImplementationOnce(() => { throw 'boom' })
    activate()
    expect(strips()).toContain('[dsh-better-sidebar] load error: boom')
    expect(thrown).toHaveBeenCalled()
  })

  it('contains a failing interception registration and keeps the other phases wired', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.registerTurnTailInterception.mockImplementationOnce(() => { throw new Error('boom') })
    const a = await activateFlushed()
    expect(strips()).toContain('[dsh-better-sidebar] interception error: boom')
    expect(error).toHaveBeenCalled()
    // The failed phase returns an inert disposer; the rest still registered.
    a.effects.find(effect => effect.label === 'dsh-better-sidebar: turn-tail interception')!.dispose()
    expect(mocks.registerOpenPathInterception).toHaveBeenCalled()
    expect(mocks.registerImeGuard).toHaveBeenCalled()
  })

  it('contains a failing open-path, link and IME registration', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.registerOpenPathInterception.mockImplementationOnce(() => { throw new Error('boom') })
    const openPath = await activateFlushed()
    expect(strips()).toContain('[dsh-better-sidebar] interception error: boom')
    openPath.effects.find(effect => effect.label === 'dsh-better-sidebar: open-path interception')!.dispose()
    expect(error).toHaveBeenCalled()

    mocks.registerLinkInterception.mockImplementationOnce(() => { throw new Error('boom') })
    const link = await activateFlushed()
    expect(strips()).toContain('[dsh-better-sidebar] interception error: boom')
    link.effects.find(effect => effect.label === 'dsh-better-sidebar: link interception')!.dispose()

    mocks.registerImeGuard.mockImplementationOnce(() => { throw new Error('broken') })
    const ime = await activateFlushed()
    expect(strips()).toContain('[dsh-better-sidebar] ime guard error: broken')
    ime.effects.find(effect => effect.label === 'dsh-better-sidebar: IME composition guard')!.dispose()
  })
})

describe('settings contributions', () => {
  it('marks the settings nav row with the localized label', async () => {
    await activateFlushed()
    const label = mocks.registerSettingsNavIcon.mock.calls[0]![0] as () => string
    expect(label()).toBe(t('settingsNav'))
  })

  it('registers the Side card section against the live store and service', async () => {
    const a = await activateFlushed()
    expect(a.slotInjectKeys).toEqual(['settings.section'])
    expect(a.slotRegistrations).toHaveLength(1)
    const { options, component } = a.slotRegistrations[0]!
    expect(options).toMatchObject({ name: 'settings.section', id: 'better-sidebar', order: 100 })
    expect((options.label as () => string)()).toBe(t('settingsNav'))
    expect((options.inject as () => { store: SidebarStore; service: BetterSidebarService })()).toEqual({
      store: a.store(),
      service: a.service(),
    })
    expect(component).toBeTypeOf('function')
  })

  it('waits for the shell to declare the slot before registering', async () => {
    const a = await activateFlushed({ slotDeclared: false })
    expect(a.slotInjectKeys).toEqual(['settings.section'])
    expect(a.slotRegistrations).toEqual([])
    // The callback handed to slots.inject registers the section once the
    // settings shell declares the slot.
    a.slotInjectCallbacks[0]!()
    expect(a.slotRegistrations).toHaveLength(1)
    expect(a.slotRegistrations[0]!.options).toMatchObject({ id: 'better-sidebar' })
  })
})

describe('link interception wiring', () => {
  const url = (href: string): URL => new URL(href)

  it('gates the takeover on the master pref, the protocol flag and the target', async () => {
    const a = await activateFlushed()
    const opts = mocks.registerLinkInterception.mock.calls[0]![0] as {
      takeoverEnabled: (url: URL) => boolean
      openInSidebar: (url: string) => void
      selfOrigin: string
    }
    const store = a.store()
    expect(opts.selfOrigin).toBe(window.location.origin)

    // Defaults: master on, http on, https off, built-in browser enabled.
    expect(opts.takeoverEnabled(url('http://example.test/page'))).toBe(true)
    expect(opts.takeoverEnabled(url('https://example.test/page'))).toBe(false)

    store.setSuspended(true)
    expect(opts.takeoverEnabled(url('http://example.test/page'))).toBe(false)
    store.setSuspended(false)

    store.setPrefs({ ...store.getPrefs(), browserInterceptLinks: false })
    expect(opts.takeoverEnabled(url('http://example.test/page'))).toBe(false)
    store.setPrefs({ ...store.getPrefs(), browserInterceptLinks: true, browserInterceptHttp: false })
    expect(opts.takeoverEnabled(url('http://example.test/page'))).toBe(false)
    store.setPrefs({ ...store.getPrefs(), browserInterceptHttp: true, tabsEnabled: { browser: false } })
    expect(opts.takeoverEnabled(url('http://example.test/page'))).toBe(false)
    store.setPrefs({ ...store.getPrefs(), tabsEnabled: {} })
    expect(opts.takeoverEnabled(url('http://example.test/page'))).toBe(true)
  })

  it('prefers a plugin urlTarget claim and skips disabled tab types', async () => {
    const a = await activateFlushed()
    const opts = mocks.registerLinkInterception.mock.calls[0]![0] as {
      takeoverEnabled: (url: URL) => boolean
      openInSidebar: (url: string) => void
    }
    const store = a.store()
    const service = a.service()
    const openTab = vi.spyOn(service, 'openTab')
    const disabledClaim = vi.fn(() => true)
    service.registerTab({
      id: 'flowglass',
      title: 'Flowglass',
      urlTarget: disabledClaim,
      component: () => null,
    })
    service.registerTab({
      id: 'ego',
      title: 'Ego',
      urlTarget: (target: URL) => target.hostname === 'ego.test',
      component: () => null,
    })
    store.setPrefs({ ...store.getPrefs(), tabsEnabled: { flowglass: false } })

    // The disabled type never gets to claim the URL.
    expect(opts.takeoverEnabled(url('http://ego.test/page'))).toBe(true)
    expect(disabledClaim).not.toHaveBeenCalled()

    // The claim also chooses the tab the open lands in.
    opts.openInSidebar('http://ego.test/page')
    expect(openTab).toHaveBeenCalledWith({
      type: 'ego',
      url: 'http://ego.test/page',
      title: 'ego.test',
    })
    // An unclaimed URL falls back to the built-in browser tab.
    opts.openInSidebar('http://other.test/page')
    expect(openTab).toHaveBeenLastCalledWith({
      type: 'browser',
      url: 'http://other.test/page',
      title: 'other.test',
    })

    // A claim beyond the built-in browser works even with the browser off.
    store.setPrefs({ ...store.getPrefs(), tabsEnabled: { flowglass: false, browser: false } })
    expect(opts.takeoverEnabled(url('http://ego.test/page'))).toBe(true)
    expect(opts.takeoverEnabled(url('http://other.test/page'))).toBe(false)
  })

  it('survives a runtime without a published betterSidebar service', async () => {
    const missing = await activateFlushed({ hideBetterSidebar: true })
    const opts = mocks.registerLinkInterception.mock.calls[0]![0] as {
      openInSidebar: (url: string) => void
    }
    // No published service: the optional open silently does nothing.
    expect(() => { opts.openInSidebar('http://example.test/x') }).not.toThrow()
    act(() => { missing.dispose() })
  })

  it('rethrows an href that cannot be parsed at all', async () => {
    await activateFlushed()
    const opts = mocks.registerLinkInterception.mock.calls[0]![0] as {
      openInSidebar: (url: string) => void
    }
    // The title read is defensive, the target read is not: an impossible
    // href still surfaces instead of being silently swallowed.
    expect(() => { opts.openInSidebar('not a url') }).toThrow()
  })
})
