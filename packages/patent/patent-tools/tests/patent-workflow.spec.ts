import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { registerBuiltinAtoms, type WorkflowRunResult } from '@deepseek-ai/dsh-patent-core'
import { builtinPatentManifests } from '@deepseek-ai/dsh-patent-workflow'
import {
  createPatentWorkflowTool,
  renderPatentWorkflow,
  type PatentWorkflowOutput,
} from '../src/tool/patent-workflow.ts'
import {
  resolveRunPersistTarget,
  resolveWorkflowRunsDir,
  stageFlagAndPreview,
  writeRunArtifacts,
} from '../src/tool/internal/workflow-helpers.ts'

// 镜像生产装配（B1）：内置原子注册进全局注册表，novelty 等 manifest 的 atom
// 阶段才能通过 runWorkflow 的 fail-fast。
registerBuiltinAtoms()

const exec = { signal: new AbortController().signal } as unknown as Parameters<ToolDefinition['execute']>[1]

const NOVELTY_OUTPUTS = [
  { stageId: 'parse', text: 'parsed' },
  { stageId: 'search', text: 'searched' },
  { stageId: 'compare', text: 'compared' },
  { stageId: 'conclude', text: 'concluded' },
  { stageId: 'approval', text: 'approved' },
]

describe('patent_workflow', () => {
  const tool = createPatentWorkflowTool()

  it('registers under patent_workflow', () => {
    expect(tool.name).toBe('patent_workflow')
  })

  it('returns found=false for an unknown manifest with the catalog', async () => {
    const value = (await tool.execute({ manifestId: 'nope' }, exec)) as PatentWorkflowOutput
    expect(value.found).toBe(false)
    expect(value.valid).toBe(false)
    expect(value.available).toEqual(expect.arrayContaining(['patent_novelty_v1', 'patent_disclosure_v1']))
  })

  it('assembles per-stage outputs into a completed run record', async () => {
    const value = (await tool.execute({ manifestId: 'patent_novelty_v1', outputs: NOVELTY_OUTPUTS }, exec)) as PatentWorkflowOutput
    expect(value.found).toBe(true)
    expect(value.valid).toBe(true)
    expect(value.completed).toBe(true)
    expect(value.stages).toHaveLength(5)
    expect(value.degradedSteps).toEqual([])
    expect(value.persistNote).toContain('未启用')
  })

  it('marks missing stages degraded', async () => {
    const value = (await tool.execute(
      { manifestId: 'patent_novelty_v1', outputs: [{ stageId: 'parse', text: 'only-parse' }] },
      exec,
    )) as PatentWorkflowOutput
    expect(value.completed).toBe(false)
    expect(value.degradedSteps.length).toBeGreaterThan(0)
  })

  it('renders unknown-manifest and assembled-summary prose', () => {
    const unknown = renderPatentWorkflow({
      manifestId: 'nope',
      found: false,
      valid: false,
      completed: false,
      caseType: '',
      stages: [],
      degradedSteps: [],
      summary: '',
      persistNote: '',
      available: ['patent_novelty_v1'],
    })
    expect(unknown).toContain('未知 manifest "nope"')

    const bareUnknown = renderPatentWorkflow({
      manifestId: 'nope',
      found: false,
      valid: false,
      completed: false,
      caseType: '',
      stages: [],
      degradedSteps: [],
      summary: '',
      persistNote: '',
    })
    expect(bareUnknown).toContain('可用: ')

    const assembled = renderPatentWorkflow({
      manifestId: 'patent_novelty_v1',
      found: true,
      valid: true,
      completed: true,
      caseType: 'novelty_search',
      stages: [{ stageId: 'parse', strategy: 'chain', output: 'parsed', degraded: false, retries: 0 }],
      degradedSteps: [],
      summary: '工作流 patent_novelty_v1（专利新颖性分析）: 1/1 阶段完成',
      persistNote: '持久化: 未启用（未提供 caseId）',
    })
    expect(assembled).toContain('patent_workflow(patent_novelty_v1)')
    expect(assembled).toContain('- ✅ parse (chain): parsed')
    expect(assembled).toContain('完成状态: completed')
  })

  it('defaults the manifest id, omits outputs, and persists with a case id', async () => {
    const defaulted = (await tool.execute({}, exec)) as PatentWorkflowOutput
    expect(defaulted.found).toBe(true)
    expect(defaulted.manifestId).toBe('patent_novelty_v1')
    expect(defaulted.completed).toBe(false)

    temp = await mkdtemp(join(tmpdir(), 'dsh-patent-wf-'))
    const cwdTool = createPatentWorkflowTool({ cwd: temp })
    const persisted = (await cwdTool.execute(
      { manifestId: 'patent_novelty_v1', outputs: NOVELTY_OUTPUTS, caseId: 'case-1' },
      exec,
    )) as PatentWorkflowOutput
    expect(persisted.persistNote).toContain('持久化:')
  })

  it('renders through the registered tool', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    ctx.tools.register(createPatentWorkflowTool())
    const signal = new AbortController().signal
    const result = await ctx.tools.execute({
      signal,
      callId: CallId('pw-1'),
      name: 'patent_workflow',
      arguments: { manifestId: 'patent_novelty_v1', outputs: NOVELTY_OUTPUTS },
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    const text = result.content.filter(b => b.type === 'text').map(b => b.text ?? '').join('')
    expect(text).toContain('patent_workflow(patent_novelty_v1)')
  })
})

let temp: string | undefined

afterEach(async () => {
  if (temp !== undefined) {
    await rm(temp, { recursive: true, force: true })
    temp = undefined
  }
})

describe('workflow-helpers', () => {
  it('resolves the runs dir for absolute, path-like, and plain case ids', () => {
    const cwd = '/base'
    expect(resolveWorkflowRunsDir('/abs/case', cwd)).toBe('/abs/case/workflow-runs')
    expect(resolveWorkflowRunsDir('a/b/case', cwd)).toBe('/base/a/b/case/workflow-runs')
    expect(resolveWorkflowRunsDir('plain', cwd)).toBe('/base/data/cases/plain/workflow-runs')
    const absolute = resolveRunPersistTarget('/abs/case', 'patent_novelty_v1', cwd)
    expect(absolute?.runId).toBe('case__patent_novelty_v1')
    const pathLike = resolveRunPersistTarget('a/b/case', 'patent_novelty_v1', cwd)
    expect(pathLike?.runId).toBe('case__patent_novelty_v1')
    expect(resolveRunPersistTarget(undefined, 'm', cwd)).toBeUndefined()
  })

  it('reports a persist failure instead of throwing', async () => {
    temp = await mkdtemp(join(tmpdir(), 'dsh-patent-wf-'))
    const target = {
      runsDir: temp,
      runId: 'case__patent_novelty_v1',
    }
    const manifest = builtinPatentManifests.find(m => m.manifest.id === 'patent_novelty_v1')?.manifest
    if (manifest === undefined) throw new Error('manifest missing')
    const result = {
      manifestId: 'patent_novelty_v1',
      caseType: 'novelty_search',
      summary: 's',
      completed: true,
      stages: [],
      degradedSteps: [],
      persistWarning: undefined,
    } as unknown as WorkflowRunResult
    const note = await writeRunArtifacts(target, manifest, result)
    expect(note).toContain('持久化:')

    // runsDir pointing at a regular file makes the atomic write fail → the catch path.
    const filePath = join(temp, 'blocker')
    const { writeFile: wf } = await import('node:fs/promises')
    await wf(filePath, 'x')
    const failed = await writeRunArtifacts({ runsDir: filePath, runId: 'x' }, manifest, result)
    expect(failed).toContain('持久化失败:')
  })

  it('formats stage flags and previews', () => {
    expect(stageFlagAndPreview({ stageId: 's', strategy: 'chain', output: '', degraded: false, retries: 0 })).toEqual({ flag: '✅', preview: '(无输出)' })
    expect(stageFlagAndPreview({ stageId: 's', strategy: 'chain', output: '短', degraded: true, retries: 0 })).toEqual({ flag: '⚠️ 降级', preview: '短' })
    const long = stageFlagAndPreview({ stageId: 's', strategy: 'chain', output: '长'.repeat(90), degraded: false, retries: 0 })
    expect(long.preview).toContain('…')
  })
})
