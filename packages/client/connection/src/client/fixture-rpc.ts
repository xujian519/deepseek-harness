// The standalone browser fixture's RPC dispatch table.

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ClientConnectionRpc } from '../rpc.ts'
import { workspaceFileRemotes } from './fixture-file-system.ts'
import type { FixturePageRequest, FixtureRpcDeps } from './fixture.ts'

/** The session API's request types, read through the dependency seam. */
type SessionApi = FixtureRpcDeps['sessionApi']
/** The workspace API's request types, read through the dependency seam. */
type WorkspaceApi = FixtureRpcDeps['workspaceApi']
/** A goal reference as the goals endpoints carry it. */
type FxGoalRef = Parameters<FixtureRpcDeps['goalRemotes']['pause']>[1]
/** A follow request as the `session/follow` stream carries it. */
type FollowRequest = Parameters<FixtureRpcDeps['openFollow']>[0]
/** The event result the `$events/result` endpoint answers. */
type RemoteEventResult = Parameters<FixtureRpcDeps['answerRemoteEvent']>[0]

interface ModelProviderGroup {
  readonly id: string
  readonly name: string
  readonly models: readonly {
    readonly id: string
    readonly name: string
    readonly description?: string
    readonly reasoning?: {
      readonly efforts: readonly { readonly id: string; readonly name: string; readonly description?: string }[]
      readonly defaultEffort?: string
    }
  }[]
}

const DEEPSEEK_REASONING = {
  efforts: [
    { id: 'off', name: 'Off' },
    { id: 'high', name: 'High' },
    { id: 'max', name: 'Max' },
  ],
  defaultEffort: 'high',
}

const OPENAI_REASONING = {
  efforts: [
    { id: 'off', name: 'Off' },
    { id: 'medium', name: 'Medium' },
    { id: 'high', name: 'High' },
    { id: 'max', name: 'Max' },
  ],
  defaultEffort: 'medium',
}

/** Catalog served by `session/modelCatalog` (fresh copies per call). */
function fixtureModelGroups(): ModelProviderGroup[] {
  return [
    {
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [
        {
          id: 'deepseek-v4-flash',
          name: 'DeepSeek-V4-Flash',
          description: '快速响应',
          reasoning: DEEPSEEK_REASONING,
        },
        {
          id: 'deepseek-v4-pro',
          name: 'DeepSeek-V4-Pro',
          description: '复杂任务',
          reasoning: DEEPSEEK_REASONING,
        },
      ],
    },
    {
      id: 'openai',
      name: 'OpenAI',
      models: [{ id: 'gpt-5', name: 'GPT-5', reasoning: OPENAI_REASONING }],
    },
  ]
}

/**
 * Build the fixture's RPC transport over the world values that serve its endpoints.
 * @param deps - the remotes, APIs, stream openers, and helpers each endpoint dispatches to.
 * @returns the in-memory Connection RPC a fixture world exposes.
 */
export function createFixtureRpc(deps: FixtureRpcDeps): ClientConnectionRpc {
  const {
    commandRemotes,
    referenceRemotes,
    goalRemotes,
    directoryPickerRemotes,
    settingsRemotes,
    credentialRemotes,
    presetRemotes,
    sessionApi,
    workspaceApi,
    openControl,
    openWorkspace,
    openWorkspaceFileChanges,
    openRemoteEvents,
    openFollow,
    sessionOk,
    requireRemoteSession,
    answerRemoteEvent,
  } = deps

  return {
    call(channel, endpoint, payload, signal) {
      if (channel !== '/api') {
        return Promise.reject(new Error(`fixture connection RPC channel ${JSON.stringify(channel)} is unavailable`))
      }
      const args = (payload as {
        args: Readonly<{
          agentId: SessionId
          line?: string
          query?: string
          path?: string
          range?: { offset?: number; limit?: number }
          name?: string
          images?: readonly unknown[]
          // A goal ref and a credential reference name share this wire field name.
          ref?: string | { id: string; revision: number }
          refs?: readonly string[]
          value?: string
          ns?: string
          settingsNs?: string
          agentPreset?: string
          from?: string
          id?: string
          request?: unknown
          _request?: unknown
        }>
      }).args
      const sessionId = args.agentId
      const callSignal = signal ?? new AbortController().signal
      const request = args.request
      switch (endpoint) {
        case 'commands/list': return Promise.resolve(commandRemotes.list(sessionId))
        case 'commands/execute': return Promise.resolve(commandRemotes.execute(sessionId, args.line as string, args.images ?? []))
        case 'fileReferences/list': return Promise.resolve(referenceRemotes.files(sessionId, args.query ?? ''))
        case 'sessionReferenceResolver/candidates': return Promise.resolve(referenceRemotes.sessions(sessionId, args.query ?? ''))
        case 'directoryPicker/pick': return Promise.resolve(directoryPickerRemotes.pick())
        case 'directoryPicker/list': return Promise.resolve(directoryPickerRemotes.list(args.path))
        case 'directoryPicker/createDirectory':
          return Promise.resolve(directoryPickerRemotes.createDirectory(args.path ?? '', args.name ?? ''))
        case 'goals/get': return Promise.resolve(goalRemotes.get(sessionId))
        case 'goals/create': return Promise.resolve(goalRemotes.create(sessionId, {
          objective: (request as { objective?: string } | undefined)?.objective as string,
          ...(request as { maxGoalRounds?: number } | undefined)?.maxGoalRounds === undefined
            ? {}
            : { maxGoalRounds: (request as { maxGoalRounds: number }).maxGoalRounds },
        }))
        case 'goals/edit': return Promise.resolve(goalRemotes.edit(
          sessionId,
          args.ref as FxGoalRef,
          request as { objective?: string; maxGoalRounds?: number },
        ))
        case 'goals/pause': return Promise.resolve(goalRemotes.pause(sessionId, args.ref as FxGoalRef))
        case 'goals/resume': return Promise.resolve(goalRemotes.resume(sessionId, args.ref as FxGoalRef))
        case 'goals/complete': return Promise.resolve(goalRemotes.complete(sessionId, args.ref as FxGoalRef))
        case 'goals/clear': return Promise.resolve(goalRemotes.clear(sessionId, args.ref as FxGoalRef))
        case 'agentPresets/list': return Promise.resolve(presetRemotes.list())
        case 'agentPresets/select': return Promise.resolve(presetRemotes.select(sessionId, args.agentPreset as string))
        case 'agentPresets/read': return Promise.resolve(presetRemotes.read(args.agentPreset as string))
        case 'agentPresets/copy': return Promise.resolve(presetRemotes.copy(args.from as string, args.id as string))
        case 'agentPresets/deletePreset': return Promise.resolve(presetRemotes.deletePreset(args.id as string))
        case 'subagents/list': return Promise.resolve({
          ok: true,
          value: { entries: [], parentAvailable: true },
        })
        case 'subagents/prompt': return Promise.resolve({
          ok: true,
          value: {
            messageId: `fixture-message-${(request as { childSessionId: SessionId }).childSessionId}`,
          },
        })
        case 'subagents/interruptByParent': return Promise.resolve({ ok: true, value: { accepted: true } })
        case 'credentials/describe': return Promise.resolve(credentialRemotes.describe(args.refs ?? []))
        case 'credentials/set': return Promise.resolve(credentialRemotes.set(args.ref as string))
        case 'credentials/unset': return Promise.resolve(credentialRemotes.unset(args.ref as string))
        case 'settings/describe': return Promise.resolve(settingsRemotes.describe())
        case 'settings/canOpenAgentPresetDirectory': return Promise.resolve({ ok: true, value: true })
        case 'settings/openSettingsDocument': return Promise.resolve(settingsRemotes.openSettingsDocument())
        case 'settings/openAgentPresetDirectory': return Promise.resolve(
          settingsRemotes.openAgentPresetDirectory(args.agentPreset as string),
        )
        case 'skills/list': {
          const skillRequest = request as { readonly sessionId: SessionId }
          const missing = requireRemoteSession(skillRequest)
          if (missing !== undefined) return missing
          return sessionOk({
            skills: [
              { name: 'fixture-demo', description: 'fixture 技能样本', whenToUse: '仅供 UI 目录渲染验收', modelInvocable: true },
              { name: 'fixture-user-only', description: 'fixture 仅用户技能样本', modelInvocable: false },
            ],
          })
        }
        case 'session/openWorkspacePath': {
          return sessionOk({ opened: true as const })
        }
        case 'workspaceFiles/read': {
          return Promise.resolve(workspaceFileRemotes.read(args.path ?? '', args.range ?? {}))
        }
        case 'workspaceFiles/stat': {
          return Promise.resolve(workspaceFileRemotes.stat(args.path ?? ''))
        }
        case 'workspaceFiles/list': {
          return Promise.resolve(workspaceFileRemotes.list(args.path ?? ''))
        }
        case 'session/canOpenWorkspacePath': return Promise.resolve({ ok: true, value: true })
        case 'session/modelCatalog': return Promise.resolve({
          ok: true,
          value: {
            default: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
            routableProviders: ['deepseek-official', 'openai', 'acme-gateway'],
            groups: fixtureModelGroups(),
            failures: [],
          },
        })
        case 'llm/listProviders': return Promise.resolve({
          ok: true,
          value: [
            { id: 'deepseek-official', name: 'DeepSeek' },
            { id: 'openai', name: 'openai' },
            { id: 'acme-gateway', name: 'Acme Gateway' },
          ],
        })
        case 'llm/listConfigurableProviders': return Promise.resolve({
          ok: true,
          value: [
            { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] },
            { provider: 'openai', displayName: 'openai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'], declared: false },
            { provider: 'anthropic', displayName: 'anthropic', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'anthropic'], declared: false },
            { provider: 'acme-gateway', displayName: 'Acme Gateway', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'acme-gateway'], declared: true },
          ],
        })
        // The fixture endpoint is imaginary, so interrogation answers the
        // catalog it already serves without a network request.
        case 'llm/discoverModels': return Promise.resolve({
          ok: true,
          value: fixtureModelGroups().flatMap(group => group.models.map(model => ({ id: model.id, name: model.name }))),
        })
        case 'settings/update': return Promise.resolve(settingsRemotes.update(args.ns as string))
        case 'settings/replace': return Promise.resolve(settingsRemotes.replace(args.ns as string))
        case 'settings/mutate': return Promise.resolve(settingsRemotes.mutate(args.ns as string))
        case 'session/list': return sessionApi.list(
          args._request as Parameters<SessionApi['list']>[0],
        )
        case 'session/search': return sessionApi.search(
          request as Parameters<SessionApi['search']>[0],
          callSignal,
        )
        case 'session/create': return sessionApi.create(
          request as Parameters<SessionApi['create']>[0],
        )
        case 'session/selectModel': return sessionApi.selectModel(
          request as Parameters<SessionApi['selectModel']>[0],
        )
        case 'session/rename': return sessionApi.rename(
          request as Parameters<SessionApi['rename']>[0],
        )
        case 'session/fork': return sessionApi.fork(
          request as Parameters<SessionApi['fork']>[0],
        )
        case 'session/prompt': return sessionApi.prompt(
          request as Parameters<SessionApi['prompt']>[0],
        )
        case 'session/attachment': return sessionApi.attachment(
          request as Parameters<SessionApi['attachment']>[0],
        )
        case 'session/updateQueue': return sessionApi.updateQueue(
          request as Parameters<SessionApi['updateQueue']>[0],
        )
        case 'session/cancel': return sessionApi.cancel(
          request as Parameters<SessionApi['cancel']>[0],
        )
        case 'session/page': {
          const page = request as FixturePageRequest
          const pageSessionId = page.address.kind === 'session'
            ? page.address.sessionId
            : page.address.childSessionId
          return sessionApi.history({
            sessionId: pageSessionId,
            throughSeq: page.throughSeq,
            ...page.beforeSeq === undefined ? {} : { beforeSeq: page.beforeSeq },
            ...page.maxMessages === undefined ? {} : { maxMessages: page.maxMessages },
          })
        }
        case '$events/result': return Promise.resolve(answerRemoteEvent(args as unknown as RemoteEventResult))
        case 'workspace/create': return workspaceApi.create(request as Parameters<WorkspaceApi['create']>[0])
        case 'workspace/rename': return workspaceApi.rename(request as Parameters<WorkspaceApi['rename']>[0])
        case 'workspace/delete': return workspaceApi.delete(request as Parameters<WorkspaceApi['delete']>[0])
        case 'workspace/insertBefore': return workspaceApi.insertBefore(request as Parameters<WorkspaceApi['insertBefore']>[0])
        case 'workspace/insertSessionBefore': return workspaceApi.insertSessionBefore(
          request as Parameters<WorkspaceApi['insertSessionBefore']>[0],
        )
        case 'workspace/archiveSession': return workspaceApi.archiveSession(request as Parameters<WorkspaceApi['archiveSession']>[0])
        default:
          return Promise.reject(new Error(`fixture connection RPC endpoint ${JSON.stringify(endpoint)} is unavailable`))
      }
    },
    open(channel, endpoint, payload, signal) {
      if (channel !== '/api') {
        throw new Error(`fixture connection RPC channel ${JSON.stringify(channel)} is unavailable`)
      }
      const args = (payload as { args: Readonly<{ request?: unknown }> }).args
      switch (endpoint) {
        case '$events': return openRemoteEvents(signal)
        case 'session/control': return openControl(signal)
        case 'session/follow': return openFollow(args.request as FollowRequest, signal)
        case 'workspace/follow': return openWorkspace(signal)
        case 'workspaceFiles/changes': return openWorkspaceFileChanges(signal)
        default:
          throw new Error(`fixture connection RPC stream endpoint ${JSON.stringify(endpoint)} is unavailable`)
      }
    },
  }
}
