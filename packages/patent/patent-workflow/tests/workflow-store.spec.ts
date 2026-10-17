import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { globalAtomRegistry, registerBuiltinAtoms } from '@deepseek-ai/dsh-patent-core'
import type { StageProvider, WorkflowManifest } from '@deepseek-ai/dsh-patent-core'
import {
  InMemoryWorkflowRunStore,
  JsonFileWorkflowRunStore,
  patentNoveltyManifest,
  runWorkflow,
  type WorkflowContext,
  type WorkflowRunStore,
  type WorkflowStage,
} from '@deepseek-ai/dsh-patent-workflow'

// 镜像生产装配（B1）：内置原子注册进全局注册表，novelty 等 manifest 的 atom 阶段才能通过 fail-fast。
registerBuiltinAtoms()
// legal-gaps 的真实注册在 patent-tools apply()；此处注册契约 stub 使内置 manifest 通过校验。
globalAtomRegistry.register({
  name: 'legal-gaps',
  category: 'gate',
  description: 'test stub — 真实注册在 patent-tools apply()',
  inputSchema: [],
  outputSchema: ['legal_gaps_report'],
})

function okExecutor(stage: WorkflowStage, ctx: WorkflowContext): Promise<string> {
  return Promise.resolve('[' + stage.id + '] 完成。输入: ' + (ctx.input ?? ''))
}

/** 原子检索所需的最小 provider：稳定关键词 JSON + 空语料。 */
const emptySearchProvider: StageProvider = {
  callLLM: async () => '{"keywords":["装置"]}',
  search: async () => [],
}

describe('workflow-run stores', () => {
  it('runWorkflow with InMemoryWorkflowRunStore persists the result', async () => {
    const store = new InMemoryWorkflowRunStore()
    const result = await runWorkflow(patentNoveltyManifest, { input: '一种自动化分拣装置' }, okExecutor, { persist: store, approvalGrants: ['approval'] })
    const loaded = await store.loadRun('patent_novelty_v1')
    expect(loaded).toBeDefined()
    expect(loaded).toEqual(result)
    expect(await store.listRuns()).toEqual(['patent_novelty_v1'])
  })

  it('InMemoryWorkflowRunStore honors a custom runId', async () => {
    const store = new InMemoryWorkflowRunStore()
    await runWorkflow(patentNoveltyManifest, {}, okExecutor, { persist: store, runId: 'case-001', approvalGrants: ['approval'] })
    expect((await store.loadRun('case-001'))?.manifestId).toBe('patent_novelty_v1')
    expect(await store.loadRun('patent_novelty_v1')).toBeUndefined()
  })

  it('JsonFileWorkflowRunStore roundtrips through the filesystem', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-wf-'))
    try {
      const store = new JsonFileWorkflowRunStore(dir)
      const result = await runWorkflow(patentNoveltyManifest, {}, okExecutor, { persist: store, approvalGrants: ['approval'] })
      const loaded = await store.loadRun('patent_novelty_v1')
      expect(loaded).toBeDefined()
      expect(loaded).toEqual(result)
      expect(await store.listRuns()).toEqual(['patent_novelty_v1'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('JsonFileWorkflowRunStore returns undefined / empty list for missing runs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-wf-'))
    try {
      const store = new JsonFileWorkflowRunStore(dir)
      expect(await store.loadRun('nope')).toBeUndefined()
      expect(await store.listRuns()).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('runWorkflow without persist does not write anything', async () => {
    const store = new InMemoryWorkflowRunStore()
    await runWorkflow(patentNoveltyManifest, {}, okExecutor)
    expect(await store.listRuns()).toEqual([])
  })

  it('JsonFileWorkflowRunStore rejects runIds with path separators or traversal', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-wf-'))
    try {
      const store = new JsonFileWorkflowRunStore(dir)
      const result = await runWorkflow(patentNoveltyManifest, {}, okExecutor)
      for (const bad of ['../evil', 'a/b', 'a\\b', '.hidden', '', '..']) {
        await expect(store.saveRun(result, bad)).rejects.toThrow(RangeError)
        await expect(store.loadRun(bad)).rejects.toThrow(RangeError)
      }
      await store.saveRun(result, 'case-001.run_v2')
      expect(await store.loadRun('case-001.run_v2')).toBeDefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('runWorkflow degrades gracefully when persist saveRun throws', async () => {
    const failingStore: WorkflowRunStore = {
      saveRun: async () => { throw new Error('disk full') },
      loadRun: async () => undefined,
      listRuns: async () => [],
    }
    const result = await runWorkflow(
      patentNoveltyManifest,
      { input: '一种装置', filing_date: '2024-06-01' },
      okExecutor,
      { persist: failingStore, approvalGrants: ['approval'], provider: emptySearchProvider },
    )
    expect(result.completed).toBe(true)
    expect(result.persistWarning ?? '').toMatch(/持久化失败/)
    expect(result.persistWarning ?? '').toMatch(/disk full/)
  })
})

it('interrupted run reports incomplete even with requireAllSteps=false', async () => {
  const manifest: WorkflowManifest = {
    id: 'gated_optional',
    name: '审批门',
    caseType: 'x',
    stages: [{ id: 'approval', strategy: 'chain', description: '人工确认', atom: 'approval-gate' }],
    validation: { requireAllSteps: false, maxRetries: 0 },
  }
  const result = await runWorkflow(manifest, {}, okExecutor)
  expect(result.interrupted).toBeDefined()
  expect(result.interrupted!.stageId).toBe('approval')
  expect(result.completed).toBe(false)
})
