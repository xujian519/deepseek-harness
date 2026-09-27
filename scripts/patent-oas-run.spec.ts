/**
 * `patent-oas` 实测采集器的验收测试。
 *
 * 真正的 agent 进程通过接缝注入桩,因此编排、提示词契约、产物契约、聚合口径,以及
 * 「采集出的记录必须能被门禁判定」这条端到端链路都能在无 key 环境下被验证。唯一
 * 未被验证的是「真实模型会按契约写出产物」——那需要 key,由 README 如实登记。
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  GATE_FILE,
  PATENT_OAS_EXAMPLE_DIR,
  PROBLEM_SPACE_FILE,
  caseScores,
  evaluateRun,
  loadGateConfig,
  loadGold,
  loadProblemSpace,
  loadRunRecord,
  parseRubricDimensions,
  validateRunRecord,
  verdictPassed,
} from './patent-oas-gate-core.ts'
import {
  AGENT_LOG_FILENAME,
  DELIVERABLE_FILENAME,
  MAX_DELIVERABLE_BYTES,
  SCORE_FILENAME,
  agentArgv,
  collectRunRecord,
  credentialEnvFiles,
  evaluatorPrompt,
  executorPrompt,
  hasCredentialSignal,
  parseRunnerOptions,
  parseScore,
  planRun,
  spawnAgentProcess,
  writeRunRecord,
  type AgentInvocation,
  type RunAgents,
} from './patent-oas-run-core.ts'

const root = resolve(import.meta.dirname, '..')
const exampleDir = resolve(root, PATENT_OAS_EXAMPLE_DIR)
const gold = await loadGold(exampleDir)
const space = await loadProblemSpace(resolve(root, PROBLEM_SPACE_FILE))
const config = await loadGateConfig(resolve(root, GATE_FILE))
const guidance = readFileSync(join(exampleDir, 'patent-state', 'guidance.md'), 'utf8')

const scratchDirs: string[] = []
afterAll(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true })
})

/** 取列表首项;空列表即测试装置出错。 */
function first<T>(values: readonly T[]): T {
  const value = values[0]
  if (value === undefined) throw new Error('fixture: 期望非空列表')
  return value
}

/** 建一个临时工作目录。 */
function scratch(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `patent-oas-${label}-`))
  scratchDirs.push(dir)
  return dir
}

/** 桩接缝的行为选项。 */
interface StubOptions {
  /** 每次评估调用给出的分数;缺省 90,可用来构造回退场景。 */
  scoreFor?: (label: string, call: number) => number
  /** 交付物正文;缺省为一句可辨识的占位文本。 */
  deliverable?: string
  /** 不写出交付物,用来验证「agent 没产出产物」的失败路径。 */
  omitDeliverable?: boolean
  /** 不写出分数文件。 */
  omitScore?: boolean
  /** 污染分数文件内容,用来验证解析失败路径。 */
  scoreBody?: string
}

/** 造一个桩接缝:按契约把产物写进调用目录,并记录每次调用。 */
function stubAgents(options: StubOptions = {}): { runAgents: RunAgents; calls: AgentInvocation[] } {
  const calls: AgentInvocation[] = []
  const runAgents: RunAgents = async (invocation) => {
    calls.push(invocation)
    if (invocation.prompt.includes(SCORE_FILENAME)) {
      if (options.omitScore === true) return
      const body = options.scoreBody ?? JSON.stringify({ score: options.scoreFor?.(invocation.label, calls.length) ?? 90 })
      writeFileSync(join(invocation.cwd, SCORE_FILENAME), body, 'utf8')
      return
    }
    if (options.omitDeliverable === true) return
    writeFileSync(join(invocation.cwd, DELIVERABLE_FILENAME), options.deliverable ?? '交付物正文', 'utf8')
  }
  return { runAgents, calls }
}

/** 用桩接缝采集一次。 */
async function collect(options: { caseIds?: string[]; runsPerCase?: number } & StubOptions): Promise<{
  record: Awaited<ReturnType<typeof collectRunRecord>>
  calls: AgentInvocation[]
}> {
  const { runAgents, calls } = stubAgents(options)
  const record = await collectRunRecord({
    space,
    gold,
    agentStateDir: join(exampleDir, 'patent-state'),
    workDir: scratch('work'),
    runAgents,
    ...options.caseIds === undefined ? {} : { caseIds: options.caseIds },
    ...options.runsPerCase === undefined ? {} : { runsPerCase: options.runsPerCase },
    recordedAt: '2026-09-26T00:00:00.000Z',
  })
  return { record, calls }
}

describe('真实启动器参数', () => {
  it('源码启动形态与 campaign 运行器一致', () => {
    expect(agentArgv({
      binPath: '/repo/apps/cli/src/bin.ts',
      tsxImport: 'tsx/esm',
      profile: 'headless',
      prompt: '任务正文',
    })).toEqual([
      '--import', 'tsx/esm', '/repo/apps/cli/src/bin.ts', '--profile', 'headless', '任务正文',
    ])
  })

  it('overlay 按对追加在提示词之前', () => {
    expect(agentArgv({
      binPath: '/repo/apps/cli/src/bin.ts',
      tsxImport: 'tsx/esm',
      profile: 'headless',
      patchPaths: ['/repo/a.yml', '/repo/b.yml'],
      prompt: '任务正文',
    })).toEqual([
      '--import', 'tsx/esm', '/repo/apps/cli/src/bin.ts', '--profile', 'headless',
      '--patch', '/repo/a.yml', '--patch', '/repo/b.yml', '任务正文',
    ])
  })
})

describe('提示词契约', () => {
  it('执行者拿到 agent state 目录与公开任务,并要求把交付物写成文件', () => {
    const goldCase = first(gold)
    const prompt = executorPrompt('/run/agent-state', goldCase.statement)
    expect(prompt).toContain('依据目标 agent 状态目录中的作业规范')
    expect(prompt).toContain('作业规范目录:')
    expect(prompt).toContain('/run/agent-state')
    expect(prompt).toContain(goldCase.statement)
    expect(prompt).toContain(DELIVERABLE_FILENAME)
    expect(prompt).not.toContain(guidance.slice(0, 20))
    expect(prompt).not.toContain('评分标准')
    expect(prompt).not.toContain('rubric')
  })

  it('评估者只拿到本维度的评分标准', () => {
    const goldCase = first(gold)
    const [dimension, other] = parseRubricDimensions(goldCase.rubric)
    expect(dimension).toBeDefined()
    expect(other).toBeDefined()
    if (dimension === undefined || other === undefined) return
    const prompt = evaluatorPrompt(goldCase.statement, dimension, '交付物正文')
    expect(prompt).toContain(goldCase.statement)
    expect(prompt).toContain(dimension.label)
    expect(prompt).toContain(`满分 ${dimension.points}`)
    expect(prompt).toContain(dimension.body)
    expect(prompt).toContain('交付物正文')
    expect(prompt).toContain(SCORE_FILENAME)
    expect(prompt).not.toContain(other.label)
    expect(prompt).not.toContain(other.body)
  })
})

describe('分数解析', () => {
  it('接受 0–100 的 JSON 对象', () => {
    expect(parseScore('{"score": 88}', 'label')).toBe(88)
    expect(parseScore('  {"score": 0}\n', 'label')).toBe(0)
    expect(parseScore('{"score": 100}', 'label')).toBe(100)
  })

  it('非 JSON、非对象、缺字段、越界一律失败', () => {
    expect(() => parseScore('得分 88 分', 'label')).toThrow('不是合法 JSON')
    expect(() => parseScore('[{"score": 88}]', 'label')).toThrow('必须是 JSON 对象')
    expect(() => parseScore('{"note": "好"}', 'label')).toThrow('缺少有限数 score')
    expect(() => parseScore('{"score": "88"}', 'label')).toThrow('缺少有限数 score')
    expect(() => parseScore('{"score": 120}', 'label')).toThrow('超出 0–100')
  })
})

describe('选项解析', () => {
  it('缺省为 headless / runs=1 / 产物落 .artifacts', () => {
    const options = parseRunnerOptions([], { root: '/repo', cwd: '/repo', stamp: 'T' })
    expect(options.profile).toBe('headless')
    expect(options.runs).toBe(1)
    expect(options.caseIds).toEqual([])
    expect(options.timeoutMs).toBe(600_000)
    expect(options.outPath).toBe('/repo/.artifacts/patent-oas/T/run.json')
    expect(options.workDir).toBe('/repo/.artifacts/patent-oas/T/work')
  })

  it('可重复开关与相对路径归一化', () => {
    const options = parseRunnerOptions(
      ['--profile', 'patent', '--case', 'oa-answer', '--case', 'claim-drafting', '--patch', 'overlay.yml',
        '--out', 'run.json', '--work-dir', 'work', '--runs', '2', '--timeout-ms', '1000', '--budget-ms', '2000',
        '--provider', 'p', '--model', 'm', '--dry-run'],
      { root: '/repo', cwd: '/w', stamp: 'T' },
    )
    expect(options.profile).toBe('patent')
    expect(options.caseIds).toEqual(['oa-answer', 'claim-drafting'])
    expect(options.patchPaths).toEqual(['/w/overlay.yml'])
    expect(options.outPath).toBe('/w/run.json')
    expect(options.workDir).toBe('/w/work')
    expect(options.runs).toBe(2)
    expect(options.timeoutMs).toBe(1000)
    expect(options.budgetMs).toBe(2000)
    expect(options.dryRun).toBe(true)
    expect(options.provider).toBe('p')
    expect(options.modelId).toBe('m')
  })

  it('重复给出的同一个 case 或 overlay 只算一次', () => {
    const options = parseRunnerOptions(
      ['--case', 'oa-answer', '--case', 'oa-answer', '--patch', 'a.yml', '--patch', 'a.yml'],
      { root: '/repo', cwd: '/w', stamp: 'T' },
    )
    expect(options.caseIds).toEqual(['oa-answer'])
    expect(options.patchPaths).toEqual(['/w/a.yml'])
  })

  it('缺省总预算是 1 小时,且非 dry-run', () => {
    const options = parseRunnerOptions([], { root: '/repo', cwd: '/repo', stamp: 'T' })
    expect(options.budgetMs).toBe(3_600_000)
    expect(options.dryRun).toBe(false)
  })

  it('非法取值失败,而不是退回缺省', () => {
    expect(() => parseRunnerOptions(['--runs', '0'], { root: '/repo', cwd: '/repo', stamp: 'T' })).toThrow('--runs 必须是正整数')
    expect(() => parseRunnerOptions(['--timeout-ms', 'abc'], { root: '/repo', cwd: '/repo', stamp: 'T' })).toThrow('--timeout-ms 必须是正数')
    expect(() => parseRunnerOptions(['--budget-ms', '0'], { root: '/repo', cwd: '/repo', stamp: 'T' })).toThrow('--budget-ms 必须是正数')
    expect(() => parseRunnerOptions(['--profile'], { root: '/repo', cwd: '/repo', stamp: 'T' })).toThrow('需要一个值')
  })
})

describe('凭据信号', () => {
  it('环境变量或 .env 声明都算信号,都没有则不算', async () => {
    const dir = scratch('creds')
    const envFile = join(dir, '.env')
    expect(await hasCredentialSignal({ DEEPSEEK_API_KEY: 'k' }, [])).toBe(true)
    expect(await hasCredentialSignal({ DEEPSEEK_API_KEY: '   ' }, [])).toBe(false)
    expect(await hasCredentialSignal({}, [join(dir, 'missing.env')])).toBe(false)
    writeFileSync(envFile, 'DEEPSEEK_BASE_URL=http://x\n', 'utf8')
    expect(await hasCredentialSignal({}, [envFile])).toBe(false)
    writeFileSync(envFile, 'DEEPSEEK_API_KEY=sk-x\n', 'utf8')
    expect(await hasCredentialSignal({}, [envFile])).toBe(true)
  })

  it('候选路径是仓库根与 $DSH_HOME 的 .env', () => {
    expect(credentialEnvFiles('/repo', { DSH_HOME: '/home/.dsh' })).toEqual(['/repo/.env', '/home/.dsh/.env'])
    expect(credentialEnvFiles('/repo', { HOME: '/users/x' })).toEqual(['/repo/.env', '/users/x/.dsh/.env'])
  })
})

describe('编排', () => {
  it('每个 case 一次执行者、每维度一次评估者,记录与金标维度一一对应', async () => {
    const { record, calls } = await collect({})
    expect(calls.length).toBe(4 + 20)
    expect(record.cases.length).toBe(4)
    expect(record.benchmarkId).toBe('patent-oas')
    expect(record.runsPerCase).toBe(1)
    expect(validateRunRecord(record, space, gold, 'collected')).toEqual([])
    for (const runCase of record.cases) {
      const goldCase = gold.find(entry => entry.caseId === runCase.caseId)
      expect(goldCase).toBeDefined()
      if (goldCase === undefined) continue
      const dimensions = parseRubricDimensions(goldCase.rubric)
      expect(runCase.dimensions.map(entry => entry.label)).toEqual(dimensions.map(entry => entry.label))
      expect(runCase.dimensions.map(entry => entry.points)).toEqual(dimensions.map(entry => entry.points))
      expect(runCase.dimensions.every(entry => entry.score === 90)).toBe(true)
    }
    expect(caseScores(record).every(entry => entry.score === 90)).toBe(true)
  })

  it('计划给出逐 case 维度数与调用总数,重复 case 被拒', () => {
    const plan = planRun({ space, gold })
    expect(plan.cases.length).toBe(4)
    expect(plan.calls).toBe(24)
    expect(plan.cases.every(entry => entry.dimensions === 5)).toBe(true)
    expect(() => planRun({ space, gold, caseIds: ['oa-answer', 'oa-answer'] })).toThrow('被选中多次')
  })

  it('每次运行的执行者拿到私有的 agent state 副本', async () => {
    const { calls } = await collect({ caseIds: ['oa-answer'], runsPerCase: 2 })
    const executors = calls.filter(call => call.prompt.includes(DELIVERABLE_FILENAME))
    expect(executors.length).toBe(2)
    expect(first(executors).cwd).not.toBe(executors[1]?.cwd)
    for (const call of executors) {
      expect(existsSync(join(call.cwd, 'guidance.md'))).toBe(true)
      expect(call.prompt).toContain(call.cwd)
    }
  })

  it('--case 只跑选中的 case', async () => {
    const { record, calls } = await collect({ caseIds: ['oa-answer'] })
    expect(record.cases.map(entry => entry.caseId)).toEqual(['oa-answer'])
    expect(calls.length).toBe(6)
  })

  it('runsPerCase 取多次运行的均值', async () => {
    const { record } = await collect({
      caseIds: ['oa-answer'],
      runsPerCase: 2,
      scoreFor: label => label.includes('run 1') ? 80 : 60,
    })
    expect(record.runsPerCase).toBe(2)
    expect(first(record.cases).dimensions.every(entry => entry.score === 70)).toBe(true)
  })

  it('agent 没写出交付物时点名失败', async () => {
    await expect(collect({ caseIds: ['oa-answer'], omitDeliverable: true })).rejects.toThrow('未产出')
  })

  it('交付物为空时失败', async () => {
    await expect(collect({ caseIds: ['oa-answer'], deliverable: '   \n' })).rejects.toThrow('为空')
  })

  it('交付物超过字节上限时失败,而不是复制进每条评估提示词', async () => {
    await expect(collect({ caseIds: ['oa-answer'], deliverable: 'x'.repeat(MAX_DELIVERABLE_BYTES + 1) })).rejects.toThrow('超过上限')
  })

  it('agent 没写出分数时点名失败', async () => {
    await expect(collect({ caseIds: ['oa-answer'], omitScore: true })).rejects.toThrow('未产出')
  })

  it('分数文件非法时失败,而不是当成 0 分', async () => {
    await expect(collect({ caseIds: ['oa-answer'], scoreBody: '我觉得很好' })).rejects.toThrow('不是合法 JSON')
  })

  it('未知 case 在花掉模型调用之前失败', async () => {
    await expect(collect({ caseIds: ['no-such-case'] })).rejects.toThrow('不在金标中')
  })
})

describe('真实子进程接缝', () => {
  it('超时即终止子进程并报出超时,日志仍然落盘', async () => {
    const dir = scratch('timeout')
    const hang = join(dir, 'hang.mjs')
    writeFileSync(hang, 'setInterval(() => process.stdout.write("x".repeat(1024)), 1)\n', 'utf8')
    await expect(spawnAgentProcess({
      invocation: { cwd: dir, prompt: 'ignored', label: 'hang 调用' },
      launcher: { binPath: hang, tsxImport: import.meta.resolve('tsx/esm'), profile: 'headless' },
      timeoutMs: 300,
    })).rejects.toThrow('超过 300ms 未结束')
    expect(readFileSync(join(dir, AGENT_LOG_FILENAME), 'utf8').length).toBeGreaterThan(0)
  })

  it('子进程非零退出时报出退出码与日志位置', async () => {
    const dir = scratch('exit')
    const fail = join(dir, 'fail.mjs')
    writeFileSync(fail, 'process.stderr.write("boom\\n"); process.exit(3)\n', 'utf8')
    await expect(spawnAgentProcess({
      invocation: { cwd: dir, prompt: 'ignored', label: 'fail 调用' },
      launcher: { binPath: fail, tsxImport: import.meta.resolve('tsx/esm'), profile: 'headless' },
      timeoutMs: 30_000,
    })).rejects.toThrow('退出码 3')
    expect(readFileSync(join(dir, AGENT_LOG_FILENAME), 'utf8')).toContain('boom')
  })
})

describe('与门禁联动', () => {
  it('高分记录通过门槛', async () => {
    const { record } = await collect({ scoreFor: () => 90 })
    expect(verdictPassed(evaluateRun(space, config, record, undefined))).toBe(true)
  })

  it('低分记录被门禁拒绝,并归因到问题空间节点', async () => {
    const { record } = await collect({ scoreFor: () => 40 })
    const verdict = evaluateRun(space, config, record, undefined)
    expect(verdictPassed(verdict)).toBe(false)
    expect(verdict.nodes.some(node => node.verdict === 'below-floor')).toBe(true)
    expect(verdict.cases.every(entry => entry.verdict === 'below-floor')).toBe(true)
  })

  it('相对基线的回退被判为 regressed', async () => {
    const baseline = (await collect({ scoreFor: () => 90 })).record
    const { record } = await collect({ caseIds: ['oa-answer'], scoreFor: () => 80 })
    const verdict = evaluateRun(space, config, record, baseline)
    expect(verdict.cases.some(entry => entry.verdict === 'regressed')).toBe(true)
  })
})

describe('写出记录', () => {
  it('记录落盘为可被门禁重新读取的 JSON', async () => {
    const { record } = await collect({ caseIds: ['oa-answer'] })
    const dir = scratch('out')
    const path = join(dir, 'nested', 'run.json')
    await writeRunRecord(path, record)
    expect(await loadRunRecord(path)).toEqual(record)
    expect(readFileSync(path, 'utf8').endsWith('\n')).toBe(true)
  })
})
