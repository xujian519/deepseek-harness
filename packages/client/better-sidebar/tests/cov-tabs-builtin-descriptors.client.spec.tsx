/**
 * Built-in tab descriptor tails: every descriptor's `title` / `icon` /
 * declarative-settings copy resolves through the plugin's own dictionary at
 * call time, and every descriptor's `component` forwards the host props to
 * its view with the documented fallbacks (the editor row defaults the
 * explorer callbacks so a host that passes none still renders). The heavy
 * views are replaced by probes that record the props they receive — the
 * subject under test is the descriptor, not the view.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, isValidElement } from 'react'
import { renderToString } from 'react-dom/server'
import { openTabInActivePane, type SidebarTab } from '../src/client/state.ts'
import type { Context } from '../src/context-types.ts'
import type { TabComponentProps, TabDescriptor } from '../src/client/service.ts'

const probes = vi.hoisted(() => ({
  editorHost: [] as Array<Record<string, unknown>>,
  openWith: [] as Array<Record<string, unknown>>,
  git: [] as Array<Record<string, unknown>>,
  subagent: [] as Array<Record<string, unknown>>,
  sidechat: [] as Array<Record<string, unknown>>,
  browser: [] as Array<Record<string, unknown>>,
  diff: [] as Array<Record<string, unknown>>,
}))

vi.mock('../src/client/EditorHost.tsx', () => ({
  EditorHost: (props: Record<string, unknown>) => {
    probes.editorHost.push(props)
    return createElement('div', { 'data-probe': 'editor-host' })
  },
}))
vi.mock('../src/client/open-with-settings.tsx', () => ({
  OpenWithSettings: (props: Record<string, unknown>) => {
    probes.openWith.push(props)
    return createElement('div', { 'data-probe': 'open-with' })
  },
}))
vi.mock('../src/client/GitView.tsx', () => ({
  GitView: (props: Record<string, unknown>) => {
    probes.git.push(props)
    return createElement('div', { 'data-probe': 'git' })
  },
}))
vi.mock('../src/client/SubagentView.tsx', () => ({
  SubagentView: (props: Record<string, unknown>) => {
    probes.subagent.push(props)
    return createElement('div', { 'data-probe': 'subagent' })
  },
}))
vi.mock('../src/client/BrowserView.tsx', () => ({
  BrowserView: (props: Record<string, unknown>) => {
    probes.browser.push(props)
    return createElement('div', { 'data-probe': 'browser' })
  },
}))
vi.mock('../src/client/DiffTab.tsx', () => ({
  DiffTab: (props: Record<string, unknown>) => {
    probes.diff.push(props)
    return createElement('div', { 'data-probe': 'diff' })
  },
}))
// Partial: the tab's dedupe/close helpers stay real, only the view is a probe.
vi.mock('../src/client/SideChatView.tsx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/client/SideChatView.tsx')>()
  return {
    ...actual,
    SideChatView: (props: Record<string, unknown>) => {
      probes.sidechat.push(props)
      return createElement('div', { 'data-probe': 'sidechat' })
    },
  }
})

const { builtinTabs } = await import('../src/client/builtins/tabs.tsx')
const { api } = await import('../src/client/api.ts')
const { createSidebarStore } = await import('../src/client/state.ts')

/** A context whose sidebar service records the openTab/closeTab it is asked for. */
function fakeCtx(): {
  ctx: Context
  opened: Array<Record<string, unknown>>
  closed: Array<Record<string, unknown>>
} {
  const opened: Array<Record<string, unknown>> = []
  const closed: Array<Record<string, unknown>> = []
  const sidebar = {
    openTab: (spec: Record<string, unknown>) => { opened.push(spec) },
    closeTab: (id: string, scope?: unknown) => { closed.push({ id, scope }) },
  }
  const ctx = {
    sessions: { list: { getSnapshot: () => ({ current: 's1', byId: { s1: { id: 's1', cwd: '/p' } } }) } },
    get: (name: string) => (name === 'betterSidebar' ? sidebar : undefined),
  } as unknown as Context
  return { ctx, opened, closed }
}

const descriptors: readonly TabDescriptor[] = builtinTabs(fakeCtx().ctx, { terminalTitle: () => 'bash' })

function tabOf(id: string): TabDescriptor {
  const found = descriptors.find(descriptor => descriptor.id === id)
  if (found === undefined) throw new Error(`missing builtin tab ${id}`)
  return found
}

interface SettingsCopy {
  title: string | (() => string)
  desc?: string | (() => string)
}

function settingsToggles(id: string): readonly SettingsCopy[] {
  return tabOf(id).settings?.toggles ?? []
}

/** The minimal host props one descriptor component receives. */
function componentProps(over: Partial<TabComponentProps> = {}): TabComponentProps {
  return {
    ctx: fakeCtx().ctx,
    store: createSidebarStore(),
    scope: { sessionId: 's1', cwd: '/p' },
    tab: { id: 'x-1', type: 'x', title: 'X' },
    visible: true,
    ...over,
  }
}

/** Invoke a descriptor component and return the element it produced. */
function renderDescriptor(id: string, over: Partial<TabComponentProps> = {}): ReturnType<TabDescriptor['component']> {
  return tabOf(id).component(componentProps(over))
}

const textOf = (value: string | (() => string) | undefined): string | undefined =>
  typeof value === 'function' ? value() : value

beforeEach(() => {
  for (const list of Object.values(probes)) list.length = 0
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('built-in descriptor copy', () => {
  it('every tab resolves a localized label, an icon and a display key', () => {
    for (const descriptor of descriptors) {
      expect(textOf(descriptor.title), descriptor.id).toBeTruthy()
      const icon = typeof descriptor.icon === 'function' ? descriptor.icon(16) : descriptor.icon
      expect(isValidElement(icon), descriptor.id).toBe(true)
      // The tabs that dedupe per path / per id resolve the key from the tab.
      const key = descriptor.dedupeKey?.({ id: 'editor:/w/a.md', type: descriptor.id, title: 'a', path: '/w/a.md' })
      if (descriptor.dedupeKey !== undefined) expect(key).not.toBe('')
    }
  })

  it('every declarative settings row resolves its own title and description', () => {
    for (const descriptor of descriptors) {
      for (const toggle of descriptor.settings?.toggles ?? []) {
        expect(textOf(toggle.title), `${descriptor.id}.${toggle.key}`).toBeTruthy()
        if (toggle.desc !== undefined) expect(textOf(toggle.desc), `${descriptor.id}.${toggle.key}`).toBeTruthy()
      }
    }
  })

  it('the editor select rows resolve their option icons, titles and descriptions', () => {
    const select = settingsToggles('editor')[0] as unknown as {
      options: Array<{ title: string | (() => string); desc: string | (() => string); icon: (size: number) => unknown }>
    }
    const rendered = select.options.map(option => ({
      title: textOf(option.title),
      desc: textOf(option.desc),
      icon: isValidElement(option.icon(14)),
    }))
    expect(rendered.every(entry => entry.title !== '' && entry.desc !== '' && entry.icon)).toBe(true)
  })
})

describe('editor descriptor', () => {
  it('renders the open-with panel with the popup-provided settings face', () => {
    const update = vi.fn()
    const pluginSettings = { sshHost: 'dev' }
    const render = tabOf('editor').settings?.render
    const element = render?.({
      pluginSettings,
      updatePluginSetting: update,
      store: createSidebarStore(),
      service: {} as never,
      prefs: {} as never,
      close: () => {},
    })
    expect(renderToString(element as never)).toContain('data-probe="open-with"')
    expect(probes.openWith[0]).toMatchObject({ pluginSettings, updatePluginSetting: update })
  })

  it('defaults the explorer expansion props so a host passing none still renders', () => {
    const element = renderDescriptor('editor') as { props: Record<string, unknown> }
    expect(element.props.expanded).toEqual([])
    expect(element.props.revealed).toEqual([])
    // The defaulted callbacks are inert no-ops, not undefined.
    expect(() => {
      ;(element.props.onToggleDir as () => void)()
      ;(element.props.onReferenceFile as () => void)()
    }).not.toThrow()
  })

  it('forwards the host expansion sets and callbacks when they are given', () => {
    const onToggleDir = vi.fn()
    const onReferenceFile = vi.fn()
    const element = renderDescriptor('editor', {
      expanded: ['/p/a'],
      revealed: ['/p/b'],
      onToggleDir,
      onReferenceFile,
    }) as { props: Record<string, unknown> }
    expect(element.props.expanded).toEqual(['/p/a'])
    expect(element.props.revealed).toEqual(['/p/b'])
    expect(element.props.onToggleDir).toBe(onToggleDir)
    expect(element.props.onReferenceFile).toBe(onReferenceFile)
  })
})

describe('git and subagent descriptors', () => {
  it('the git panel opens a file through the sidebar service with a path-derived tab', () => {
    const { ctx, opened } = fakeCtx()
    const element = tabOf('git').component(componentProps({ ctx })) as { props: Record<string, unknown> }
    ;(element.props.onOpenFile as (path: string) => void)('/w/notes/a.md')
    expect(opened).toEqual([{
      type: 'editor',
      title: 'a.md',
      path: '/w/notes/a.md',
      id: 'editor:/w/notes/a.md',
    }])
    // Without a host callback the diff hook is an inert no-op.
    expect(() => { (element.props.onOpenDiff as () => void)() }).not.toThrow()
  })

  it('the git panel forwards an explicit diff callback unchanged', () => {
    const onOpenDiff = vi.fn()
    const element = renderDescriptor('git', { onOpenDiff }) as { props: Record<string, unknown> }
    const tab = { id: 'diff:1', type: 'diff', title: 'd' }
    ;(element.props.onOpenDiff as (tab: SidebarTab) => void)(tab)
    expect(onOpenDiff).toHaveBeenCalledWith(tab)
    expect(element.props.scope).toEqual({ sessionId: 's1', cwd: '/p' })
  })

  it('the subagent page forwards a child jump as the child session id', () => {
    const onSubagentJump = vi.fn()
    const element = renderDescriptor('subagent', { onSubagentJump }) as { props: Record<string, unknown> }
    expect(element.props.active).toBe(true)
    ;(element.props.onOpenChild as (address: { childSessionId: string }) => void)({ childSessionId: 'child-7' })
    expect(onSubagentJump).toHaveBeenCalledWith('child-7')
    // A host that passes no jump callback still renders (no-op, no crash).
    const bare = renderDescriptor('subagent') as { props: Record<string, unknown> }
    expect(() => {
      ;(bare.props.onOpenChild as (address: { childSessionId: string }) => void)({ childSessionId: 'child-8' })
    }).not.toThrow()
  })
})

describe('side chat descriptor', () => {
  const threadTab: SidebarTab = { id: 'sidechat:t-1', type: 'sidechat', title: 'Chat', meta: { threadId: 't-1' } }

  it('dedupes per thread and renders the view with the host tab', () => {
    expect(tabOf('sidechat').dedupeKey?.(threadTab)).toBe('t-1')
    const element = renderDescriptor('sidechat', { tab: threadTab, visible: false }) as { props: Record<string, unknown> }
    expect(element.props.tab).toBe(threadTab)
    expect(element.props.visible).toBe(false)
  })

  it('disposes the thread when its tab closes and ignores a thread-less tab', () => {
    const dispose = vi.spyOn(api, 'sidechatDispose').mockResolvedValue({ accepted: true })
    tabOf('sidechat').onClose?.(threadTab, { sessionId: 's1', cwd: '/p' })
    expect(dispose).toHaveBeenCalledWith('t-1')
    dispose.mockClear()
    tabOf('sidechat').onClose?.(
      { id: 'sidechat:new-1', type: 'sidechat', title: 'New', meta: { autoCreate: true } },
      { sessionId: 's1', cwd: '/p' },
    )
    expect(dispose).not.toHaveBeenCalled()
  })

  it('swallows a dispose failure (the tab is already closing)', async () => {
    const dispose = vi.spyOn(api, 'sidechatDispose').mockRejectedValue(new Error('host refused'))
    tabOf('sidechat').onClose?.(threadTab, { sessionId: 's1', cwd: '/p' })
    await Promise.resolve()
    await Promise.resolve()
    expect(dispose).toHaveBeenCalledWith('t-1')
  })
})

describe('terminal descriptor quota', () => {
  /** A store holding `count` UI terminals plus `agents` agent-owned ones. */
  function stateWith(count: number, agents = 0): ReturnType<ReturnType<typeof createSidebarStore>['getSnapshot']>['state'] {
    const store = createSidebarStore()
    store.setSession('s1')
    for (let index = 0; index < count; index += 1) {
      store.reduce(s => openTabInActivePane(s, { id: `terminal:ui-${index}`, type: 'terminal', title: 'T' }))
    }
    for (let index = 0; index < agents; index += 1) {
      store.reduce(s => openTabInActivePane(s, { id: `agent:u-${index}`, type: 'terminal', title: 'A' }))
    }
    return store.getSnapshot().state
  }

  it('is available below the UI quota while agent-owned terminals do not count', () => {
    const available = tabOf('terminal').available
    expect(available?.(fakeCtx().ctx, { sessionId: 's1', cwd: '/p' }, stateWith(2, 4)!)).toBe(true)
    expect(available?.(fakeCtx().ctx, { sessionId: 's1', cwd: '/p' }, stateWith(3)!)).toBe(false)
  })

  it('refuses to mint a tab at capacity', () => {
    expect(tabOf('terminal').createTab?.(stateWith(3)!)).toBeNull()
  })
})

describe('browser and diff descriptors', () => {
  it('the browser view receives every host prop it was handed', () => {
    const props = componentProps({ tab: { id: 'browser:2', type: 'browser', title: 'Browser' } })
    const element = tabOf('browser').component(props) as { props: Record<string, unknown> }
    expect(element.props.tab).toBe(props.tab)
    expect(element.props.store).toBe(props.store)
    expect(element.props.visible).toBe(true)
  })

  it('the diff tab renders only with a diff payload and dedupes per tab id', () => {
    expect(tabOf('diff').dedupeKey?.({ id: 'diff:a', type: 'diff', title: 'd' })).toBe('diff:a')
    const bare = { id: 'diff:a', type: 'diff', title: 'd' }
    expect(tabOf('diff').component(componentProps({ tab: bare }))).toBeNull()
    const diff = { kind: 'worktree', path: '/p/a.ts', staged: false } as const
    const element = tabOf('diff').component(componentProps({ tab: { ...bare, diff } })) as { props: Record<string, unknown> }
    expect(element.props.sessionId).toBe('s1')
    expect(element.props.cwd).toBe('/p')
    expect(element.props.diff).toBe(diff)
  })
})
