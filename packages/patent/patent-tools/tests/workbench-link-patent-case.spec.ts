import { describe, expect, it } from 'vitest'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { PatentToolError } from '../src/error.ts'
import {
  createWorkbenchLinkPatentCaseTool,
  parseMatterLogStages,
  type WorkbenchLinkPatentCaseOutput,
} from '../src/tool/workbench-link-patent-case.ts'

const exec = { signal: new AbortController().signal } as unknown as Parameters<ToolDefinition['execute']>[1]

/** One recorded outgoing call. */
interface Call { method: string; url: string; body?: unknown }

/** String-field projection off an untyped JSON body. */
const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

/** In-memory stand-in for the workbench plugin's HTTP API subset the bridge uses. */
interface SimTask {
  id: string
  parentId: string | null
  title: string
  typeCode: string
  statusCode: string
  source: string
  workspacePath: string | null
}

class WorkbenchSim {
  readonly calls: Call[] = []
  private readonly dictionaries = new Set<string>()
  private readonly tasks: SimTask[] = []
  private seq = 0

  readonly fetchJson = async (url: string, init?: { method?: string; body?: string }): Promise<{ status: number; json: unknown }> => {
    const method = init?.method ?? 'GET'
    const path = url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '')
    const body = init?.body === undefined ? undefined : JSON.parse(init.body) as Record<string, unknown>
    this.calls.push({ method, url: path, ...(body === undefined ? {} : { body }) })
    if (path === '/api/workbench/dictionaries' && method === 'GET') {
      return { status: 200, json: { ok: true, dictionaries: [...this.dictionaries].map(code => ({ code })) } }
    }
    if (path === '/api/workbench/dictionaries' && method === 'POST') {
      const code = str(body?.code)
      if (code === undefined) return { status: 400, json: { error: 'code required' } }
      this.dictionaries.add(code)
      return { status: 200, json: { ok: true, dictionary: { code } } }
    }
    if (path === '/api/workbench/tasks' && method === 'GET') {
      return { status: 200, json: { ok: true, tasks: this.tasks } }
    }
    if (path === '/api/workbench/tasks' && method === 'POST') {
      const title = str(body?.title)
      const typeCode = str(body?.typeCode)
      if (title === undefined || typeCode === undefined || !this.dictionaries.has(typeCode)) {
        return { status: 400, json: { error: 'invalid task' } }
      }
      const statusCode = str(body?.statusCode)
      const task = {
        id: `t${++this.seq}`,
        parentId: str(body?.parentId) ?? null,
        title,
        typeCode,
        statusCode: statusCode ?? 'todo',
        source: str(body?.source) ?? 'manual',
        workspacePath: str(body?.workspacePath) ?? null,
      }
      this.tasks.push(task)
      return { status: 201, json: { ok: true, task } }
    }
    if (method === 'PATCH' && path.startsWith('/api/workbench/tasks/')) {
      const taskId = path.slice('/api/workbench/tasks/'.length)
      const task = this.tasks.find(t => t.id === taskId)
      const statusCode = str(body?.statusCode)
      if (task === undefined || statusCode === undefined) return { status: 400, json: { error: 'invalid patch' } }
      task.statusCode = statusCode
      return { status: 200, json: { ok: true, task } }
    }
    return { status: 404, json: { error: 'no stub route' } }
  }
}

function makeTool(sim: WorkbenchSim, matterLog: string | null, baseUrl = 'http://127.0.0.1:3180') {
  return createWorkbenchLinkPatentCaseTool({
    baseUrl,
    caseRoot: '/cases',
    fetchJson: sim.fetchJson,
    readMatterLog: async () => matterLog,
  })
}

const LOG_L1_DONE_L2_DOING = [
  '# 案件日志',
  '2026-09-01 L1 交底书理解 完成，产出结构化交底书',
  '2026-09-02 L2 现有技术检索 进行中，已获 D1/D2',
].join('\n')

describe('parseMatterLogStages', () => {
  it('marks stages done/doing from completion/progress words', () => {
    expect(parseMatterLogStages(LOG_L1_DONE_L2_DOING)).toEqual({ l1: 'done', l2: 'doing' })
  })

  it('lets later lines override earlier ones (append-only, last wins)', () => {
    const log = ['L3 开始撰写', 'L3 撰写完成'].join('\n')
    expect(parseMatterLogStages(log)).toEqual({ l3: 'done' })
  })

  it('applies one line verdict to every stage mentioned on that line', () => {
    expect(parseMatterLogStages('L1 与 L2 均已完成')).toEqual({ l1: 'done', l2: 'done' })
  })

  it('returns an empty projection when no stage is mentioned', () => {
    expect(parseMatterLogStages('客户来电，讨论费用')).toEqual({})
  })
})

describe('workbench_link_patent_case', () => {
  it('first link: ensures dictionaries, creates root + five stages, projects the log', async () => {
    const sim = new WorkbenchSim()
    const value = await makeTool(sim, LOG_L1_DONE_L2_DOING).execute({ caseNumber: '202311060998.X' }, exec) as WorkbenchLinkPatentCaseOutput
    expect(value.ok).toBe(true)
    expect(value.matterLogFound).toBe(true)
    expect(value.caseDir).toBe('/cases/202311060998.X')
    expect(value.rootTaskId).toBe('t1')
    expect(value.dictionariesEnsured).toHaveLength(6)
    expect(value.stages.map(s => [s.stage, s.taskId, s.statusCode, s.created])).toEqual([
      ['l1', 't2', 'done', true],
      ['l2', 't3', 'doing', true],
      ['l3', 't4', 'todo', true],
      ['l4', 't5', 'todo', true],
      ['l5', 't6', 'todo', true],
    ])
    // Root task carries the patent markers; stage tasks carry the parent link.
    const createdTasks = sim.calls.filter(c => c.method === 'POST' && c.url === '/api/workbench/tasks').map(c => c.body as Record<string, unknown>)
    expect(createdTasks.find(t => t.typeCode === 'patent_case')).toMatchObject({ title: '202311060998.X', source: 'patent', workspacePath: '/cases/202311060998.X' })
    expect(createdTasks.find(t => t.typeCode === 'patent_stage_l1')).toMatchObject({ statusCode: 'done', source: 'patent' })
    // Stage statuses landed at creation; no PATCH is needed on first link.
    expect(sim.calls.filter(c => c.method === 'PATCH')).toHaveLength(0)
  })

  it('second link is idempotent: no dictionary POST, no task POST, no PATCH', async () => {
    const sim = new WorkbenchSim()
    const tool = makeTool(sim, LOG_L1_DONE_L2_DOING)
    await tool.execute({ caseNumber: '202311060998.X' }, exec)
    sim.calls.length = 0
    const value = await tool.execute({ caseNumber: '202311060998.X' }, exec) as WorkbenchLinkPatentCaseOutput
    expect(value.ok).toBe(true)
    expect(value.dictionariesEnsured).toEqual([])
    expect(value.stages.every(s => !s.created && !s.changed)).toBe(true)
    expect(sim.calls.filter(c => c.method !== 'GET')).toHaveLength(0)
  })

  it('pulls stage progress: a later matter-log line PATCHes the changed stage only', async () => {
    const sim = new WorkbenchSim()
    const tool = makeTool(sim, 'L2 检索 进行中')
    await tool.execute({ caseNumber: 'CN1' }, exec)
    sim.calls.length = 0
    const value = await makeTool(sim, 'L2 检索 完成\nL3 撰写 开始').execute({ caseNumber: 'CN1' }, exec) as WorkbenchLinkPatentCaseOutput
    const patches = sim.calls.filter(c => c.method === 'PATCH')
    expect(patches.map(p => (p.body as Record<string, unknown>).statusCode).sort()).toEqual(['doing', 'done'])
    expect(value.stages.find(s => s.stage === 'l2')).toMatchObject({ statusCode: 'done', changed: true })
    expect(value.stages.find(s => s.stage === 'l3')).toMatchObject({ statusCode: 'doing', changed: true })
    // The root task status is never touched (cascade avoidance).
    expect(patches.every(p => p.url !== `/api/workbench/tasks/${value.rootTaskId}`)).toBe(true)
  })

  it('explicit stages input overrides the matter-log heuristic', async () => {
    const sim = new WorkbenchSim()
    const tool = makeTool(sim, 'L1 完成')
    await tool.execute({ caseNumber: 'CN1' }, exec)
    sim.calls.length = 0
    const value = await tool.execute({ caseNumber: 'CN1', stages: [{ stage: 'l1', statusCode: 'doing' }] }, exec) as WorkbenchLinkPatentCaseOutput
    expect(value.stages.find(s => s.stage === 'l1')).toMatchObject({ statusCode: 'doing', changed: true })
  })

  it('dryRun computes the projection without a single write call', async () => {
    const sim = new WorkbenchSim()
    const value = await makeTool(sim, LOG_L1_DONE_L2_DOING).execute({ caseNumber: 'CN1', dryRun: true }, exec) as WorkbenchLinkPatentCaseOutput
    expect(value.dryRun).toBe(true)
    expect(value.rootTaskId).toBe('')
    expect(value.matterLogFound).toBe(true)
    expect(sim.calls.filter(c => c.method !== 'GET')).toHaveLength(0)
  })

  it('never writes the case directory: only the matter-log read happens', async () => {
    let reads = 0
    const sim = new WorkbenchSim()
    const tool = createWorkbenchLinkPatentCaseTool({
      baseUrl: 'http://127.0.0.1:3180',
      caseRoot: '/cases',
      fetchJson: sim.fetchJson,
      readMatterLog: async () => { reads += 1; return null },
    })
    await tool.execute({ caseNumber: 'CN1' }, exec)
    expect(reads).toBe(1)
    expect(sim.calls.every(c => c.url.startsWith('/api/workbench/'))).toBe(true)
  })

  it('fails closed on an empty case number', async () => {
    const sim = new WorkbenchSim()
    await expect(makeTool(sim, null).execute({ caseNumber: '  ' }, exec)).rejects.toMatchObject({ code: 'invalid_tool_input' })
  })

  it('fails loud with setup_required when no workbench base URL resolves', async () => {
    const tool = createWorkbenchLinkPatentCaseTool({ caseRoot: '/cases', fetchJson: new WorkbenchSim().fetchJson, readMatterLog: async () => null })
    await expect(tool.execute({ caseNumber: 'CN1' }, exec)).rejects.toMatchObject({ code: 'setup_required' })
  })

  it('surfaces an HTTP failure from the workbench API', async () => {
    const fetchJson = async (): Promise<{ status: number; json: unknown }> => ({ status: 500, json: { error: 'boom' } })
    const tool = createWorkbenchLinkPatentCaseTool({ baseUrl: 'http://127.0.0.1:3180', caseRoot: '/cases', fetchJson, readMatterLog: async () => null })
    await expect(tool.execute({ caseNumber: 'CN1' }, exec)).rejects.toMatchObject({ code: 'tool_execution_failed' })
  })

  it('rejects a malformed task row at the wire boundary', async () => {
    const fetchJson = async (): Promise<{ status: number; json: unknown }> => ({ status: 200, json: { ok: true, tasks: [{ title: 'no id' }] } })
    const tool = createWorkbenchLinkPatentCaseTool({ baseUrl: 'http://127.0.0.1:3180', caseRoot: '/cases', fetchJson, readMatterLog: async () => null })
    await expect(tool.execute({ caseNumber: 'CN1' }, exec)).rejects.toMatchObject({ code: 'tool_execution_failed' })
  })

  it('throws PatentToolError instances (stable taxonomy)', async () => {
    const tool = createWorkbenchLinkPatentCaseTool({ caseRoot: '/cases', readMatterLog: async () => null })
    await expect(tool.execute({ caseNumber: '' }, exec)).rejects.toThrow(PatentToolError)
  })
})
