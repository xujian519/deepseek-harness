/**
 * Recorded-session snapshot for the `video` preset.
 *
 * The preset declaration spec proves which rows the shipped YAML names; this
 * suite proves the preset boots without `MINIMAX_API_KEY`, exposes the four
 * video tools, and executes the durable project action. Replay is keyless: the
 * suite removes the cloud credential before the scaffold starts, so a missing
 * key must leave MiniMax unavailable without failing the mount.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { VIDEO_BUNDLE_FIXTURE } from './video-bundle-fixture.ts'
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

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/video-preset', import.meta.url))
const MODE = webSnapshotMode()
const FIXTURE_NAME = sessionFixtureName(0, SESSION_FORMAT_VERSION)
const FIXTURE = join(SNAPSHOT_DIR, FIXTURE_NAME)
const PROMPT = 'Call the video_project tool once with action init and title "Keyless Boot", then reply exactly VIDEO_SNAPSHOT_OK and stop.'

/**
 * Drop adapter-resolved model defaults from a recorded request header. Record
 * mode reads them from the live adapter; replay supplies the scaffold's fixed
 * provider/model config.
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

describe('video preset snapshot', () => {
  let scaffold: WebScaffold
  let handle: AgentHandle
  let originalMiniMaxKey: string | undefined

  beforeAll(async () => {
    if (MODE !== 'record') {
      originalMiniMaxKey = process.env.MINIMAX_API_KEY
      Reflect.deleteProperty(process.env, 'MINIMAX_API_KEY')
    }
    scaffold = await launchWebScaffold({
      replayContextWindow: 1_000_000,
      ...VIDEO_BUNDLE_FIXTURE,
      ...(MODE === 'record' ? {} : { replayFixture: FIXTURE, compareReplaySession: true, paceMs: 10 }),
    })
    handle = await scaffold.ctx.agents.create({
      sessionId: SessionId('video-preset-snapshot'),
      meta: { cwd: scaffold.workspaceCwd, agentPreset: 'video' },
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      setup: agentCtx => scaffold.ctx.agentPresets.mount(agentCtx, 'video').then(() => undefined),
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
    if (originalMiniMaxKey === undefined) Reflect.deleteProperty(process.env, 'MINIMAX_API_KEY')
    else process.env.MINIMAX_API_KEY = originalMiniMaxKey
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'video preset snapshot teardown failed')
  })

  it('boots without the cloud key and writes the durable project', async () => {
    const session = handle.agent.session
    const call = session.snapshotEvents().find(event => (
      event.type === 'tool/call' && event.data.name === 'video_project'
    ))
    if (call?.type !== 'tool/call') throw new Error('the video turn called no video_project tool')
    expect(call.data.arguments).toContain('Keyless Boot')
    const project = JSON.parse(await readFile(join(scaffold.workspaceCwd, 'video', 'keyless-boot', 'project.json'), 'utf8')) as {
      id?: string
      title?: string
    }
    expect(project.id).toBe('keyless-boot')
    expect(project.title).toBe('Keyless Boot')
    const reply = session.deriveMessages().at(-1)?.content
      .flatMap(block => block.type === 'text' ? [block.text] : [])
      .join('')
    expect(reply).toBe('VIDEO_SNAPSHOT_OK')
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
      'scenario: video-preset',
      'profile: web',
      'composition: video-preset',
      'recording: live',
      'header:',
      '  class: video-preset',
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
