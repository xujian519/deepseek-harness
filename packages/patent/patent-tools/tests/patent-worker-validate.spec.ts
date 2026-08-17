import { describe, expect, it } from 'vitest'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import {
  createPatentWorkerValidateTool,
  renderWorkerValidate,
  type PatentWorkerValidateOutput,
} from '../src/tool/patent-worker-validate.ts'

const exec = { signal: new AbortController().signal } as unknown as Parameters<ToolDefinition['execute']>[1]

describe('patent_worker_validate', () => {
  const tool = createPatentWorkerValidateTool()

  it('registers under patent_worker_validate', () => {
    expect(tool.name).toBe('patent_worker_validate')
  })

  it('passes a known worker whose hard fields are all present', async () => {
    const value = (await tool.execute(
      { workerName: 'patent-technical-analyzer', outputText: '技术问题\n技术特征\n技术效果' },
      exec,
    )) as PatentWorkerValidateOutput
    expect(value.found).toBe(true)
    expect(value.valid).toBe(true)
    expect(value.missingHardFields).toEqual([])
  })

  it('degrades a known worker missing hard fields', async () => {
    const value = (await tool.execute(
      { workerName: 'patent-technical-analyzer', outputText: '只有技术问题' },
      exec,
    )) as PatentWorkerValidateOutput
    expect(value.found).toBe(true)
    expect(value.valid).toBe(false)
    expect(value.missingHardFields).toEqual(expect.arrayContaining(['技术特征', '技术效果']))
    expect(value.degradationReason).toContain('技术特征')
  })

  it('returns found=false with the catalog for an unknown worker', async () => {
    const value = (await tool.execute({ workerName: 'nope', outputText: 'anything' }, exec)) as PatentWorkerValidateOutput
    expect(value.found).toBe(false)
    expect(value.valid).toBe(false)
    expect(value.availableWorkers).toEqual(expect.arrayContaining(['quality_checker', 'patent-novelty-analyzer']))
  })

  it('renders pass, degraded, and unknown-worker prose', () => {
    const pass = renderWorkerValidate({ workerName: 'w', found: true, valid: true, missingHardFields: [], missingSoftFields: [] })
    expect(pass).toContain('通过 ✅')
    const degraded = renderWorkerValidate({
      workerName: 'w',
      found: true,
      valid: false,
      missingHardFields: ['技术特征'],
      missingSoftFields: ['x'],
      degradationReason: '硬性契约字段缺失: 技术特征',
    })
    expect(degraded).toContain('降级 ⚠️')
    expect(degraded).toContain('缺失硬性字段: 技术特征')
    expect(degraded).toContain('缺失软性字段: x')
    const unknown = renderWorkerValidate({
      workerName: 'w',
      found: false,
      valid: false,
      missingHardFields: [],
      missingSoftFields: [],
      availableWorkers: ['a', 'b'],
    })
    expect(unknown).toContain('未知 worker "w"')
    expect(unknown).toContain('a, b')
  })
})
