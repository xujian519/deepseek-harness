import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FlexiblePlanError, createFlexiblePlan, JsonFileFlexiblePlanStore } from '@deepseek-ai/dsh-patent-workflow'

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-flexible-plan-'))
  try {
    await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function stage(id: string, name: string, goal: string) {
  return { id, name, goal, strategy: 'chain' as const, status: 'pending' as const, artifacts: [], constraintIds: [], articleJudgments: [] }
}

describe('JsonFileFlexiblePlanStore', () => {
  it('save/load roundtrips state', async () => {
    await withTempDir(async (dir) => {
      const store = new JsonFileFlexiblePlanStore(dir)
      const plan = createFlexiblePlan('case-1', 'invalidation', {
        technicalField: '机械',
        stages: [stage('s1', '分析', '分析目标专利'), stage('s2', '检索', '检索对比文件')],
      })
      await store.savePlan(plan)
      const loaded = await store.loadPlan('case-1')
      expect(loaded).toEqual(plan)
    })
  })

  it('loadPlan returns undefined for a missing case', async () => {
    await withTempDir(async (dir) => {
      const store = new JsonFileFlexiblePlanStore(dir)
      expect(await store.loadPlan('no-such-case')).toBeUndefined()
    })
  })

  it('listCaseIds lists all cases', async () => {
    await withTempDir(async (dir) => {
      const store = new JsonFileFlexiblePlanStore(dir)
      await store.savePlan(createFlexiblePlan('case-a', 'invalidation'))
      await store.savePlan(createFlexiblePlan('case-b', 'infringement'))
      expect((await store.listCaseIds()).sort()).toEqual(['case-a', 'case-b'])
    })
  })

  it('invalid caseId (path traversal) is rejected at creation, read side defends too', async () => {
    await withTempDir(async (dir) => {
      const store = new JsonFileFlexiblePlanStore(dir)
      expect(() => createFlexiblePlan('../evil', 'invalidation')).toThrow(FlexiblePlanError)
      await expect(store.loadPlan('../evil')).rejects.toThrow(RangeError)
      await expect(store.loadPlan('.hidden')).rejects.toThrow(RangeError)
    })
  })

  it('listCaseIds filters foreign files from the directory', async () => {
    await withTempDir(async (dir) => {
      const store = new JsonFileFlexiblePlanStore(dir)
      await store.savePlan(createFlexiblePlan('case-a', 'invalidation'))
      await writeFile(join(dir, 'draft 2.json'), '{}', 'utf8')
      await writeFile(join(dir, '.hidden.json'), '{}', 'utf8')
      expect(await store.listCaseIds()).toEqual(['case-a'])
    })
  })

  it('saved file is valid JSON carrying full state', async () => {
    await withTempDir(async (dir) => {
      const store = new JsonFileFlexiblePlanStore(dir)
      const plan = createFlexiblePlan('case-x', 'drafting', { stages: [stage('s1', '撰写', '撰写权利要求')] })
      await store.savePlan(plan)
      const raw = await readFile(join(dir, 'case-x.json'), 'utf8')
      const parsed = JSON.parse(raw) as { caseId: string; caseType: string; stages: unknown[] }
      expect(parsed.caseId).toBe('case-x')
      expect(parsed.caseType).toBe('drafting')
      expect(parsed.stages).toHaveLength(1)
    })
  })

  it('multiple saves overwrite the same case (idempotent)', async () => {
    await withTempDir(async (dir) => {
      const store = new JsonFileFlexiblePlanStore(dir)
      await store.savePlan(createFlexiblePlan('case-1', 'invalidation'))
      await store.savePlan(createFlexiblePlan('case-1', 'infringement'))
      expect((await store.loadPlan('case-1'))?.caseType).toBe('infringement')
    })
  })
})
