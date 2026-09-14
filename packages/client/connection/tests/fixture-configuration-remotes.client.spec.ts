/**
 * The fixture's configuration remotes: the settings readiness descriptor, the
 * credential store, and the agent-preset roster.
 */
import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RpcResult } from '../src/client/api.ts'
import { createConfigurationRemotes } from '../src/client/fixture-configuration-remotes.ts'

/** The success value, or a thrown failure naming the code the remote reported. */
function ok<T>(result: RpcResult<T>): T {
  if (!result.ok) throw new Error(`expected success, got ${result.error.code}`)
  return result.value
}

/** `select` ignores its session id; this casts at the same point the fixture does. */
const sid = (raw: string): SessionId => raw as SessionId

describe('settingsRemotes', () => {
  it('describes the one readiness namespace as writable and secret-bearing', () => {
    const value = ok(createConfigurationRemotes().settingsRemotes.describe())
    expect(value).toMatchObject({ writable: true, hasDocument: true })
    expect(value.namespaces).toEqual([{
      ns: 'llm-deepseek',
      schema: {},
      value: { apiKeyEnv: 'DEEPSEEK_API_KEY' },
      applies: 'live',
      secrets: [{ path: ['apiKey'], set: false }],
      revision: 0,
    }])
  })

  it('rejects every write, naming the namespace it refused', () => {
    const { settingsRemotes } = createConfigurationRemotes()
    expect(settingsRemotes.update('llm-deepseek')).toMatchObject({
      ok: false,
      error: { code: 'settings/rejected', details: { ns: 'llm-deepseek' } },
    })
    expect(settingsRemotes.replace('llm-deepseek')).toMatchObject({
      ok: false,
      error: { code: 'settings/rejected', details: { ns: 'llm-deepseek' } },
    })
    expect(settingsRemotes.mutate('llm-deepseek')).toMatchObject({
      ok: false,
      error: { code: 'settings/rejected', details: { ns: 'llm-deepseek' } },
    })
  })

  it('opens the settings document', () => {
    expect(ok(createConfigurationRemotes().settingsRemotes.openSettingsDocument()))
      .toEqual({ opened: true })
  })

  it('opens the directory of a preset the user authored', () => {
    expect(ok(createConfigurationRemotes().settingsRemotes.openAgentPresetDirectory('my-agent')))
      .toEqual({ opened: true })
  })

  it('refuses the directory of an unknown or deployment-shipped preset', () => {
    const { settingsRemotes } = createConfigurationRemotes()
    for (const agentPreset of ['missing', 'standard']) {
      expect(settingsRemotes.openAgentPresetDirectory(agentPreset)).toMatchObject({
        ok: false,
        error: { code: 'agent-preset/read-only', details: { agentPreset } },
      })
    }
  })
})

describe('credentialRemotes', () => {
  it('reports the shipped route as configured and any other ref as unconfigured', () => {
    const value = ok(createConfigurationRemotes().credentialRemotes.describe(['DEEPSEEK_API_KEY', 'OTHER_KEY']))
    expect(value).toEqual({
      DEEPSEEK_API_KEY: { configured: true, source: 'file', writable: true },
      OTHER_KEY: { configured: false, writable: true },
    })
  })

  it('answers an empty ref list with an empty record', () => {
    expect(ok(createConfigurationRemotes().credentialRemotes.describe([]))).toEqual({})
  })

  it('flips the badge on set and unset', () => {
    const { credentialRemotes } = createConfigurationRemotes()
    expect(credentialRemotes.set('NEW_KEY')).toEqual({ ok: true, value: undefined })
    expect(ok(credentialRemotes.describe(['NEW_KEY']))).toEqual({
      NEW_KEY: { configured: true, source: 'file', writable: true },
    })
    expect(credentialRemotes.unset('NEW_KEY')).toEqual({ ok: true, value: undefined })
    expect(ok(credentialRemotes.describe(['NEW_KEY']))).toEqual({
      NEW_KEY: { configured: false, writable: true },
    })
  })
})

describe('presetRemotes', () => {
  it('lists both trusts, marking only the default', () => {
    const value = ok(createConfigurationRemotes().presetRemotes.list())
    expect(value.authorable).toBe(true)
    expect(value.modeSelectionEnabled).toBe(true)
    expect(value.presets).toEqual([
      { id: 'standard', trust: 'system', isDefault: true },
      { id: 'minimal', trust: 'system', isDefault: false },
      { id: 'my-agent', trust: 'user', isDefault: false },
    ])
  })

  it('moves the default when a selection names another preset', () => {
    const { presetRemotes } = createConfigurationRemotes()
    expect(ok(presetRemotes.select(sid('fx-alpha'), 'minimal'))).toBe('minimal')
    expect(ok(presetRemotes.list()).presets).toEqual([
      { id: 'standard', trust: 'system', isDefault: false },
      { id: 'minimal', trust: 'system', isDefault: true },
      { id: 'my-agent', trust: 'user', isDefault: false },
    ])
  })

  it('reads a preset by id and reports an unknown one with the roster', () => {
    const { presetRemotes } = createConfigurationRemotes()
    expect(ok(presetRemotes.read('my-agent'))).toEqual({
      agentPreset: 'my-agent',
      trust: 'user',
      content: "- id: tool-read\n  name: '@deepseek-ai/dsh-tool-read'\n",
    })
    expect(presetRemotes.read('missing')).toMatchObject({
      ok: false,
      error: { code: 'agent-preset/not-found', details: { agentPreset: 'missing' } },
    })
  })

  it('copies a preset into a user-authored one that keeps the source content', () => {
    const { presetRemotes } = createConfigurationRemotes()
    expect(presetRemotes.copy('standard', 'copy-of-standard')).toEqual({ ok: true, value: undefined })
    expect(ok(presetRemotes.read('copy-of-standard'))).toEqual({
      agentPreset: 'copy-of-standard',
      trust: 'user',
      content: "- id: tool-bash\n  name: '@deepseek-ai/dsh-tool-bash'\n",
    })
  })

  it('refuses an unknown source and a name that is taken', () => {
    const { presetRemotes } = createConfigurationRemotes()
    expect(presetRemotes.copy('missing', 'fresh')).toMatchObject({
      ok: false,
      error: { code: 'agent-preset/not-found', details: { agentPreset: 'missing' } },
    })
    expect(presetRemotes.copy('standard', 'my-agent')).toMatchObject({
      ok: false,
      error: { code: 'agent-preset/invalid', details: { agentPreset: 'my-agent' } },
    })
  })

  it('deletes a user-authored preset and refuses one that ships with the deployment', () => {
    const { presetRemotes } = createConfigurationRemotes()
    expect(presetRemotes.deletePreset('standard')).toMatchObject({
      ok: false,
      error: { code: 'agent-preset/read-only', details: { agentPreset: 'standard' } },
    })
    expect(presetRemotes.deletePreset('my-agent')).toEqual({ ok: true, value: undefined })
    expect(presetRemotes.read('my-agent')).toMatchObject({
      ok: false,
      error: { code: 'agent-preset/not-found' },
    })
    // An unknown id is not a system preset, so the delete is a no-op success.
    expect(presetRemotes.deletePreset('missing')).toEqual({ ok: true, value: undefined })
  })

  it('keeps each factory call on its own roster', () => {
    const first = createConfigurationRemotes().presetRemotes
    const second = createConfigurationRemotes().presetRemotes
    ok(first.deletePreset('my-agent'))
    ok(first.select(sid('fx-alpha'), 'minimal'))
    expect(ok(second.list()).presets).toEqual([
      { id: 'standard', trust: 'system', isDefault: true },
      { id: 'minimal', trust: 'system', isDefault: false },
      { id: 'my-agent', trust: 'user', isDefault: false },
    ])
  })
})
