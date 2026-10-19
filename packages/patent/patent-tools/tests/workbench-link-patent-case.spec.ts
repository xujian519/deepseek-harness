import { describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { PatentToolError } from '../src/error.ts'
import {
  createWorkbenchLinkPatentCaseTool,
  parseMatterLogStages,
  renderLinkResult,
  type WorkbenchLinkPatentCaseDeps,
  type WorkbenchLinkPatentCaseOutput,
} from '../src/tool/workbench-link-patent-case.ts'

/** Signature of the injectable HTTP seam (stubs below stay assignable to it). */
type FetchJson = NonNullable<WorkbenchLinkPatentCaseDeps['fetchJson']>

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

  it('marks a mentioned stage without progress or completion words as todo and skips blank lines', () => {
    expect(parseMatterLogStages('\n\nL4 等待补充材料\n')).toEqual({ l4: 'todo' })
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

  it('renders the model-facing summary, matter-log state, and one row per stage', async () => {
    const sim = new WorkbenchSim()
    const value = await makeTool(sim, LOG_L1_DONE_L2_DOING).execute({ caseNumber: '202311060998.X' }, exec) as WorkbenchLinkPatentCaseOutput
    const text = renderLinkResult(value)
    expect(text.split('\n')[0]).toBe('workbench_link_patent_case: 案件 202311060998.X → 根任务 t1')
    expect(text).toContain('matter-log: 已解析')
    // One row per stage, each naming the stage, its code, and its status.
    const rows = text.split('\n').filter(line => line.startsWith('- '))
    expect(rows).toHaveLength(value.stages.length)
    for (const [index, stage] of value.stages.entries()) {
      expect(rows[index]).toContain(stage.stage)
      expect(rows[index]).toContain(stage.statusCode ?? '（无状态）')
    }
  })

  it('renders the failure line and the dry-run markers', () => {
    expect(renderLinkResult({ ok: false, error: '网络错误' } as WorkbenchLinkPatentCaseOutput))
      .toBe('workbench_link_patent_case: 网络错误')
    const dry = renderLinkResult({
      ok: true,
      caseNumber: 'CN1',
      caseDir: '/cases/CN1',
      rootTaskId: '',
      matterLogFound: false,
      dictionariesEnsured: ['PATENT', 'LIT'],
      stages: [{ stage: 'l1', typeCode: 'patent_stage_l1', taskId: null, statusCode: null, created: false, changed: false }],
      dryRun: true,
    })
    expect(dry).toContain('workbench_link_patent_case: 案件 CN1 → 根任务 （dryRun 未创建） [dryRun]')
    expect(dry).toContain('新增字典: PATENT, LIT')
    expect(dry).toContain('matter-log: 未找到')
    expect(dry).toContain('- l1 ')
    expect(dry).toContain('（无状态）')
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

  it('rejects a case number that is not a single directory name, before any HTTP call', async () => {
    const sim = new WorkbenchSim()
    const tool = makeTool(sim, null)
    for (const caseNumber of ['../x', 'a/b', '..', '.', 'a\\b']) {
      await expect(tool.execute({ caseNumber }, exec)).rejects.toMatchObject({ code: 'invalid_tool_input' })
    }
    expect(sim.calls).toHaveLength(0)
  })

  it('bounds every workbench request with a signal composed from exec.signal', async () => {
    const seen: Array<AbortSignal | undefined> = []
    const controller = new AbortController()
    const fetchJson: FetchJson = async (_url, init) => {
      seen.push(init?.signal)
      if (init?.method === 'POST' || init?.method === 'PATCH') {
        return { status: 200, json: { ok: true, task: { id: 't1', parentId: null, title: 'CN1', typeCode: 'patent_case', statusCode: 'todo', source: 'patent' } } }
      }
      return { status: 200, json: { ok: true, dictionaries: [], tasks: [] } }
    }
    const tool = createWorkbenchLinkPatentCaseTool({ baseUrl: 'http://127.0.0.1:3180', caseRoot: '/cases', fetchJson, readMatterLog: async () => null })
    await tool.execute({ caseNumber: 'CN1' }, { signal: controller.signal } as Parameters<ToolDefinition['execute']>[1])
    expect(seen.length).toBeGreaterThan(0)
    // 每个请求的信号都来自组合（不是调用方信号本身），并继承调用方取消。
    expect(seen.every(signal => signal instanceof AbortSignal && signal !== controller.signal)).toBe(true)
    controller.abort()
    expect(seen.every(signal => signal?.aborted === true)).toBe(true)
  })

  it('reports a caller cancel as tool_aborted, not a request failure', async () => {
    const controller = new AbortController()
    const fetchJson = async (): Promise<{ status: number; json: unknown }> => {
      controller.abort()
      throw new DOMException('This operation was aborted', 'AbortError')
    }
    const tool = createWorkbenchLinkPatentCaseTool({ baseUrl: 'http://127.0.0.1:3180', caseRoot: '/cases', fetchJson, readMatterLog: async () => null })
    await expect(tool.execute({ caseNumber: 'CN1' }, { signal: controller.signal } as Parameters<ToolDefinition['execute']>[1]))
      .rejects.toMatchObject({ code: 'tool_aborted' })
  })

  it('converges a timed-out request (AbortError with the caller still live) into tool_execution_failed', async () => {
    const fetchJson = async (): Promise<{ status: number; json: unknown }> => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    }
    const tool = createWorkbenchLinkPatentCaseTool({ baseUrl: 'http://127.0.0.1:3180', caseRoot: '/cases', fetchJson, readMatterLog: async () => null })
    await expect(tool.execute({ caseNumber: 'CN1' }, exec)).rejects.toMatchObject({ code: 'tool_execution_failed' })
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

  it('renders a bare failure and the created/changed/dictionary markers', () => {
    expect(renderLinkResult({ ok: false } as WorkbenchLinkPatentCaseOutput))
      .toBe('workbench_link_patent_case: 失败')
    const tool = makeTool(new WorkbenchSim(), null)
    const blocks = tool.output.render({}, { ok: false, error: '网络错误' })
    expect(blocks.map(block => ('text' in block ? block.text : '')).join('')).toContain('网络错误')
    const text = renderLinkResult({
      ok: true,
      caseNumber: 'CN1',
      caseDir: '/cases/CN1',
      rootTaskId: 't1',
      matterLogFound: false,
      dictionariesEnsured: [],
      stages: [
        { stage: 'l1', typeCode: 'patent_stage_l1', taskId: 't2', statusCode: 'done', created: true, changed: true },
        { stage: 'l2', typeCode: 'patent_stage_l2', taskId: 't3', statusCode: 'doing', created: false, changed: true },
        { stage: 'l3', typeCode: 'patent_stage_l3', taskId: null, statusCode: null, created: false, changed: false },
      ],
    })
    expect(text).toContain('- l1 L1 交底书理解: done（新建）（已同步）')
    expect(text).toContain('- l2 L2 现有技术检索: doing（已同步）')
    expect(text).toContain('- l3 L3 申请文件撰写: （无状态）')
    expect(text).not.toContain('新增字典')
  })

  it('rejects a blank case root override', async () => {
    const sim = new WorkbenchSim()
    await expect(makeTool(sim, null).execute({ caseNumber: 'CN1', caseRoot: '  ' }, exec))
      .rejects.toMatchObject({ code: 'invalid_tool_input' })
    expect(sim.calls).toHaveLength(0)
  })

  it('reads the matter log from disk by default and treats a missing file as absent', async () => {
    const sim = new WorkbenchSim()
    const dir = mkdtempSync(join(tmpdir(), 'dsh-workbench-'))
    try {
      mkdirSync(join(dir, 'CN1'))
      writeFileSync(join(dir, 'CN1', '_matter-log.md'), 'L1 完成\n', 'utf8')
      const withLog = createWorkbenchLinkPatentCaseTool({ baseUrl: 'http://127.0.0.1:3180', caseRoot: dir, fetchJson: sim.fetchJson })
      const value = await withLog.execute({ caseNumber: 'CN1' }, exec) as WorkbenchLinkPatentCaseOutput
      expect(value.matterLogFound).toBe(true)
      expect(value.stages.find(stage => stage.stage === 'l1')?.statusCode).toBe('done')

      const withoutLog = await withLog.execute({ caseNumber: 'CN2' }, exec) as WorkbenchLinkPatentCaseOutput
      expect(withoutLog.matterLogFound).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rethrows an unreadable matter log that is not a missing file', async () => {
    const sim = new WorkbenchSim()
    const dir = mkdtempSync(join(tmpdir(), 'dsh-workbench-'))
    try {
      writeFileSync(join(dir, 'CN1'), 'not a directory', 'utf8')
      const tool = createWorkbenchLinkPatentCaseTool({ baseUrl: 'http://127.0.0.1:3180', caseRoot: dir, fetchJson: sim.fetchJson })
      await expect(tool.execute({ caseNumber: 'CN1' }, exec)).rejects.toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects a malformed dictionary or task payload at the wire boundary', async () => {
    const fetchJson: FetchJson = async (url, init) => {
      if (init?.method !== undefined) {
        return { status: 201, json: { ok: true, task: { id: 't1', parentId: null, title: 'CN1', typeCode: 'patent_case', statusCode: 'todo', source: 'patent' } } }
      }
      if (url.includes('/dictionaries')) return { status: 200, json: { ok: true, dictionaries: [{ code: 42 }] } }
      return { status: 200, json: {} }
    }
    const tool = createWorkbenchLinkPatentCaseTool({ baseUrl: 'http://127.0.0.1:3180', caseRoot: '/cases', fetchJson, readMatterLog: async () => null })
    const value = await tool.execute({ caseNumber: 'CN1' }, exec) as WorkbenchLinkPatentCaseOutput
    expect(value.ok).toBe(true)
    expect(value.dictionariesEnsured).toHaveLength(6)

    const badTasks = createWorkbenchLinkPatentCaseTool({
      baseUrl: 'http://127.0.0.1:3180',
      caseRoot: '/cases',
      fetchJson: async () => ({ status: 200, json: { ok: true, tasks: [null] } }),
      readMatterLog: async () => null,
    })
    await expect(badTasks.execute({ caseNumber: 'CN1' }, exec)).rejects.toThrow('不是对象')
  })

  it('normalizes a non-string parent id and a non-string source', async () => {
    const task = { id: 't1', parentId: 42, title: 'CN1', typeCode: 'patent_case', statusCode: 'todo', source: 'patent' }
    const stranger = { id: 't9', parentId: null, title: '其它', typeCode: 'manual', statusCode: 'todo', source: 7 }
    const fetchJson: FetchJson = async (url, init) => {
      if (init?.method !== undefined) return { status: 200, json: { ok: true, task: { ...task, id: 't2' } } }
      if (url.includes('/dictionaries')) return { status: 200, json: { ok: true, dictionaries: [] } }
      return { status: 200, json: { ok: true, tasks: [task, stranger] } }
    }
    const tool = createWorkbenchLinkPatentCaseTool({ baseUrl: 'http://127.0.0.1:3180', caseRoot: '/cases', fetchJson, readMatterLog: async () => null })
    const value = await tool.execute({ caseNumber: 'CN1' }, exec) as WorkbenchLinkPatentCaseOutput
    expect(value.ok).toBe(true)
    expect(value.rootTaskId).toBe('t1')
  })

  it('reports a non-Error transport failure and an error body without a message', async () => {
    const stringThrow = createWorkbenchLinkPatentCaseTool({
      baseUrl: 'http://127.0.0.1:3180',
      caseRoot: '/cases',
      fetchJson: async () => {
        throw 'transport died'
      },
      readMatterLog: async () => null,
    })
    await expect(stringThrow.execute({ caseNumber: 'CN1' }, exec)).rejects.toThrow('transport died')

    const emptyBody = createWorkbenchLinkPatentCaseTool({
      baseUrl: 'http://127.0.0.1:3180',
      caseRoot: '/cases',
      fetchJson: async () => ({ status: 500, json: {} }),
      readMatterLog: async () => null,
    })
    await expect(emptyBody.execute({ caseNumber: 'CN1' }, exec)).rejects.toThrow('返回 HTTP 500')
  })

  it('uses the default JSON-over-HTTP transport when none is injected', async () => {
    const fetchStub = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      const path = new URL(url).pathname
      const json = async (): Promise<unknown> => {
        if (init?.method !== undefined) {
          return { ok: true, task: { id: 't2', parentId: init.body === undefined ? null : 't1', title: 'CN1', typeCode: 'patent_case', statusCode: 'todo', source: 'patent' } }
        }
        if (path === '/api/workbench/dictionaries') return { ok: true, dictionaries: [] }
        return { ok: true, tasks: [] }
      }
      return { status: 200, json }
    })
    vi.stubGlobal('fetch', fetchStub)
    try {
      const dir = mkdtempSync(join(tmpdir(), 'dsh-workbench-'))
      try {
        mkdirSync(join(dir, 'CN1'))
        writeFileSync(join(dir, 'CN1', '_matter-log.md'), 'L1 完成\n', 'utf8')
        const tool = createWorkbenchLinkPatentCaseTool({ baseUrl: 'http://127.0.0.1:3180', caseRoot: dir })
        const value = await tool.execute({ caseNumber: 'CN1' }, exec) as WorkbenchLinkPatentCaseOutput
        expect(value.ok).toBe(true)
        expect(fetchStub).toHaveBeenCalled()
        const methods = fetchStub.mock.calls.map(call => call[1]?.method ?? 'GET')
        expect(methods).toContain('GET')
        expect(methods).toContain('POST')
        expect(fetchStub.mock.calls.some(call => call[1]?.body !== undefined)).toBe(true)
        expect(fetchStub.mock.calls.every(call => (call[1] as { signal?: AbortSignal } | undefined)?.signal !== undefined)).toBe(true)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('survives an unparseable transport body', async () => {
    const fetchStub = vi.fn(async () => ({ status: 200, json: async () => { throw new SyntaxError('bad body') } }))
    vi.stubGlobal('fetch', fetchStub)
    try {
      const tool = createWorkbenchLinkPatentCaseTool({ baseUrl: 'http://127.0.0.1:3180', caseRoot: '/cases', readMatterLog: async () => null })
      await expect(tool.execute({ caseNumber: 'CN1' }, exec)).rejects.toThrow()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
