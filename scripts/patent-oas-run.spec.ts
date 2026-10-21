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
  caseRoundScores,
  evaluateRun,
  formatVerdict,
  loadGateConfig,
  loadGold,
  loadProblemSpace,
  loadRunRecord,
  parseRubricDimensions,
  textDigest,
  validateRunRecord,
  verdictPassed,
  type GoldCase,
} from './patent-oas-gate-core.ts'
import {
  AGENT_LOG_FILENAME,
  DELIVERABLE_FILENAME,
  MAX_DELIVERABLE_BYTES,
  PREVIOUS_DELIVERABLE_FILENAME,
  SCORE_FILENAME,
  agentArgv,
  collectRunRecord,
  credentialEnvFiles,
  evaluatorPrompt,
  executorPrompt,
  hasCredentialSignal,
  parseRunEventUsage,
  parseRunnerOptions,
  parseScore,
  planRun,
  spawnAgentProcess,
  writeRunRecord,
  type AgentInvocation,
  type RunAgents,
  type RunCallUsage,
  type RunPricing,
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
  /** 按调用决定交付物正文;给出时优先于 {@link deliverable}。 */
  deliverableFor?: (label: string, call: number) => string
  /** 不写出交付物,用来验证「agent 没产出产物」的失败路径。 */
  omitDeliverable?: boolean
  /** 不写出分数文件。 */
  omitScore?: boolean
  /** 污染分数文件内容,用来验证解析失败路径。 */
  scoreBody?: string
  /** 接缝每次调用报告的用量;缺省不报告(记录里不出现 cost/tokens)。 */
  usage?: RunCallUsage
  /** 按调用逐次决定报告什么;给出时优先于 {@link usage}。 */
  usageFor?: (label: string, call: number) => RunCallUsage | undefined
}

/** 造一个桩接缝:按契约把产物写进调用目录,并记录每次调用。 */
function stubAgents(options: StubOptions = {}): { runAgents: RunAgents; calls: AgentInvocation[] } {
  const calls: AgentInvocation[] = []
  const runAgents: RunAgents = async (invocation) => {
    calls.push(invocation)
    const usage = options.usageFor === undefined ? options.usage : options.usageFor(invocation.label, calls.length)
    if (invocation.prompt.includes(SCORE_FILENAME)) {
      if (options.omitScore === true) return usage
      const body = options.scoreBody ?? JSON.stringify({ score: options.scoreFor?.(invocation.label, calls.length) ?? 90 })
      writeFileSync(join(invocation.cwd, SCORE_FILENAME), body, 'utf8')
      return usage
    }
    if (options.omitDeliverable === true) return usage
    const deliverable = options.deliverableFor?.(invocation.label, calls.length)
      ?? options.deliverable
      ?? '交付物正文'
    writeFileSync(join(invocation.cwd, DELIVERABLE_FILENAME), deliverable, 'utf8')
    return usage
  }
  return { runAgents, calls }
}

/** 用桩接缝采集一次。 */
async function collect(options: {
  caseIds?: string[]
  runsPerCase?: number
  pricing?: RunPricing
  /** 用这份金标替换仓库金标;缺省读真实 example。 */
  gold?: readonly GoldCase[]
} & StubOptions): Promise<{
  record: Awaited<ReturnType<typeof collectRunRecord>>
  calls: AgentInvocation[]
  workDir: string
}> {
  const { runAgents, calls } = stubAgents(options)
  const workDir = scratch('work')
  const record = await collectRunRecord({
    space,
    gold: options.gold ?? gold,
    agentStateDir: join(exampleDir, 'patent-state'),
    workDir,
    runAgents,
    ...options.caseIds === undefined ? {} : { caseIds: options.caseIds },
    ...options.runsPerCase === undefined ? {} : { runsPerCase: options.runsPerCase },
    ...options.pricing === undefined ? {} : { pricing: options.pricing },
    recordedAt: '2026-09-26T00:00:00.000Z',
  })
  return { record, calls, workDir }
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

  it('--json 紧贴提示词之前,只有开启时才出现', () => {
    expect(agentArgv({
      binPath: '/repo/apps/cli/src/bin.ts',
      tsxImport: 'tsx/esm',
      profile: 'headless',
      json: true,
      prompt: '任务正文',
    })).toEqual([
      '--import', 'tsx/esm', '/repo/apps/cli/src/bin.ts', '--profile', 'headless', '--json', '任务正文',
    ])
    expect(agentArgv({
      binPath: '/repo/apps/cli/src/bin.ts',
      tsxImport: 'tsx/esm',
      profile: 'headless',
      json: false,
      prompt: '任务正文',
    })).not.toContain('--json')
  })
})

describe('运行事件用量解析', () => {
  it('只从带 usage 的 step_end 事件取 token', () => {
    const line = JSON.stringify({ type: 'status', phase: 'step_end', usage: { inputTokens: 120, outputTokens: 30 } })
    expect(parseRunEventUsage(line)).toEqual({ input: 120, output: 30 })
  })

  it('缓存读取与写入折进计费输入', () => {
    const line = JSON.stringify({
      type: 'status',
      phase: 'step_end',
      usage: { inputTokens: 100, outputTokens: 30, cacheReadTokens: 20, cacheWriteTokens: 5 },
    })
    expect(parseRunEventUsage(line)).toEqual({ input: 125, output: 30 })
  })

  it('非 JSON、其它事件、缺字段与负值一律忽略', () => {
    expect(parseRunEventUsage('agent log line')).toBeUndefined()
    expect(parseRunEventUsage(JSON.stringify({ type: 'status', phase: 'step_start' }))).toBeUndefined()
    expect(parseRunEventUsage(JSON.stringify({ type: 'final', text: 'done' }))).toBeUndefined()
    expect(parseRunEventUsage(JSON.stringify({ type: 'status', phase: 'step_end' }))).toBeUndefined()
    expect(parseRunEventUsage(JSON.stringify({
      type: 'status', phase: 'step_end', usage: { inputTokens: '120', outputTokens: 30 },
    }))).toBeUndefined()
    expect(parseRunEventUsage(JSON.stringify({
      type: 'status', phase: 'step_end', usage: { inputTokens: -1, outputTokens: 30 },
    }))).toBeUndefined()
    expect(parseRunEventUsage(JSON.stringify({
      type: 'status', phase: 'step_end', usage: { inputTokens: 100, outputTokens: 30, cacheReadTokens: -1 },
    }))).toBeUndefined()
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
  it('缺省为 headless / runs=3 / 产物落 .artifacts', () => {
    const options = parseRunnerOptions([], { root: '/repo', cwd: '/repo', stamp: 'T' })
    expect(options.profile).toBe('headless')
    expect(options.runs).toBe(3)
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

  it('单价必须成对给出且非负', () => {
    const context = { root: '/repo', cwd: '/repo', stamp: 'T' }
    expect(parseRunnerOptions(
      ['--input-usd-per-mtok', '2', '--output-usd-per-mtok', '8'],
      context,
    ).pricing).toEqual({ inputPerMillion: 2, outputPerMillion: 8 })
    expect(() => parseRunnerOptions(['--input-usd-per-mtok', '2'], context)).toThrow('必须同时给出')
    expect(() => parseRunnerOptions(['--output-usd-per-mtok', '8'], context)).toThrow('必须同时给出')
    expect(() => parseRunnerOptions(
      ['--input-usd-per-mtok', '-1', '--output-usd-per-mtok', '8'],
      context,
    )).toThrow('--input-usd-per-mtok 必须是非负数')
    expect(() => parseRunnerOptions(
      ['--input-usd-per-mtok', '2', '--output-usd-per-mtok', 'abc'],
      context,
    )).toThrow('--output-usd-per-mtok 必须是非负数')
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
    expect(calls.length).toBe(4 + 21)
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
    expect(plan.calls).toBe(25)
    expect(plan.cases.find(entry => entry.caseId === 'oa-answer')?.dimensions).toBe(6)
    expect(plan.cases.filter(entry => entry.caseId !== 'oa-answer').every(entry => entry.dimensions === 5)).toBe(true)
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
    expect(calls.length).toBe(7)
  })

  it('runsPerCase 取多次运行的均值,并留下逐次观测', async () => {
    const { record } = await collect({
      caseIds: ['oa-answer'],
      runsPerCase: 2,
      scoreFor: label => label.includes('run 1') ? 80 : 60,
    })
    expect(record.runsPerCase).toBe(2)
    expect(first(record.cases).dimensions.every(entry => entry.score === 70)).toBe(true)
    expect(first(record.cases).dimensions.every(entry => entry.scores?.join(',') === '80,60')).toBe(true)
  })

  it('单次运行不写逐次观测', async () => {
    const { record } = await collect({ caseIds: ['oa-answer'] })
    expect(first(record.cases).dimensions.every(entry => entry.scores === undefined)).toBe(true)
  })

  it('汇总接缝报告的 cost/tokens 到记录', async () => {
    const { record, calls } = await collect({
      caseIds: ['oa-answer'],
      runsPerCase: 2,
      usage: { cost: 0.01, tokens: { input: 100, output: 40 } },
    })
    expect(record.cost).toBeCloseTo(0.01 * calls.length, 6)
    expect(record.tokens).toEqual({ input: 100 * calls.length, output: 40 * calls.length })
  })

  it('接缝未报告用量时记录不含 cost/tokens', async () => {
    const { record } = await collect({ caseIds: ['oa-answer'] })
    expect(record.cost).toBeUndefined()
    expect(record.tokens).toBeUndefined()
  })

  it('provider 不报告成本时按给定单价把 tokens 换算成 cost', async () => {
    const { record, calls } = await collect({
      caseIds: ['oa-answer'],
      runsPerCase: 2,
      usage: { tokens: { input: 100, output: 40 } },
      pricing: { inputPerMillion: 2, outputPerMillion: 8 },
    })
    expect(record.tokens).toEqual({ input: 100 * calls.length, output: 40 * calls.length })
    expect(record.cost).toBeCloseTo(calls.length * (100 / 1_000_000 * 2 + 40 / 1_000_000 * 8), 6)
  })

  it('provider 报告成本时优先使用报告值,不由单价重算', async () => {
    const { record, calls } = await collect({
      caseIds: ['oa-answer'],
      usage: { cost: 0.5, tokens: { input: 1, output: 1 } },
      pricing: { inputPerMillion: 1000, outputPerMillion: 1000 },
    })
    expect(record.cost).toBeCloseTo(0.5 * calls.length, 6)
  })

  it('没有任何 usage 时,即使给了单价也不写 cost', async () => {
    const { record } = await collect({
      caseIds: ['oa-answer'],
      pricing: { inputPerMillion: 2, outputPerMillion: 8 },
    })
    expect(record.cost).toBeUndefined()
  })

  it('只有部分调用报告 tokens 时省略合计,不写部分值', async () => {
    const { record } = await collect({
      caseIds: ['oa-answer'],
      usageFor: (_label, call) => call === 1 ? undefined : { tokens: { input: 1, output: 1 } },
      pricing: { inputPerMillion: 2, outputPerMillion: 8 },
    })
    expect(record.tokens).toBeUndefined()
    expect(record.cost).toBeUndefined()
  })

  it('部分调用报告成本时不用部分成本,改由完整 tokens 与单价换算', async () => {
    const { record, calls } = await collect({
      caseIds: ['oa-answer'],
      usageFor: (_label, call) => call === 1
        ? { cost: 100, tokens: { input: 10, output: 5 } }
        : { tokens: { input: 10, output: 5 } },
      pricing: { inputPerMillion: 1, outputPerMillion: 2 },
    })
    expect(record.cost).toBeCloseTo(calls.length * (10 / 1_000_000 * 1 + 5 / 1_000_000 * 2), 6)
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

/** 给 oa-answer 装上第 2 轮脚本化审查意见,其余 case 保持单轮。 */
function multiroundGold(): GoldCase[] {
  return gold.map<GoldCase>(entry => entry.caseId === 'oa-answer'
    ? {
      ...entry,
      rounds: [{ round: 2, statement: '审查员认为修改后的权利要求 1 仍未克服创造性缺陷,请进一步陈述。' }],
    }
    : entry)
}

describe('多轮编排', () => {
  it('计划把轮次计入调用总数', () => {
    const plan = planRun({ space, gold: multiroundGold() })
    expect(plan.cases.find(entry => entry.caseId === 'oa-answer')?.rounds).toBe(2)
    expect(plan.calls).toBe(32)
  })

  it('两轮各自执行与评分,终局取第 2 轮并记录权项版本', async () => {
    const { record, calls, workDir } = await collect({
      gold: multiroundGold(),
      scoreFor: label => label.includes('oa-answer') && label.includes('第 1 轮') ? 60 : 90,
      deliverableFor: label => label.includes('oa-answer') && label.includes('第 1 轮') ? '第 1 轮答复' : '第 2 轮答复',
    })
    expect(calls.length).toBe(32)
    const runCase = record.cases.find(entry => entry.caseId === 'oa-answer')
    expect(runCase).toBeDefined()
    if (runCase === undefined) return
    expect(runCase.rounds?.map(round => round.round)).toEqual([1, 2])
    expect(runCase.rounds?.[0]?.dimensions.every(dimension => dimension.score === 60)).toBe(true)
    expect(runCase.rounds?.[1]?.dimensions.every(dimension => dimension.score === 90)).toBe(true)
    expect(runCase.dimensions.every(dimension => dimension.score === 90)).toBe(true)
    expect(runCase.rounds?.[0]?.statementDigest).toBeUndefined()
    expect(runCase.rounds?.[1]?.statementDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(runCase.rounds?.[0]?.deliverableDigests).toEqual([textDigest('第 1 轮答复')])
    expect(runCase.rounds?.[1]?.deliverableDigests).toEqual([textDigest('第 2 轮答复')])
    expect(validateRunRecord(record, space, multiroundGold(), 'collected')).toEqual([])

    const executors = calls.filter(call => call.label.includes('oa-answer') && call.label.includes('执行者'))
    expect(executors.length).toBe(2)
    expect(first(executors).prompt).not.toContain(PREVIOUS_DELIVERABLE_FILENAME)
    expect(executors[1]?.prompt).toContain(PREVIOUS_DELIVERABLE_FILENAME)
    expect(executors[1]?.prompt).toContain('【再审查意见】')
    expect(readFileSync(
      join(workDir, 'oa-answer', 'run-1', 'round-2', 'agent-state', PREVIOUS_DELIVERABLE_FILENAME),
      'utf8',
    )).toBe('第 1 轮答复')
  })

  it('多轮记录保留逐轮逐次分数', async () => {
    const { record } = await collect({
      gold: multiroundGold(),
      runsPerCase: 2,
      scoreFor: (label, call) => {
        if (!label.includes('oa-answer')) return 90
        return label.includes('第 1 轮') ? 50 + call % 2 * 10 : 80 + call % 2 * 10
      },
    })
    const runCase = record.cases.find(entry => entry.caseId === 'oa-answer')
    expect(runCase?.rounds?.every(round => round.dimensions.every(d => d.scores?.length === 2))).toBe(true)
    expect(runCase?.dimensions.every(d => d.scores?.length === 2)).toBe(true)
    expect(validateRunRecord(record, space, multiroundGold(), 'collected')).toEqual([])
  })

  it('门禁报告逐轮总分,只用终局分判定', async () => {
    const { record } = await collect({
      gold: multiroundGold(),
      scoreFor: label => label.includes('oa-answer') && label.includes('第 1 轮') ? 60 : 90,
    })
    expect(caseRoundScores(record).get('oa-answer')?.map(entry => entry.score)).toEqual([60, 90])
    const verdict = evaluateRun(space, config, record, undefined)
    const outcome = verdict.cases.find(entry => entry.id === 'oa-answer')
    expect(outcome?.score).toBe(90)
    expect(outcome?.rounds?.map(entry => entry.score)).toEqual([60, 90])
    expect(formatVerdict(verdict)).toContain('逐轮 R1 60.0 → R2 90.0')
  })
})

describe('真实子进程接缝', () => {
  it('从 --json 事件流汇总 token,并保留完整日志', async () => {
    const dir = scratch('usage')
    const emit = join(dir, 'emit.mjs')
    writeFileSync(emit, [
      'process.stdout.write(JSON.stringify({ type: "status", phase: "step_end", usage: { inputTokens: 10, outputTokens: 2 } }) + "\\n")',
      'process.stdout.write(JSON.stringify({ type: "status", phase: "step_end", usage: { inputTokens: 5, outputTokens: 1, cacheReadTokens: 3 } }))',
    ].join('\n'), 'utf8')
    const usage = await spawnAgentProcess({
      invocation: { cwd: dir, prompt: 'ignored', label: 'usage 调用' },
      launcher: { binPath: emit, tsxImport: import.meta.resolve('tsx/esm'), profile: 'headless', json: true },
      timeoutMs: 30_000,
    })
    expect(usage).toEqual({ tokens: { input: 18, output: 3 } })
    expect(readFileSync(join(dir, AGENT_LOG_FILENAME), 'utf8')).toContain('"step_end"')
  })

  it('子进程没有报告 usage 时返回 undefined', async () => {
    const dir = scratch('no-usage')
    const silent = join(dir, 'silent.mjs')
    writeFileSync(silent, 'process.stdout.write("plain log\\n")\n', 'utf8')
    expect(await spawnAgentProcess({
      invocation: { cwd: dir, prompt: 'ignored', label: 'silent 调用' },
      launcher: { binPath: silent, tsxImport: import.meta.resolve('tsx/esm'), profile: 'headless' },
      timeoutMs: 30_000,
    })).toBeUndefined()
  })

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

  it('逐次观测随记录落盘并可被重新读取', async () => {
    const { record } = await collect({ runsPerCase: 2 })
    const path = join(scratch('out-scores'), 'run.json')
    await writeRunRecord(path, record)
    expect(await loadRunRecord(path)).toEqual(record)
    expect(validateRunRecord(await loadRunRecord(path), space, gold, 'run.json')).toEqual([])
  })

  it('逐次观测不是数组时点名失败', async () => {
    const { record } = await collect({ caseIds: ['oa-answer'], runsPerCase: 2 })
    const raw = JSON.parse(JSON.stringify(record)) as { cases: Array<{ dimensions: Array<Record<string, unknown>> }> }
    first(first(raw.cases).dimensions).scores = '80,60'
    const path = join(scratch('out-bad-scores'), 'run.json')
    writeFileSync(path, JSON.stringify(raw), 'utf8')
    await expect(loadRunRecord(path)).rejects.toThrow('必须是数组')
  })
})
