/**
 * Recorded-session snapshot for the `legal` preset.
 *
 * The composition e2e proves which skills and tools mount; this suite proves
 * what the model actually receives and does. It records one live turn that
 * loads `legal-quality-gate`, then replays it keylessly and compares the
 * persisted Session, the system prompt, and the tool schemas.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import {
  assertFixtureInventory,
  launchWebScaffold,
  normalizeWebSessionVolatiles,
  rawSessionLog,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import {
  formatSystemPromptSnapshot,
  formatToolSchemasSnapshot,
  normalizedSystemPrompts,
  normalizedToolSchemas,
  redactSessionSnapshotIds,
  scrubSessionSnapshot,
  sessionFixtureName,
  stabilizeFixtureMessageIds,
  tokenizeSessionFixtureCwd,
} from '@deepseek-ai/dsh-session-snapshot'
import { prepareSessionSnapshotFixtureForComparison } from '@deepseek-ai/dsh-llm-replay'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/legal-preset', import.meta.url))
const MODE = webSnapshotMode()
const FIXTURE_NAME = sessionFixtureName(0, SESSION_FORMAT_VERSION)
const FIXTURE = join(SNAPSHOT_DIR, FIXTURE_NAME)
const PROMPT = 'Use the skill tool to load `legal-quality-gate`, then reply exactly LEGAL_SNAPSHOT_OK and stop.'

/**
 * Drop adapter-resolved model defaults from a recorded request header.
 *
 * Record mode resolves `maxTokens` and `reasoningEffort` from the live
 * adapter; replay supplies the scaffold's fixed provider/model config. The
 * snapshot pins the prompt and tool schemas, so the adapter defaults stay out
 * of the comparison instead of making the fixture depend on adapter version.
 * @param log - normalized Session JSONL.
 * @returns the same log with default-only header fields removed.
 */
function stripAdapterDefaults(log: string): string {
  return log.split('\n').map((line) => {
    if (line.trim() === '') return line
    const record = JSON.parse(line) as {
      type?: string
      data?: { header?: { config?: Record<string, unknown>; adapterDefaults?: unknown } }
    }
    if (record.type !== 'request/header' || record.data?.header === undefined) return line
    const config = record.data.header.config
    const defaults = record.data.header.adapterDefaults
    if (config !== undefined && typeof defaults === 'object' && defaults !== null) {
      record.data.header.config = Object.fromEntries(
        Object.entries(config).filter(([key]) => !Object.hasOwn(defaults, key)),
      )
    }
    delete record.data.header.adapterDefaults
    return JSON.stringify(record)
  }).join('\n')
}

it('drops only adapter-marked request fields', () => {
  const line = JSON.stringify({
    type: 'request/header',
    data: {
      header: {
        config: { provider: 'p', model: 'm', maxTokens: 100, temperature: 0.2 },
        adapterDefaults: { maxTokens: true },
      },
    },
  })
  const [record] = stripAdapterDefaults(line).split('\n')
  if (record === undefined) throw new Error('stripAdapterDefaults returned no record')
  const parsed = JSON.parse(record) as {
    data: { header: { config: Record<string, unknown>; adapterDefaults?: unknown } }
  }
  expect(parsed.data.header.config).toEqual({ provider: 'p', model: 'm', temperature: 0.2 })
  expect(parsed.data.header.adapterDefaults).toBeUndefined()
})

describe('legal preset snapshot', () => {
  let scaffold: WebScaffold
  let handle: AgentHandle

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      replayContextWindow: 1_000_000,
      ...(MODE === 'record' ? {} : { replayFixture: FIXTURE, compareReplaySession: true, paceMs: 10 }),
    })
    handle = await scaffold.ctx.agents.create({
      sessionId: SessionId('legal-preset-snapshot'),
      meta: { cwd: scaffold.workspaceCwd, agentPreset: 'legal' },
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      setup: agentCtx => scaffold.ctx.agentPresets.mount(agentCtx, 'legal').then(() => undefined),
    })
    handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: PROMPT }],
      source: { kind: 'user' },
    }))
    await handle.agent.whenIdle()
  })

  afterAll(async () => {
    const failures: unknown[] = []
    await handle?.dispose().catch((error: unknown) => failures.push(error))
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'legal preset snapshot teardown failed')
  })

  it('loads the quality gate and replies with the sentinel', () => {
    const session = handle.agent.session
    const skillCall = session.snapshotEvents().find(event => (
      event.type === 'tool/call' && event.data.name === 'skill'
    ))
    if (skillCall?.type !== 'tool/call') throw new Error('the legal turn called no skill tool')
    expect(skillCall.data.arguments).toContain('legal-quality-gate')
    const reply = session.deriveMessages().at(-1)?.content
      .flatMap(block => block.type === 'text' ? [block.text] : [])
      .join('')
    expect(reply).toBe('LEGAL_SNAPSHOT_OK')
  })

  it('writes the current Generation, prompt, and tool schemas when recording', async () => {
    if (MODE !== 'record') return
    await mkdir(SNAPSHOT_DIR, { recursive: true })
    const session = handle.agent.session
    const raw = normalizeWebSessionVolatiles(rawSessionLog(session), scaffold.workspaceCwd)
    const context = {
      sessionIds: [session.id],
      cwd: session.header.cwd ?? scaffold.workspaceCwd,
    }
    const stable = tokenizeSessionFixtureCwd(raw)
    const scrubbed = scrubSessionSnapshot(prepareSessionSnapshotFixtureForComparison(stable))
    const [fixture] = redactSessionSnapshotIds(stabilizeFixtureMessageIds([stripAdapterDefaults(scrubbed)], ['']))
    if (fixture === undefined) throw new Error('record harvest produced no Session fixture')
    await writeFile(FIXTURE, fixture)
    const prompts = normalizedSystemPrompts(raw, context)
    const schemas = normalizedToolSchemas(raw, context)
    const initialPrompt = prompts[0]
    const initialSchemas = schemas[0]
    if (initialPrompt === undefined || initialSchemas === undefined) {
      throw new Error('record harvest produced no prompt or tool schema')
    }
    await writeFile(
      join(SNAPSHOT_DIR, 'system-prompt.expected.md'),
      formatSystemPromptSnapshot(initialPrompt, prompts.slice(1)),
    )
    await writeFile(
      join(SNAPSHOT_DIR, 'tool-schemas.expected.json'),
      formatToolSchemasSnapshot(initialSchemas, schemas.slice(1)),
    )
    await writeFile(join(SNAPSHOT_DIR, 'snapshot.yml'), [
      'version: 1',
      'scenario: legal-preset',
      'profile: web',
      'composition: legal-preset',
      'recording: live',
      'header:',
      '  class: legal-preset',
      '  pin: true',
      '',
    ].join('\n'))
  })

  it('keeps its snapshot inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, [
      FIXTURE_NAME,
      'system-prompt.expected.md',
      'tool-schemas.expected.json',
    ])
  })
})
