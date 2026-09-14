/**
 * The fixture's RPC dispatch table: each endpoint arm reaches the dependency it
 * names and passes the result through, the inline arms answer their own fixed
 * payloads, and both channel guards reject.
 */
import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createFixtureRpc } from '../src/client/fixture-rpc.ts'
import { workspaceFileRemotes } from '../src/client/fixture-file-system.ts'
import type { FixtureRpcDeps } from '../src/client/fixture.ts'

const SESSION = 'fx-alpha' as SessionId

/**
 * A payload no case reads: each case asserts the dispatch, not the value.
 * @returns a stand-in that satisfies every dependency's payload type.
 */
function unread(): never {
  return undefined as never
}

/** An opener that yields nothing; its arm only has to reach the opener it names. */
const emptyOpener = async function* (): AsyncGenerator<never> { /* no frames */ }

/** The dependency set, with any member replaceable by the case under test. */
function deps(overrides: Partial<FixtureRpcDeps> = {}): FixtureRpcDeps {
  const base: FixtureRpcDeps = {
    commandRemotes: {
      list: () => ({ ok: true, value: unread() }),
      execute: () => ({ ok: true, value: unread() }),
    },
    referenceRemotes: {
      files: () => ({ ok: true, value: unread() }),
      sessions: () => ({ ok: true, value: unread() }),
    },
    goalRemotes: {
      get: () => ({ ok: true, value: unread() }),
      create: () => ({ ok: true, value: unread() }),
      edit: () => ({ ok: true, value: unread() }),
      pause: () => ({ ok: true, value: unread() }),
      resume: () => ({ ok: true, value: unread() }),
      complete: () => ({ ok: true, value: unread() }),
      clear: () => ({ ok: true, value: unread() }),
    },
    directoryPickerRemotes: {
      pick: () => ({ ok: true, value: unread() }),
      list: () => ({ ok: true, value: unread() }),
      createDirectory: () => ({ ok: true, value: unread() }),
    },
    settingsRemotes: {
      describe: () => ({ ok: true, value: unread() }),
      update: () => ({ ok: true, value: unread() }),
      replace: () => ({ ok: true, value: unread() }),
      mutate: () => ({ ok: true, value: unread() }),
      openSettingsDocument: () => ({ ok: true, value: unread() }),
      openAgentPresetDirectory: () => ({ ok: true, value: unread() }),
    },
    credentialRemotes: {
      describe: () => ({ ok: true, value: unread() }),
      set: () => ({ ok: true, value: unread() }),
      unset: () => ({ ok: true, value: unread() }),
    },
    presetRemotes: {
      list: () => ({ ok: true, value: unread() }),
      select: () => ({ ok: true, value: unread() }),
      read: () => ({ ok: true, value: unread() }),
      copy: () => ({ ok: true, value: unread() }),
      deletePreset: () => ({ ok: true, value: unread() }),
    },
    sessionApi: {
      list: () => Promise.resolve({ ok: true, value: unread() }),
      search: () => Promise.resolve({ ok: true, value: unread() }),
      create: () => Promise.resolve({ ok: true, value: unread() }),
      rename: () => Promise.resolve({ ok: true, value: unread() }),
      fork: () => Promise.resolve({ ok: true, value: unread() }),
      history: () => Promise.resolve({ ok: true, value: unread() }),
      selectModel: () => Promise.resolve({ ok: true, value: unread() }),
      prompt: () => Promise.resolve({ ok: true, value: unread() }),
      attachment: () => Promise.resolve({ ok: true, value: unread() }),
      updateQueue: () => Promise.resolve({ ok: true, value: unread() }),
      cancel: () => Promise.resolve({ ok: true, value: unread() }),
    },
    workspaceApi: {
      create: () => Promise.resolve({ ok: true, value: unread() }),
      rename: () => Promise.resolve({ ok: true, value: unread() }),
      delete: () => Promise.resolve({ ok: true, value: unread() }),
      insertBefore: () => Promise.resolve({ ok: true, value: unread() }),
      insertSessionBefore: () => Promise.resolve({ ok: true, value: unread() }),
      archiveSession: () => Promise.resolve({ ok: true, value: unread() }),
    },
    openControl: emptyOpener,
    openWorkspace: emptyOpener,
    openWorkspaceFileChanges: emptyOpener,
    openRemoteEvents: emptyOpener,
    openFollow: emptyOpener,
    sessionOk: value => Promise.resolve({ ok: true, value }),
    requireRemoteSession: () => undefined,
    answerRemoteEvent: () => ({ ok: true, value: unread() }),
  }
  return { ...base, ...overrides }
}

/** Call one endpoint with the fixture's minimal wire payload. */
function call(endpoint: string, args: Record<string, unknown> = {}): Promise<unknown> {
  return createFixtureRpc(deps()).call('/api', endpoint, { args: { agentId: SESSION, ...args } })
}

describe('the fixture RPC dispatch table', () => {
  it('passes the reference queries through to the reference remote', async () => {
    const value = [{ path: 'notes', kind: 'directory' } as const]
    const rpc = createFixtureRpc(deps({
      referenceRemotes: {
        files: (id, query) => ({ ok: true, value: id === SESSION && query === 'note' ? value : [] }),
        sessions: () => ({ ok: true, value: [] }),
      },
    }))

    await expect(rpc.call('/api', 'fileReferences/list', { args: { agentId: SESSION, query: 'note' } }))
      .resolves.toEqual({ ok: true, value })
    await expect(rpc.call('/api', 'sessionReferenceResolver/candidates', { args: { agentId: SESSION, query: 'beta' } }))
      .resolves.toEqual({ ok: true, value: [] })
  })

  it('answers directoryPicker/pick from the picker remote', async () => {
    const rpc = createFixtureRpc(deps({
      directoryPickerRemotes: {
        pick: () => ({ ok: true, value: '/home/fixture' }),
        list: () => ({ ok: true, value: unread() }),
        createDirectory: () => ({ ok: true, value: unread() }),
      },
    }))

    await expect(rpc.call('/api', 'directoryPicker/pick', { args: { agentId: SESSION } }))
      .resolves.toEqual({ ok: true, value: '/home/fixture' })
  })

  it('passes every agent-preset endpoint to the preset remote', async () => {
    const seen: string[] = []
    const rpc = createFixtureRpc(deps({
      presetRemotes: {
        list: () => { seen.push('list'); return { ok: true, value: unread() } },
        select: (id, agentPreset) => { seen.push(`select:${id}:${agentPreset}`); return { ok: true, value: unread() } },
        read: (agentPreset) => { seen.push(`read:${agentPreset}`); return { ok: true, value: unread() } },
        copy: (from, id) => { seen.push(`copy:${from}:${id}`); return { ok: true, value: unread() } },
        deletePreset: (id) => { seen.push(`deletePreset:${id}`); return { ok: true, value: unread() } },
      },
    }))

    const arms: readonly [string, Record<string, unknown>][] = [
      ['agentPresets/list', {}],
      ['agentPresets/select', { agentPreset: 'demo' }],
      ['agentPresets/read', { agentPreset: 'demo' }],
      ['agentPresets/copy', { from: 'demo', id: 'copy' }],
      ['agentPresets/deletePreset', { id: 'copy' }],
    ]
    for (const [endpoint, args] of arms) {
      await rpc.call('/api', endpoint, { args: { agentId: SESSION, ...args } })
    }

    expect(seen).toEqual(['list', `select:${SESSION}:demo`, 'read:demo', 'copy:demo:copy', 'deletePreset:copy'])
  })

  it('answers the subagent endpoints from the request it was given', async () => {
    await expect(call('subagents/list')).resolves.toEqual({
      ok: true,
      value: { entries: [], parentAvailable: true },
    })
    await expect(call('subagents/prompt', { request: { childSessionId: 'fx-beta' } })).resolves.toEqual({
      ok: true,
      value: { messageId: 'fixture-message-fx-beta' },
    })
    await expect(call('subagents/interruptByParent', { request: {} })).resolves.toEqual({
      ok: true,
      value: { accepted: true },
    })
  })

  it('answers the settings document and preset-directory endpoints', async () => {
    const seen: string[] = []
    const rpc = createFixtureRpc(deps({
      settingsRemotes: {
        describe: () => ({ ok: true, value: unread() }),
        update: () => ({ ok: true, value: unread() }),
        replace: () => ({ ok: true, value: unread() }),
        mutate: () => { seen.push('mutate'); return { ok: true, value: unread() } },
        openSettingsDocument: () => { seen.push('openSettingsDocument'); return { ok: true, value: { opened: true } } },
        openAgentPresetDirectory: (agentPreset) => {
          seen.push(`openAgentPresetDirectory:${agentPreset}`)
          return { ok: true, value: { opened: true } }
        },
      },
    }))

    await expect(rpc.call('/api', 'settings/canOpenAgentPresetDirectory', { args: { agentId: SESSION } }))
      .resolves.toEqual({ ok: true, value: true })
    await expect(rpc.call('/api', 'settings/openSettingsDocument', { args: { agentId: SESSION } }))
      .resolves.toEqual({ ok: true, value: { opened: true } })
    await expect(rpc.call('/api', 'settings/openAgentPresetDirectory', { args: { agentId: SESSION, agentPreset: 'demo' } }))
      .resolves.toEqual({ ok: true, value: { opened: true } })
    await rpc.call('/api', 'settings/mutate', { args: { agentId: SESSION, ns: 'llm' } })
    expect(seen).toEqual(['openSettingsDocument', 'openAgentPresetDirectory:demo', 'mutate'])
  })

  it('reports the workspace paths it can always open', async () => {
    await expect(call('session/openWorkspacePath', { request: {} })).resolves.toEqual({
      ok: true,
      value: { opened: true },
    })
    await expect(call('session/canOpenWorkspacePath')).resolves.toEqual({ ok: true, value: true })
  })

  it('fills the defaults an absent optional wire field implies', async () => {
    const seen: string[] = []
    const rpc = createFixtureRpc(deps({
      referenceRemotes: {
        files: (_id, query) => { seen.push(`files:${query}`); return { ok: true, value: [] } },
        sessions: (_id, query) => { seen.push(`sessions:${query}`); return { ok: true, value: [] } },
      },
      directoryPickerRemotes: {
        pick: () => ({ ok: true, value: null }),
        list: () => ({ ok: true, value: unread() }),
        createDirectory: (parent, name) => { seen.push(`create:${parent}:${name}`); return { ok: true, value: unread() } },
      },
      goalRemotes: {
        ...deps().goalRemotes,
        create: (_id, request) => {
          seen.push(`create:${String(request.maxGoalRounds)}`)
          return { ok: true, value: { ref: { id: 'goal', revision: 1 } } }
        },
      },
      credentialRemotes: {
        describe: (refs) => { seen.push(`describe:${refs.join('|')}`); return { ok: true, value: unread() } },
        set: () => ({ ok: true, value: unread() }),
        unset: () => ({ ok: true, value: unread() }),
      },
    }))

    await rpc.call('/api', 'fileReferences/list', { args: { agentId: SESSION, query: 'no' } })
    await rpc.call('/api', 'fileReferences/list', { args: { agentId: SESSION } })
    await rpc.call('/api', 'sessionReferenceResolver/candidates', { args: { agentId: SESSION } })
    await rpc.call('/api', 'directoryPicker/list', { args: { agentId: SESSION } })
    await rpc.call('/api', 'directoryPicker/createDirectory', { args: { agentId: SESSION, path: 'p', name: 'n' } })
    await rpc.call('/api', 'directoryPicker/createDirectory', { args: { agentId: SESSION } })
    await rpc.call('/api', 'goals/create', { args: { agentId: SESSION, request: { objective: 'o', maxGoalRounds: 3 } } })
    await rpc.call('/api', 'goals/create', { args: { agentId: SESSION, request: { objective: 'o' } } })
    await rpc.call('/api', 'credentials/describe', { args: { agentId: SESSION, refs: ['DEEPSEEK_API_KEY'] } })
    await rpc.call('/api', 'credentials/describe', { args: { agentId: SESSION } })
    await rpc.call('/api', 'workspaceFiles/read', { args: { agentId: SESSION, path: 'README.md', range: { offset: 0, limit: 1 } } })
    await rpc.call('/api', 'workspaceFiles/read', { args: { agentId: SESSION } })

    expect(seen).toEqual([
      'files:no',
      'files:',
      'sessions:',
      'create:p:n',
      'create::',
      'create:3',
      'create:undefined',
      'describe:DEEPSEEK_API_KEY',
      'describe:',
    ])
  })

  it('passes the workspace-file reads through to the shared remote', async () => {
    // The shared remote owns the tree and its refusals, so the arm is proven by
    // answering exactly what a direct call answers.
    await expect(call('workspaceFiles/list', { path: 'notes' })).resolves.toEqual(workspaceFileRemotes.list('notes'))
    await expect(call('workspaceFiles/list')).resolves.toEqual(workspaceFileRemotes.list(''))
    await expect(call('workspaceFiles/stat', { path: 'README.md' })).resolves.toEqual(workspaceFileRemotes.stat('README.md'))
    await expect(call('workspaceFiles/read', { path: 'README.md' })).resolves.toEqual(workspaceFileRemotes.read('README.md', {}))
    await expect(call('workspaceFiles/stat')).resolves.toEqual(workspaceFileRemotes.stat(''))
  })

  it('serves the provider catalog without a network request', async () => {
    const providers = await call('llm/listProviders')
    expect(providers).toEqual({
      ok: true,
      value: [
        { id: 'deepseek-official', name: 'DeepSeek' },
        { id: 'openai', name: 'openai' },
        { id: 'acme-gateway', name: 'Acme Gateway' },
      ],
    })

    const configurable = await call('llm/listConfigurableProviders')
    expect(configurable).toEqual({
      ok: true,
      value: [
        { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] },
        { provider: 'openai', displayName: 'openai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'], declared: false },
        { provider: 'anthropic', displayName: 'anthropic', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'anthropic'], declared: false },
        { provider: 'acme-gateway', displayName: 'Acme Gateway', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'acme-gateway'], declared: true },
      ],
    })

    const discovered = await call('llm/discoverModels')
    expect(discovered).toEqual({
      ok: true,
      value: [
        { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash' },
        { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
        { id: 'gpt-5', name: 'GPT-5' },
      ],
    })
  })

  it('passes the remaining session endpoints to the session API', async () => {
    const seen: string[] = []
    const rpc = createFixtureRpc(deps({
      sessionApi: {
        list: () => Promise.resolve({ ok: true, value: unread() }),
        search: () => Promise.resolve({ ok: true, value: unread() }),
        create: () => Promise.resolve({ ok: true, value: unread() }),
        rename: () => Promise.resolve({ ok: true, value: unread() }),
        fork: () => { seen.push('fork'); return Promise.resolve({ ok: true, value: unread() }) },
        history: (request) => { seen.push(`history:${String(request.sessionId)}`); return Promise.resolve({ ok: true, value: unread() }) },
        selectModel: () => Promise.resolve({ ok: true, value: unread() }),
        prompt: () => Promise.resolve({ ok: true, value: unread() }),
        attachment: () => { seen.push('attachment'); return Promise.resolve({ ok: true, value: unread() }) },
        updateQueue: () => { seen.push('updateQueue'); return Promise.resolve({ ok: true, value: unread() }) },
        cancel: () => Promise.resolve({ ok: true, value: unread() }),
      },
    }))

    await rpc.call('/api', 'session/fork', { args: { agentId: SESSION, request: { sessionId: SESSION } } })
    await rpc.call('/api', 'session/attachment', { args: { agentId: SESSION, request: { sessionId: SESSION } } })
    await rpc.call('/api', 'session/updateQueue', { args: { agentId: SESSION, request: { sessionId: SESSION } } })
    await rpc.call('/api', 'session/page', {
      args: { agentId: SESSION, request: { address: { kind: 'subagent', childSessionId: 'fx-beta' }, throughSeq: 4 } },
    })

    expect(seen).toEqual(['fork', 'attachment', 'updateQueue', 'history:fx-beta'])
  })

  it('forwards the window a session page request already holds', async () => {
    const seen: Record<string, unknown>[] = []
    const rpc = createFixtureRpc(deps({
      sessionApi: {
        ...deps().sessionApi,
        history: (request) => {
          seen.push({ ...request })
          return Promise.resolve({ ok: true, value: unread() })
        },
      },
    }))

    await rpc.call('/api', 'session/page', {
      args: {
        agentId: SESSION,
        request: { address: { kind: 'session', sessionId: SESSION }, throughSeq: 9, beforeSeq: 5, maxMessages: 2 },
      },
    })

    expect(seen).toEqual([{ sessionId: SESSION, throughSeq: 9, beforeSeq: 5, maxMessages: 2 }])
  })

  it('passes the remaining workspace endpoints to the workspace API', async () => {
    const seen: string[] = []
    const rpc = createFixtureRpc(deps({
      workspaceApi: {
        create: () => Promise.resolve({ ok: true, value: unread() }),
        rename: () => Promise.resolve({ ok: true, value: unread() }),
        delete: () => Promise.resolve({ ok: true, value: unread() }),
        insertBefore: () => { seen.push('insertBefore'); return Promise.resolve({ ok: true, value: unread() }) },
        insertSessionBefore: () => Promise.resolve({ ok: true, value: unread() }),
        archiveSession: () => { seen.push('archiveSession'); return Promise.resolve({ ok: true, value: unread() }) },
      },
    }))

    await rpc.call('/api', 'workspace/insertBefore', { args: { agentId: SESSION, request: {} } })
    await rpc.call('/api', 'workspace/archiveSession', { args: { agentId: SESSION, request: {} } })

    expect(seen).toEqual(['insertBefore', 'archiveSession'])
  })

  it('opens the stream endpoints through the matching opener', async () => {
    const opened: string[] = []
    const opener = (label: string) => async function* (): AsyncGenerator<never> {
      opened.push(label)
    }
    const rpc = createFixtureRpc(deps({
      openControl: opener('control'),
      openWorkspace: opener('workspace'),
      openWorkspaceFileChanges: opener('changes'),
      openRemoteEvents: opener('events'),
      openFollow: opener('follow'),
    }))
    const signal = new AbortController().signal

    for (const endpoint of ['$events', 'session/control', 'workspace/follow', 'workspaceFiles/changes']) {
      const stream = rpc.open?.('/api', endpoint, { args: {} }, signal)
      await stream?.[Symbol.asyncIterator]().next()
    }
    const follow = rpc.open?.('/api', 'session/follow', { args: { request: { address: { kind: 'session', sessionId: SESSION } } } }, signal)
    await follow?.[Symbol.asyncIterator]().next()

    expect(opened).toEqual(['events', 'control', 'workspace', 'changes', 'follow'])
  })

  it('rejects a call on another channel', async () => {
    await expect(createFixtureRpc(deps()).call('/other', 'goals/get', { args: { agentId: SESSION } }))
      .rejects.toThrow('fixture connection RPC channel "/other" is unavailable')
    await expect(call('no/such-endpoint')).rejects.toThrow('fixture connection RPC endpoint "no/such-endpoint" is unavailable')
  })

  it('refuses to open a stream on another channel or an unknown endpoint', () => {
    const rpc = createFixtureRpc(deps())
    const signal = new AbortController().signal

    expect(() => rpc.open?.('/other', '$events', { args: {} }, signal))
      .toThrow('fixture connection RPC channel "/other" is unavailable')
    expect(() => rpc.open?.('/api', 'no/such-stream', { args: {} }, signal))
      .toThrow('fixture connection RPC stream endpoint "no/such-stream" is unavailable')
  })
})
