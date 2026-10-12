#!/usr/bin/env node
/**
 * Test driver that drives one probe turn through one Headless Loader
 * composition and prints the session events the probe asserts on.
 *
 * The events printed are the ones the loop appended to the session — the same
 * list a model request is built from and a resume replays. The JSONL writer is
 * deliberately not in scope: this composition asserts what reaches the model.
 */

import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import type { SessionEvent, SurfaceOp } from '@deepseek-ai/dsh-session'
import { bootProductionProfile } from '../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('patent-rule warn driver requires a config path')

/** The slice of one appended session event the probe asserts on. */
interface Observation {
  readonly type: SessionEvent['type']
  readonly seq: number
  readonly surfaceOp?: SurfaceOp
  readonly source?: unknown
  readonly sources?: readonly unknown[]
  readonly text?: string
  readonly isError?: boolean | undefined
  readonly turn?: number
  readonly step?: number
}

function observe(event: SessionEvent): Observation | undefined {
  switch (event.type) {
    case 'user/message':
      return {
        type: event.type,
        seq: event.seq,
        surfaceOp: event.surfaceOp,
        source: event.data.source,
        text: event.data.content.filter(block => block.type === 'text').map(block => block.text).join('\n'),
      }
    case 'agent/inbox/spliced':
      return { type: event.type, seq: event.seq, sources: event.data.inserted.map(message => message.source) }
    case 'tool/result':
      return { type: event.type, seq: event.seq, isError: event.data.message.isError }
    case 'step/start':
      return { type: event.type, seq: event.seq }
    case 'assistant/message':
      return { type: event.type, seq: event.seq, turn: event.data.turn, step: event.data.step }
    default:
      return undefined
  }
}

const ctx = await bootProductionProfile({
  binName: 'patent-rule-warn-e2e',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
})
const observations: Observation[] = []
try {
  await runFixtureTurn(ctx, {
    task: 'probe the output gate',
    onEvent: (_sessionId, event) => {
      const observation = observe(event)
      if (observation !== undefined) observations.push(observation)
    },
  })
} finally {
  await ctx.fiber.dispose()
}
console.log(JSON.stringify({ type: 'patent-rule-warn-observation', observations }))
