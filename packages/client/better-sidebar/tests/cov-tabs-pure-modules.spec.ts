/**
 * Remaining pure-module branches: parsePrefs per-field validation (valid and
 * malformed plugin-settings blobs, string fields), the open-with URL builder
 * fallbacks (malformed templates, SSH scheme resolution, uuid fallback), the
 * CodeMirror theme compartment (both schemes reconfigure in place), and the
 * open-with pending-writes queue (serialization, adoption, failure logging).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { parsePrefs } from '../src/client/prefs.ts'
import {
  newCustomEditorId,
  normalizeUrlPath,
  OPEN_WITH_DEFAULTS,
  openWithSshActive,
  openWithUrl,
  parseOpenWithConfig,
  resolveOpenWithTargets,
  type OpenWithTarget,
} from '../src/client/open-with.ts'
import { CmThemeCompartment } from '../src/client/cm-themes.ts'
import { updatePluginSettings } from '../src/client/plugin-settings.ts'
import { createSidebarStore } from '../src/client/state.ts'
import { SIDEBAR_PREFS_DEFAULTS, TITLE_BAR_STRIP_DEFAULT } from '../src/prefs-shared.ts'



describe('parsePrefs field validation (both branches of every field)', () => {
  it('accepts every string/boolean/number field when stored values are well-typed', async () => {
    const parsed = parsePrefs({
      openByDefault: true,
      defaultWidthPercent: 55.9,
      autoOpenSubagent: false,
      autoOpenJobs: false,
      agentTerminalTools: true,
      agentOpenTools: true,
      bottomPanelAutoTerminal: false,
      terminalFontFamily: 'JetBrains Mono',
      terminalShell: '/bin/zsh',
      terminalShellArgs: '-l',
      terminalFontSize: 20.4,
      interceptOpenPath: false,
      editorExplorer: true,
      titleBarScheme: 'web',
      titleBarPresetId: 'dsh-desktop',
      customCss: 'body { }',
      titleBarCompat: true,
      titleBarStripPx: 80,
      htmlViewerNoSandbox: true,
      htmlViewerDefaultUnsafe: true,
      browserNoSandbox: true,
      browserInterceptLinks: false,
      browserInterceptHttp: false,
      browserInterceptHttps: true,
      browserAllowedLoopback: 'localhost',
      tabsEnabled: { git: false },
      viewersEnabled: { code: false },
      pluginSettings: { editor: { openWith: { sshHost: '' } } },
    })
    expect(parsed.terminalShell).toBe('/bin/zsh')
    expect(parsed.terminalShellArgs).toBe('-l')
    expect(parsed.terminalFontSize).toBe(20)
    expect(parsed.htmlViewerNoSandbox).toBe(true)
    expect(parsed.htmlViewerDefaultUnsafe).toBe(true)
    expect(parsed.browserNoSandbox).toBe(true)
    expect(parsed.browserInterceptLinks).toBe(false)
    expect(parsed.browserInterceptHttp).toBe(false)
    expect(parsed.browserInterceptHttps).toBe(true)
    expect(parsed.browserAllowedLoopback).toBe('localhost')
    expect(parsed.defaultWidthPercent).toBe(56)
    expect(parsed.pluginSettings).toEqual({ editor: { openWith: { sshHost: '' } } })
  })

  it('falls back per-field on wrong types (numbers must be finite)', () => {
    const parsed = parsePrefs({
      terminalShell: 7,
      terminalShellArgs: {},
      terminalFontSize: Number.POSITIVE_INFINITY,
      htmlViewerNoSandbox: 'yes',
      htmlViewerDefaultUnsafe: 1,
      browserNoSandbox: 'on',
      browserInterceptLinks: 1,
      browserInterceptHttp: 'yes',
      browserInterceptHttps: 0,
      browserAllowedLoopback: 42,
      defaultWidthPercent: Number.NaN,
      titleBarStripPx: Number.NaN,
    })
    expect(parsed).toMatchObject({
      terminalShell: '',
      terminalShellArgs: '',
      terminalFontSize: SIDEBAR_PREFS_DEFAULTS.terminalFontSize,
      htmlViewerNoSandbox: false,
      htmlViewerDefaultUnsafe: false,
      browserNoSandbox: false,
      browserInterceptLinks: true,
      browserInterceptHttp: true,
      browserInterceptHttps: false,
      browserAllowedLoopback: '',
      defaultWidthPercent: SIDEBAR_PREFS_DEFAULTS.defaultWidthPercent,
      titleBarStripPx: SIDEBAR_PREFS_DEFAULTS.titleBarStripPx,
    })
  })

  it('a non-boolean enable-map entry is dropped, a non-object blob is dropped', () => {
    expect(parsePrefs({ tabsEnabled: { git: 'no' }, viewersEnabled: { code: null } }))
      .toMatchObject({ tabsEnabled: {}, viewersEnabled: {} })
  })

  it('pluginSettings falls back to {} for arrays / null / malformed blobs', () => {
    expect(parsePrefs({ pluginSettings: 'garbage' }).pluginSettings).toEqual({})
    // An array IS an object: the Array.isArray guard sends it to the fallback.
    expect(parsePrefs({ pluginSettings: [1] }).pluginSettings).toEqual({})
    expect(parsePrefs({ pluginSettings: null }).pluginSettings).toEqual({})
    // Blob values that are not plain objects are dropped, valid ones survive.
    const parsed = parsePrefs({ pluginSettings: { good: { k: 1 }, bad: 'x', worse: null, arr: [1] } })
    expect(parsed.pluginSettings).toEqual({ good: { k: 1 } })
  })

  it('the legacy strip migration treats only a REAL deviation from the default as configured', () => {
    expect(parsePrefs({}).titleBarScheme).toBe('auto')
    expect(parsePrefs({ titleBarStripPx: TITLE_BAR_STRIP_DEFAULT }).titleBarScheme).toBe('auto')
    expect(parsePrefs({ titleBarStripPx: TITLE_BAR_STRIP_DEFAULT + 1 }).titleBarScheme).toBe('custom')
  })
})

describe('open-with URL builder fallbacks', () => {
  const local: OpenWithTarget = {
    id: 'custom:zed-like', name: 'ZedLike', kind: 'url', urlTemplate: 'zedlike://file/{path}',
    isVscodeFamily: false, localOnly: true,
  }

  it('a reveal target has no URL form', () => {
    expect(openWithUrl({ id: 'explorer', name: '', kind: 'reveal', isVscodeFamily: false, localOnly: true }, '/p', OPEN_WITH_DEFAULTS)).toBeUndefined()
  })

  it('a vscode-family target without a scheme resolves to no URL (SSH mode)', () => {
    const broken: OpenWithTarget = { id: 'x', name: 'x', kind: 'url', urlTemplate: 'not-a-url', isVscodeFamily: true, localOnly: false }
    expect(openWithUrl(broken, '/p/a.ts', { ...OPEN_WITH_DEFAULTS, sshHost: 'dev' })).toBeUndefined()
    // A template with a colon but a MALFORMED scheme extracts to no scheme.
    const digit: OpenWithTarget = { ...broken, urlTemplate: '1bad://file/{path}' }
    expect(openWithUrl(digit, '/p/a.ts', { ...OPEN_WITH_DEFAULTS, sshHost: 'dev' })).toBeUndefined()
    // A valid vscode-family template builds the ssh-remote URL (the path keeps
    // its leading slash — ssh-remote+<host> owns none of its own).
    const vscode: OpenWithTarget = { ...broken, urlTemplate: 'vscode://file/{path}' }
    expect(openWithUrl(vscode, '/p/a.ts', { ...OPEN_WITH_DEFAULTS, sshHost: 'dev' }))
      .toBe('vscode://vscode-remote/ssh-remote+dev/p/a.ts')
  })

  it('a template whose scheme is missing or malformed yields no URL (local mode)', () => {
    const colon: OpenWithTarget = { ...local, urlTemplate: ':/file/{path}' }
    const digit: OpenWithTarget = { ...local, urlTemplate: '1bad://file/{path}' }
    expect(openWithUrl(colon, '/p/a.ts', OPEN_WITH_DEFAULTS)).toBeUndefined()
    expect(openWithUrl(digit, '/p/a.ts', OPEN_WITH_DEFAULTS)).toBeUndefined()
    // A template without the {path} slot is rejected too.
    expect(openWithUrl({ ...local, urlTemplate: 'zedlike://file/fixed' }, '/p/a.ts', OPEN_WITH_DEFAULTS)).toBeUndefined()
  })

  it('normalizes backslashes and inserts the raw path', () => {
    expect(normalizeUrlPath('C:\\Users\\u\\a.ts')).toBe('C:/Users/u/a.ts')
    expect(openWithUrl(local, 'C:\\Users\\u\\a.ts', OPEN_WITH_DEFAULTS)).toBe('zedlike://file/C:/Users/u/a.ts')
  })

  it('sshActive mirrors the trimmed sshHost', () => {
    expect(openWithSshActive({ ...OPEN_WITH_DEFAULTS, sshHost: ' dev ' })).toBe(true)
    expect(openWithSshActive(OPEN_WITH_DEFAULTS)).toBe(false)
  })

  it('custom editors without the vscode dialect are local-only and dropped in SSH mode', () => {
    const config = { sshHost: '', customEditors: [{ id: 'z', name: 'Z', urlTemplate: 'z://f/{path}', isVscodeFamily: false }], pinned: [] }
    expect(resolveOpenWithTargets(config).find(t => t.id === 'custom:z')?.localOnly).toBe(true)
    expect(resolveOpenWithTargets({ ...config, sshHost: 'dev' }).some(t => t.id === 'custom:z')).toBe(false)
  })

  it('parseOpenWithConfig drops malformed rows and keeps valid pins', () => {
    const parsed = parseOpenWithConfig({
      sshHost: 5,
      customEditors: 'nope',
      pinned: ['vscode', '', 3],
    })
    expect(parsed).toEqual({ sshHost: '', customEditors: [], pinned: ['vscode'] })
    // A custom-editor row missing any required field is dropped whole.
    const rows = parseOpenWithConfig({
      customEditors: [
        { id: 'ok', name: 'OK', urlTemplate: 'ok://f/{path}', isVscodeFamily: true },
        { id: '', name: 'no id' },
        { name: 'no id field' },
        'string',
      ],
    })
    expect(rows.customEditors).toHaveLength(1)
  })

  it('newCustomEditorId falls back to a time-based id when randomUUID is unavailable', () => {
    // Node defines globalThis.crypto as a getter: swap the property wholesale.
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
    Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true })
    try {
      const id = newCustomEditorId()
      expect(id).not.toBe('')
      expect(typeof id).toBe('string')
      // A second call mints a DIFFERENT time-based id (no shared prefix race).
      expect(newCustomEditorId()).not.toBe(id)
    } finally {
      if (descriptor !== undefined) Object.defineProperty(globalThis, 'crypto', descriptor)
    }
    // The uuid path still works with the real crypto.
    expect(newCustomEditorId()).toBeTruthy()
  })
})

describe('CmThemeCompartment', () => {
  it('both schemes reconfigure in place through the compartment effect', () => {
    const themeComp = new CmThemeCompartment()
    const state = EditorState.create({ doc: 'const a = 1', extensions: [themeComp.of(true)] })
    // The reconfigure effect applies to the live state without replacing it.
    const effect = themeComp.reconfigure(false)
    const next = state.update({ effects: effect }).state
    expect(next.doc.toString()).toBe('const a = 1')
    // And back again (light -> dark round trip).
    const back = next.update({ effects: themeComp.reconfigure(true) }).state
    expect(back.doc.toString()).toBe('const a = 1')
  })
})

describe('updatePluginSettings queue', () => {
  function jsonResponse(value: unknown): Response {
    return { ok: true, status: 200, json: async () => ({ ok: true, value }) } as unknown as Response
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const settle = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0) })

  it('serializes two writes so the second sees the first blob and adopts the returned document', async () => {
    const bodies: Array<Record<string, unknown>> = []
    vi.stubGlobal('fetch', vi.fn(async (_input: string, init?: RequestInit) => {
      const raw = init?.body
      if (typeof raw !== 'string') throw new Error('expected a stringified JSON body')
      const body = JSON.parse(raw) as { patch: { pluginSettings: Record<string, Record<string, unknown>> } }
      bodies.push(body.patch)
      return jsonResponse({ value: body.patch, revision: 1 })
    }))
    const store = createSidebarStore()
    updatePluginSettings(store, 'editor', blob => ({ ...blob, pinned: ['vscode'] }))
    updatePluginSettings(store, 'editor', blob => ({ ...blob, sshHost: 'dev' }))
    await settle()
    // The second write carried BOTH keys (it read the first write's blob).
    expect((bodies[1] as { pluginSettings: { editor: unknown } }).pluginSettings.editor).toEqual({ pinned: ['vscode'], sshHost: 'dev' })
    // The store prefs adopt the server document.
    expect(store.getPrefs().pluginSettings.editor).toEqual({ pinned: ['vscode'], sshHost: 'dev' })
  })

  it('a failed write logs and keeps the previous prefs (no optimistic flip)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('route rejected') }))
    const store = createSidebarStore()
    updatePluginSettings(store, 'editor', blob => ({ ...blob, pinned: ['vscode'] }))
    await settle()
    expect(store.getPrefs().pluginSettings).toEqual({})
    expect(errorSpy).toHaveBeenCalledWith('open-with settings write failed', expect.any(Error))
    // The queue survived the failure: a later write still runs.
    vi.stubGlobal('fetch', vi.fn(async (_input: string, init?: RequestInit) => {
      const raw = init?.body
      if (typeof raw !== 'string') throw new Error('expected a stringified JSON body')
      const body = JSON.parse(raw) as { patch: { pluginSettings: Record<string, Record<string, unknown>> } }
      return jsonResponse({ value: body.patch, revision: 1 })
    }))
    updatePluginSettings(store, 'other', blob => ({ ...blob, k: 1 }))
    await settle()
    expect(store.getPrefs().pluginSettings.other).toEqual({ k: 1 })
  })
})
