// Replay consistency: write a run to disk, replay its session log, and prove
// the evidence ledger and legal-gaps report survive the round trip unchanged.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import {
  contentHash,
  globalAtomRegistry,
  globalStageHandlerRegistry,
  registerBuiltinAtoms,
  type PipelineState,
  type StageHandler,
  type WorkflowManifest,
} from '@deepseek-ai/dsh-patent-core'
import PatentWorkflow, { JsonFileWorkflowRunStore } from '@deepseek-ai/dsh-patent-workflow'

registerBuiltinAtoms()
globalAtomRegistry.register({
  name: 'legal-gaps',
  category: 'gate',
  description: 'test stub — 真实注册在 patent-tools apply()',
  inputSchema: [],
  outputSchema: ['legal_gaps_report'],
})
globalStageHandlerRegistry.register({
  name: 'legal-gaps',
  category: 'gate',
  execute: async (): Promise<PipelineState> => ({
    legal_gaps_report: '法条缺口汇总（审查意见答复）：无阻断项',
  }),
} satisfies StageHandler)

const MANIFEST: WorkflowManifest = {
  id: 'replay_consistency_v1',
  name: '回放一致性',
  caseType: 'oa_response',
  stages: [
    {
      id: 'legal_gaps',
      strategy: 'chain',
      description: '汇总法条缺口',
      atom: 'legal-gaps',
      params: { profile: 'oa-response' },
    },
  ],
}

const RUN_ID = 'run-replay-consistency'
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('patent workflow replay consistency', () => {
  it('replays ledger and legal-gaps from the session log and matches the persisted run', async () => {
    const ctx = new Context()
    const dir = await mkdtemp(join(tmpdir(), 'dsh-patent-replay-'))
    temporaryDirectories.push(dir)
    await ctx.plugin(PatentWorkflow)
    try {
      const session = Session.create(SessionId('replay-consistency-write'))
      session.append('turn/start', { turn: 1 })
      const store = new JsonFileWorkflowRunStore(dir)

      const result = await ctx.patentWorkflow.runWorkflow(
        MANIFEST,
        {
          input: '一种装置',
          prior_art: [{ dLabel: 'D1', title: '对比文件', url: 'https://example.test/D1' }],
        },
        () => Promise.resolve('legal-gaps 完成'),
        { persist: store, runId: RUN_ID },
        { session },
      )
      expect(result.completed).toBe(true)

      const persisted = await store.loadRun(RUN_ID)
      expect(persisted).toBeDefined()
      if (persisted === undefined) throw new Error('persisted run is missing')

      const recordedEvents = session.snapshotEvents()
      const replayedEvents = JSON.parse(JSON.stringify(recordedEvents)) as readonly SessionEvent[]
      const replayed = Session.create(SessionId('replay-consistency-read'), replayedEvents)
      // A seeded Session appends its own end-seed marker after the borrowed prefix.
      expect(replayed.snapshotEvents().slice(0, recordedEvents.length).map(event => event.type))
        .toEqual(recordedEvents.map(event => event.type))

      const [ledgerEvent] = replayed.snapshotEvents().filter(event => event.type === 'patent/evidence-ledger')
      expect(ledgerEvent).toBeDefined()
      if (ledgerEvent === undefined) throw new Error('replayed ledger event is missing')
      expect(ledgerEvent.data.manifestId).toBe(MANIFEST.id)
      expect(ledgerEvent.data.runId).toBe(RUN_ID)
      expect(ledgerEvent.data.ledger).toEqual(persisted.evidenceLedger)

      const digest = contentHash(JSON.stringify(
        ledgerEvent.data.ledger.receipts.map(receipt => [
          receipt.citationId,
          receipt.source,
          receipt.contentHash ?? '',
        ]),
      ))
      expect(digest).toBe(ledgerEvent.data.ledger.digest)

      const [gapEvent] = replayed.snapshotEvents().filter(event => event.type === 'patent/legal-gaps')
      expect(gapEvent).toBeDefined()
      if (gapEvent === undefined) throw new Error('replayed legal-gaps event is missing')
      const gapStage = persisted.stages.find(stage => stage.atom === 'legal-gaps')
      expect(gapStage).toBeDefined()
      if (gapStage === undefined) throw new Error('persisted legal-gaps stage is missing')
      expect(gapEvent.data.report).toBe(gapStage.output)
      expect(gapEvent.data.runId).toBe(RUN_ID)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
