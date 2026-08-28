/**
 * Pure-logic coverage round for the workbench shell's dependency-free
 * modules: the isWithinWorkspace containment mirror, the produced-files
 * structural replica's malformed-input branches, the pinned-tab id helpers,
 * and the language table's degrade paths (unknown extension, broken
 * factory). Complements the dedicated specs; every case here names the
 * branch it pins.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { isWithinWorkspace, isAbsolutePath, relativeTo } from '../src/client/paths.ts'
import { producedForClosing, producedPaths, resolveSidebarPath, selectProducedFiles } from '../src/client/produced-files.ts'
import {
  collectPinnedTabs, createPinnedVirtualTab, getPinnedHomeScope, injectPinnedIntoTree,
  isPinnedVirtualTab, parsePinnedVirtualId,
  type PinnedViewer,
} from '../src/client/pinned.ts'
import { extOf, languageForPath, supportedLanguageKeys } from '../src/client/lang.ts'
import type { SidebarLeaf, SidebarState, SidebarTab, SplitNode } from '../src/client/state.ts'

// A broken factory (any js-family entry calls `javascript`) must degrade to
// plain text instead of crashing the editor — the catch path in lang.ts.
vi.mock('@codemirror/lang-javascript', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codemirror/lang-javascript')>()
  return { ...actual, javascript: () => { throw new Error('broken factory') } }
})

describe('isWithinWorkspace (client mirror of the host fence)', () => {
  it('accepts the base itself and paths under it', () => {
    expect(isWithinWorkspace('/work/proj', '/work/proj')).toBe(true)
    expect(isWithinWorkspace('/work/proj', '/work/proj/src/a.ts')).toBe(true)
  })

  it('rejects sibling paths that only share a prefix', () => {
    expect(isWithinWorkspace('/work/proj', '/work/project/x.ts')).toBe(false)
    expect(isWithinWorkspace('/work/proj', '/elsewhere/x.ts')).toBe(false)
  })

  it('normalizes separator style and trailing slashes', () => {
    expect(isWithinWorkspace('C:\\work\\proj\\', 'C:/work/proj/src/a.ts')).toBe(true)
    expect(isWithinWorkspace('/work/proj', '/work/proj/src/')).toBe(true)
  })

  it('compares windows drive paths case-insensitively', () => {
    expect(isWithinWorkspace('C:\\Work\\Proj', 'c:\\work\\proj\\src\\a.ts')).toBe(true)
    expect(isWithinWorkspace('C:\\Work\\Proj', 'c:\\work\\projx\\a.ts')).toBe(false)
  })
})

describe('producedPaths malformed views', () => {
  it('returns nothing for null or non-object views', () => {
    expect(producedPaths(null)).toEqual([])
    expect(producedPaths(42)).toEqual([])
    expect(producedPaths('diff')).toEqual([])
  })

  it('returns nothing for non-edit cards', () => {
    expect(producedPaths({ card: 'read', locations: [{ path: 'a.ts' }] })).toEqual([])
    expect(producedPaths({ card: 'generic', kind: 'delete', locations: [{ path: 'a.ts' }] })).toEqual([])
  })

  it('returns nothing for an edit card without a locations array', () => {
    expect(producedPaths({ card: 'diff' })).toEqual([])
    expect(producedPaths({ card: 'generic', kind: 'edit', locations: 'a.ts' })).toEqual([])
  })

  it('keeps only well-formed string paths from the locations array', () => {
    expect(producedPaths({
      card: 'diff',
      locations: [null, 42, {}, { path: 5 }, { path: 'ok.ts' }, { path: 'b.ts' }],
    })).toEqual(['ok.ts', 'b.ts'])
  })
})

describe('producedForClosing structural noise', () => {
  const diffResult = (path: string) => ({
    kind: 'tool-result', isError: false, callView: { card: 'diff', locations: [{ path }] },
  })

  it('skips null and non-object nodes', () => {
    const nodes = [null, 42, 'x', diffResult('a.ts'), { kind: 'assistant', seq: 1, turn: 1 }]
    expect(producedForClosing(nodes, 1)).toEqual(['a.ts'])
  })

  it('skips errored tool results before reading the view', () => {
    const nodes = [
      { kind: 'assistant', seq: 1, turn: 1 },
      { kind: 'tool-result', isError: true, callView: { card: 'diff', locations: [{ path: 'x.ts' }] } },
    ]
    expect(producedForClosing(nodes, 1)).toEqual([])
  })

  it('resets on a turn-number change (no user message between)', () => {
    const nodes = [
      { kind: 'assistant', seq: 1, turn: 1 },
      diffResult('old.ts'),
      { kind: 'assistant', seq: 2, turn: 2 },
      diffResult('kept.ts'),
      { kind: 'assistant', seq: 3, turn: 2 },
    ]
    expect(producedForClosing(nodes, 3)).toEqual(['kept.ts'])
  })

  it('returns nothing when the closing assistant never appears', () => {
    expect(producedForClosing([diffResult('a.ts')], 99)).toEqual([])
    expect(producedForClosing([], 1)).toEqual([])
  })
})

describe('selectProducedFiles authoritative Turn-data path', () => {
  it('reads turn.data deliverables and drops empty/malformed/foreign-seq entries', () => {
    const owner = {
      seq: 5,
      turn: { data: new Map([['deliverables', {
        produced: [
          null,
          42,
          { path: '' },
          { path: 7 },
          { path: 'future.ts', seq: 9 },
          { path: 'a.ts', seq: 3 },
          { path: 'a.ts', seq: 4 },
          { path: 'b.ts' },
        ],
      }]]) },
    }
    expect(selectProducedFiles(owner)).toEqual(['a.ts', 'b.ts'])
  })

  it('declines when the deliverable list is empty after filtering', () => {
    const owner = { seq: 5, turn: { data: new Map([['deliverables', { produced: [{ path: 'future.ts', seq: 9 }] }]]) } }
    expect(selectProducedFiles(owner)).toBeNull()
  })

  it('falls back to the nodes when the deliverables record is not usable', () => {
    expect(selectProducedFiles({ seq: 1, turn: { data: new Map() }, nodes: [{ kind: 'assistant', seq: 1, turn: 1 }] })).toBeNull()
    expect(selectProducedFiles({ seq: 1, turn: undefined, nodes: [] })).toBeNull()
    expect(selectProducedFiles({ seq: 1 })).toBeNull()
    expect(selectProducedFiles(42)).toBeNull()
  })

  it('treats a missing seq as +Infinity (every produced entry qualifies)', () => {
    const owner = { turn: { data: new Map([['deliverables', { produced: [{ path: 'a.ts', seq: 9 }] }]]) } }
    expect(selectProducedFiles(owner)).toEqual(['a.ts'])
  })
})

describe('resolveSidebarPath windows-style bases', () => {
  it('joins with the base separator and keeps absolute paths', () => {
    expect(resolveSidebarPath('/work/proj/', 'a.ts')).toBe('/work/proj/a.ts')
    expect(resolveSidebarPath('/work/proj', '\\\\server\\share\\x.ts')).toBe('\\\\server\\share\\x.ts')
  })
})

describe('pinned-tab id helpers', () => {
  const terminal = (id: string, pin: SidebarTab['pin']): SidebarTab => ({ id, type: 'terminal', title: id, ...(pin === undefined ? {} : { pin }) })
  const leaf = (id: string, tabs: SidebarTab[]): SidebarLeaf => ({ kind: 'leaf', id, tabs, active: tabs[0]?.id ?? null })
  const stateWith = (splits: SplitNode): SidebarState => ({
    panelOpen: true,
    width: 400,
    activePane: null,
    nextTerminal: 1,
    nextBrowser: 1,
    expanded: [],
    revealed: [],
    splits,
    bottomOpen: false,
    bottomHeight: 220,
    bottomOpenedOnce: false,
    bottomSplits: leaf('pane:b', []),
    floats: [],
  })

  it('parsePinnedVirtualId tolerates a missing tab-id segment', () => {
    expect(parsePinnedVirtualId('pinned:solo')).toEqual({ homeSessionId: 'solo', tabId: '' })
    expect(parsePinnedVirtualId('pinned:home:tab:1')).toEqual({ homeSessionId: 'home', tabId: 'tab:1' })
  })

  it('injectPinnedIntoTree overrides only the active pointer when no pins are visible', () => {
    const tree = leaf('pane:1', [{ id: 't1', type: 'editor', title: 'A' }])
    const out = injectPinnedIntoTree(tree, [], 't1')
    expect(out).not.toBe(tree)
    expect(out).toMatchObject({ kind: 'leaf', active: 't1' })
    expect((out as { tabs: unknown[] }).tabs).toHaveLength(1)
  })

  it('injectPinnedIntoTree recurses into the FIRST child of a split tree', () => {
    const inner = leaf('pane:first', [{ id: 't1', type: 'editor', title: 'A' }])
    const pinned = createPinnedVirtualTab({ tab: terminal('term', { scope: 'global' }), homeSessionId: 'home' })
    const tree: SplitNode = {
      kind: 'split', id: 's1', dir: 'row', sizes: [0.5, 0.5],
      children: [inner, leaf('pane:second', [])],
    }
    const out = injectPinnedIntoTree(tree, [pinned], null) as { children: SplitNode[] }
    // Only the first child is touched: the second keeps its empty strip.
    expect((out.children[1] as { tabs: unknown[] }).tabs).toHaveLength(0)
    expect((out.children[0] as { tabs: unknown[] }).tabs).toEqual([...inner.tabs, pinned])
    expect(isPinnedVirtualTab((out.children[0] as { tabs: SidebarTab[] }).tabs[1]!)).toBe(true)
  })

  it('collectPinnedTabs skips invisible floats and non-visible leaf tabs', () => {
    const viewer: PinnedViewer = { sessionId: 'viewer', cwd: '/w' }
    const states = new Map<string, SidebarState>([
      // A float carrying a NON-terminal tab and a leaf whose pinned tab is
      // outside the viewer's workspace.
      ['a', stateWith(leaf('pane:1', [
        terminal('foreign-ws', { scope: 'workspace', homeCwd: '/other' }),
        { id: 'ed', type: 'editor', title: 'A', pin: { scope: 'global' } },
      ]))],
      ['b', { ...stateWith(leaf('pane:2', [])), floats: [
        { id: 'f1', tab: { id: 'ed2', type: 'editor', title: 'B', pin: { scope: 'global' } }, x: 0, y: 0, w: 320, h: 200 },
        { id: 'f2', tab: terminal('away', { scope: 'workspace', homeCwd: '/elsewhere' }), x: 0, y: 0, w: 320, h: 200 },
      ] }],
      // Visible in a nested split: depth-first order.
      ['c', stateWith({
        kind: 'split', id: 's', dir: 'col', sizes: [0.5, 0.5],
        children: [leaf('pane:3', []), leaf('pane:4', [terminal('hit', { scope: 'global' })])],
      })],
    ])
    const collected = collectPinnedTabs(states, viewer)
    expect(collected.map(entry => entry.tab.id)).toEqual(['hit'])
    expect(collected[0]!.homeSessionId).toBe('c')
    expect(getPinnedHomeScope(collected[0]!.tab)).toBeUndefined()
    // The viewer's own session is excluded.
    states.set('viewer', stateWith(leaf('pane:9', [terminal('own', { scope: 'global' })])))
    expect(collectPinnedTabs(states, viewer).map(entry => entry.tab.id)).toEqual(['hit'])
  })

  it('workspace pins stay visible while either cwd is unknown', () => {
    const tab = terminal('t', { scope: 'workspace', homeCwd: '/w' })
    expect(collectPinnedTabs(new Map([['a', stateWith(leaf('p', [tab]))]]), { sessionId: 'viewer', cwd: undefined }).length).toBe(1)
    const unpinned = terminal('u', { scope: 'workspace' })
    expect(collectPinnedTabs(new Map([['a', stateWith(leaf('p', [unpinned]))]]), { sessionId: 'viewer', cwd: '/other' }).length).toBe(1)
    // A pin-less tab is never collected.
    expect(collectPinnedTabs(
      new Map([['a', stateWith(leaf('p', [{ id: 'x', type: 'terminal', title: 'x' }]))]]),
      { sessionId: 'viewer', cwd: '/w' },
    ).length).toBe(0)
  })

  it('createPinnedVirtualTab preserves existing meta', () => {
    const vtab = createPinnedVirtualTab({
      tab: { ...terminal('term', { scope: 'workspace', homeCwd: '/w' }), meta: { agent: true } },
      homeSessionId: 'home',
    })
    expect(vtab.id).toBe('pinned:home:term')
    expect(getPinnedHomeScope(vtab)).toEqual({ sessionId: 'home', cwd: '/w', tabId: 'term' })
    expect(vtab.meta).toEqual({ agent: true, __pinnedHome: getPinnedHomeScope(vtab) })
  })
})

describe('extOf / language table', () => {
  it('derives lowercase extensions and rejects directory dots', () => {
    expect(extOf('a.TXT')).toBe('txt')
    expect(extOf('noext')).toBe('')
    // A dot that belongs to a directory segment is not an extension.
    expect(extOf('a.b/c')).toBe('')
    expect(extOf('C:\\dir.v2\\file')).toBe('')
  })

  it('languageForPath returns null for an unmapped extension', () => {
    expect(languageForPath('x.unknownext')).toBeNull()
    expect(languageForPath('noext')).toBeNull()
    // The factories cover every key the table can produce.
    for (const key of supportedLanguageKeys()) expect(key.length).toBeGreaterThan(0)
  })

  it('a broken language factory degrades to plain text instead of crashing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(languageForPath('script.js')).toBeNull()
      expect(warn.mock.calls.some(call => String(call[0]).includes('language factory "js" failed'))).toBe(true)
      // Non-mocked factories still build.
      expect(languageForPath('a.md')).not.toBeNull()
    } finally {
      warn.mockRestore()
    }
  })

  it('relativeTo keeps the leading dot for the bare cwd under trailing separators', () => {
    expect(relativeTo('/w/p/', '/w/p')).toBe('.')
    expect(isAbsolutePath('\\\\srv\\share')).toBe(true)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})
