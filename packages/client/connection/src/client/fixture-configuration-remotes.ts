// The fixture's configuration remotes: the settings, credential, and
// agent-preset clusters, together with the writable state they own.

import type { CredentialInfo } from '@deepseek-ai/dsh-credentials/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SettingsDescribeValue, SettingsNamespaceView } from '@deepseek-ai/dsh-settings/types'
import type { RpcResult } from './api.ts'
import type { ConnectionRpcResult } from '../rpc.ts'

interface FixtureSettingsRemotes {
  describe(): RpcResult<SettingsDescribeValue>
  update(ns: string): ConnectionRpcResult<SettingsNamespaceView>
  replace(ns: string): ConnectionRpcResult<SettingsNamespaceView>
  mutate(ns: string): ConnectionRpcResult<SettingsNamespaceView>
  openSettingsDocument(): RpcResult<{ opened: true }>
  openAgentPresetDirectory(agentPreset: string): RpcResult<{ opened: true } | { opened: false; path: string }>
}

interface FixtureCredentialRemotes {
  describe(refs: readonly string[]): RpcResult<Record<string, CredentialInfo>>
  set(ref: string): RpcResult<void>
  unset(ref: string): RpcResult<void>
}

interface FixturePresetRemotes {
  list(): RpcResult<{
    presets: { id: string; trust: 'system' | 'user'; isDefault: boolean }[]
    authorable: boolean
    modeSelectionEnabled: boolean
  }>
  select(_id: SessionId, agentPreset: string): RpcResult<string>
  read(agentPreset: string): RpcResult<{ agentPreset: string; trust: 'system' | 'user'; content: string }>
  copy(from: string, id: string): RpcResult<void>
  deletePreset(id: string): RpcResult<void>
}

interface FixtureConfigurationRemotes {
  settingsRemotes: FixtureSettingsRemotes
  credentialRemotes: FixtureCredentialRemotes
  presetRemotes: FixturePresetRemotes
}

/**
 * Build the fixture's configuration remotes over their own writable state. Each
 * call returns an independent store, so a preset or credential one world writes
 * does not appear in another.
 * @returns the settings, credential, and agent-preset remotes the connection
 *   RPC dispatch delegates to.
 */
export function createConfigurationRemotes(): FixtureConfigurationRemotes {
  /** Credential store double: set/unset flip the describe badge, values never read back. */
  const fixtureCredentials = new Map<string, true>([
    // The assembled fixture represents an already-configured shipped
    // DeepSeek route so unrelated GUI journeys do not enter first-run setup.
    ['DEEPSEEK_API_KEY', true],
  ])

  /** Canonical fixture implementation of the generated Settings Remote contract. */
  const settingsRemotes: FixtureSettingsRemotes = {
    // Only the resolved DeepSeek address needed by first-run readiness is
    // represented here. Fixture-backed journeys do not open its Models editor;
    // real schema-driven forms ride the HTTP transport.
    describe(): RpcResult<SettingsDescribeValue> {
      return {
        ok: true,
        value: {
          writable: true,
          hasDocument: true,
          namespaces: [{
            ns: 'llm-deepseek',
            schema: {},
            value: { apiKeyEnv: 'DEEPSEEK_API_KEY' },
            applies: 'live',
            secrets: [{ path: ['apiKey'], set: false }],
            revision: 0,
          }],
        },
      }
    },
    update(ns: string): ConnectionRpcResult<SettingsNamespaceView> {
      return {
        ok: false,
        error: {
          code: 'settings/rejected',
          message: 'fixture: the minimal readiness settings descriptor is read-only',
          details: { ns },
        },
      }
    },
    replace(ns: string): ConnectionRpcResult<SettingsNamespaceView> {
      return {
        ok: false,
        error: {
          code: 'settings/rejected',
          message: 'fixture: the minimal readiness settings descriptor is read-only',
          details: { ns },
        },
      }
    },
    mutate(ns: string): ConnectionRpcResult<SettingsNamespaceView> {
      // A Remote failure code is free-form, unlike the unary error vocabulary.
      return {
        ok: false,
        error: {
          code: 'settings/rejected',
          message: 'fixture: no settings namespaces are registered',
          details: { ns },
        },
      }
    },
    openSettingsDocument(): RpcResult<{ opened: true }> {
      return { ok: true, value: { opened: true } }
    },
    openAgentPresetDirectory(agentPreset: string): RpcResult<
      { opened: true } | { opened: false; path: string }
    > {
      const existing = fixturePresets.get(agentPreset)
      if (existing === undefined || existing.trust === 'system') {
        return {
          ok: false,
          error: {
            code: 'agent-preset/read-only',
            message: `agent preset "${agentPreset}" ships with the deployment`,
            details: { agentPreset, reason: 'it ships with the deployment' },
          },
        }
      }
      return { ok: true, value: { opened: true } }
    },
  }

  const credentialRemotes: FixtureCredentialRemotes = {
    describe(refs: readonly string[]): RpcResult<Record<string, CredentialInfo>> {
      return {
        ok: true,
        value: Object.fromEntries(refs.map(ref => [ref, {
          configured: fixtureCredentials.has(ref),
          ...fixtureCredentials.has(ref) ? { source: 'file' } : {},
          writable: true,
        }])),
      }
    },
    set(ref: string): RpcResult<void> {
      fixtureCredentials.set(ref, true)
      return { ok: true, value: undefined }
    },
    unset(ref: string): RpcResult<void> {
      fixtureCredentials.delete(ref)
      return { ok: true, value: undefined }
    },
  }

  /**
   * Preset compositions the fixture serves. Held as state rather than
   * constants so the settings editor's save and delete are exercisable: the
   * roster a GUI journey sees after writing is the text it wrote.
   */
  const fixturePresets = new Map<string, { trust: 'system' | 'user'; content: string }>([
    ['standard', { trust: 'system', content: "- id: tool-bash\n  name: '@deepseek-ai/dsh-tool-bash'\n" }],
    ['minimal', { trust: 'system', content: "- id: tool-web-search\n  name: '@deepseek-ai/dsh-tool-web-search'\n" }],
    ['my-agent', { trust: 'user', content: "- id: tool-read\n  name: '@deepseek-ai/dsh-tool-read'\n" }],
  ])
  let fixtureDefaultPreset = 'standard'

  /** Canonical fixture implementation of the generated AgentPresets Remote contract. */
  const presetRemotes: FixturePresetRemotes = {
    // Both trusts appear, because a surface must present a locally authored
    // preset differently from one the deployment vetted.
    list(): RpcResult<{
      presets: { id: string; trust: 'system' | 'user'; isDefault: boolean }[]
      authorable: boolean
      modeSelectionEnabled: boolean
    }> {
      return {
        ok: true,
        value: {
          presets: [...fixturePresets].map(([id, preset]) => ({
            id,
            trust: preset.trust,
            isDefault: id === fixtureDefaultPreset,
          })),
          authorable: true,
          modeSelectionEnabled: true,
        },
      }
    },
    select(_id: SessionId, agentPreset: string): RpcResult<string> {
      fixtureDefaultPreset = agentPreset
      return { ok: true, value: agentPreset }
    },
    read(agentPreset: string): RpcResult<{ agentPreset: string; trust: 'system' | 'user'; content: string }> {
      const preset = fixturePresets.get(agentPreset)
      if (preset === undefined) {
        return {
          ok: false,
          error: {
            code: 'agent-preset/not-found',
            message: `unknown agent preset "${agentPreset}"`,
            details: { agentPreset, available: [...fixturePresets.keys()] },
          },
        }
      }
      return { ok: true, value: { agentPreset, trust: preset.trust, content: preset.content } }
    },
    copy(from: string, id: string): RpcResult<void> {
      const source = fixturePresets.get(from)
      if (source === undefined) {
        return {
          ok: false,
          error: {
            code: 'agent-preset/not-found',
            message: `unknown agent preset "${from}"`,
            details: { agentPreset: from, available: [...fixturePresets.keys()] },
          },
        }
      }
      if (fixturePresets.has(id)) {
        return {
          ok: false,
          error: {
            code: 'agent-preset/invalid',
            message: `agent preset "${id}" already exists`,
            details: { agentPreset: id, reason: 'already exists' },
          },
        }
      }
      fixturePresets.set(id, { trust: 'user', content: source.content })
      return { ok: true, value: undefined }
    },
    deletePreset(id: string): RpcResult<void> {
      if (fixturePresets.get(id)?.trust === 'system') {
        return {
          ok: false,
          error: {
            code: 'agent-preset/read-only',
            message: `agent preset "${id}" ships with the deployment`,
            details: { agentPreset: id, reason: 'it ships with the deployment' },
          },
        }
      }
      fixturePresets.delete(id)
      return { ok: true, value: undefined }
    },
  }
  return { settingsRemotes, credentialRemotes, presetRemotes }
}
