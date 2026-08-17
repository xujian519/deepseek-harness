import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  InMemoryWorkflowRunStore,
  JsonFileWorkflowRunStore,
  patentNoveltyManifest,
  runWorkflow,
  type WorkflowContext,
  type WorkflowRunStore,
  type WorkflowStage,
} from '@deepseek-ai/dsh-patent-workflow'

function okExecutor(stage: WorkflowStage, ctx: WorkflowContext): Promise<string> {
  return Promise.resolve('[' + stage.id + '] 完成。输入: ' + (ctx.input ?? ''))
}

describe('workflow-run stores', () => {
  it('runWorkflow with InMemoryWorkflowRunStore persists the result', async () => {
    const store = new InMemoryWorkflowRunStore()
    const result = await runWorkflow(patentNoveltyManifest, { input: '一种自动化分拣装置' }, okExecutor, { persist: store })
    const loaded = await store.loadRun('patent_novelty_v1')
    expect(loaded).toBeDefined()
    expect(loaded).toEqual(result)
    expect(await store.listRuns()).toEqual(['patent_novelty_v1'])
  })

  it('InMemoryWorkflowRunStore honors a custom runId', async () => {
    const store = new InMemoryWorkflowRunStore()
    await runWorkflow(patentNoveltyManifest, {}, okExecutor, { persist: store, runId: 'case-001' })
    expect((await store.loadRun('case-001'))?.manifestId).toBe('patent_novelty_v1')
    expect(await store.loadRun('patent_novelty_v1')).toBeUndefined()
  })

  it('JsonFileWorkflowRunStore roundtrips through the filesystem', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-wf-'))
    try {
      const store = new JsonFileWorkflowRunStore(dir)
      const result = await runWorkflow(patentNoveltyManifest, {}, okExecutor, { persist: store })
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
    const result = await runWorkflow(patentNoveltyManifest, {}, okExecutor, { persist: failingStore })
    expect(result.completed).toBe(true)
    expect(result.persistWarning ?? '').toMatch(/持久化失败/)
    expect(result.persistWarning ?? '').toMatch(/disk full/)
  })
})
