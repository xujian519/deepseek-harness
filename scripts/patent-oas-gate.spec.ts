/**
 * `patent-oas` 问题空间 DAG 与带门槛回归门禁的验收测试。
 *
 * 每条负例对应门禁的一条拒绝路径:金标/DAG 漂移、权重不符、图成环、门槛不可满足、
 * run 记录与金标不符、以及分数回退。正向用例固定聚合口径,免得口径被无声改掉。
 */

import { spawnSync } from 'node:child_process'
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
  findCycles,
  formatVerdict,
  goldDigest,
  isOutsideRoot,
  loadGateConfig,
  loadGold,
  loadProblemSpace,
  nodeScores,
  parseRubricDimensions,
  validateGateConfig,
  validateProblemSpace,
  validateRunRecord,
  verdictPassed,
  type CaseMapping,
  type DimensionMapping,
  type GateConfig,
  type GoldCase,
  type ProblemSpace,
  type ProblemSpaceNode,
  type RunRecord,
} from './patent-oas-gate-core.ts'

const root = resolve(import.meta.dirname, '..')
const exampleDir = resolve(root, PATENT_OAS_EXAMPLE_DIR)
const gatePath = resolve(root, GATE_FILE)
const problemSpacePath = resolve(root, PROBLEM_SPACE_FILE)

const gold = await loadGold(exampleDir)
const space = await loadProblemSpace(problemSpacePath)
const config = await loadGateConfig(gatePath)

const scratchDirs: string[] = []
afterAll(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true })
})

/** 取 case 映射;取不到即测试装置出错,而不是断言失败。 */
function mappingOf(target: ProblemSpace, caseId: string): CaseMapping {
  const mapping = target.cases[caseId]
  if (mapping === undefined) throw new Error(`fixture: 缺少 ${caseId} 的映射`)
  return mapping
}

/** 取维度映射。 */
function dimensionOf(mapping: CaseMapping, index: number): DimensionMapping {
  const dimension = mapping.dimensions[index]
  if (dimension === undefined) throw new Error(`fixture: 缺少维度 ${index} 的映射`)
  return dimension
}

/** 取节点。 */
function nodeOf(target: ProblemSpace, nodeId: string): ProblemSpaceNode {
  const node = target.nodes[nodeId]
  if (node === undefined) throw new Error(`fixture: 缺少节点 ${nodeId}`)
  return node
}

/** 取列表首项;空列表即测试装置出错。 */
function first<T>(values: readonly T[]): T {
  const value = values[0]
  if (value === undefined) throw new Error('fixture: 期望非空列表')
  return value
}

/** 按给定分数构造一次 run 记录;维度名与满分一律取自金标 rubric。 */
function recordFrom(
  cases: readonly GoldCase[],
  score: (caseId: string, index: number) => number,
): RunRecord {
  return {
    benchmarkId: 'patent-oas',
    recordedAt: '2026-09-26T00:00:00.000Z',
    runsPerCase: 1,
    cases: cases.map(goldCase => ({
      caseId: goldCase.caseId,
      dimensions: parseRubricDimensions(goldCase.rubric).map(dimension => ({
        index: dimension.index,
        label: dimension.label,
        points: dimension.points,
        score: score(goldCase.caseId, dimension.index),
      })),
    })),
  }
}

/** 深拷贝问题空间,供负例改坏后再校验。 */
function cloneSpace(): ProblemSpace {
  return structuredClone(space)
}

/** 在临时目录里落一份 run 记录,返回路径。 */
function writeRecord(record: RunRecord): string {
  const dir = mkdtempSync(join(tmpdir(), 'patent-oas-gate-'))
  scratchDirs.push(dir)
  const path = join(dir, 'run.json')
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  return path
}

/** 以源码启动方式运行门禁脚本。 */
function runGate(...args: string[]): ReturnType<typeof spawnSync> {
  const script = resolve(import.meta.dirname, 'verify-patent-oas-gold.ts')
  return spawnSync(process.execPath, ['--import', import.meta.resolve('tsx/esm'), script, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120_000,
  })
}

describe('金标与问题空间 DAG', () => {
  it('金标与 DAG 互相钉住,每个 rubric 维度都有等权映射', () => {
    expect(validateProblemSpace(space, gold)).toEqual([])
    for (const goldCase of gold) {
      const dimensions = parseRubricDimensions(goldCase.rubric)
      const mapping = mappingOf(space, goldCase.caseId)
      for (const dimension of dimensions) {
        const weight = Object.values(dimensionOf(mapping, dimension.index).nodes).reduce((sum, value) => sum + value, 0)
        expect(weight, `${goldCase.caseId}#${dimension.index}`).toBe(dimension.points)
      }
    }
  })

  it('缺少维度映射即失败', () => {
    const broken = cloneSpace()
    delete mappingOf(broken, 'oa-answer').dimensions[3]
    expect(validateProblemSpace(broken, gold).join('\n')).toContain('维度 3')
  })

  it('映射权重与 rubric 满分不符即失败', () => {
    const broken = cloneSpace()
    mappingOf(broken, 'oa-answer').dimensions[1] = { nodes: { 'distinguishing-features': 20 } }
    expect(validateProblemSpace(broken, gold).join('\n')).toContain('映射权重合计 20')
  })

  it('负权重与零权重即失败', () => {
    const negative = cloneSpace()
    mappingOf(negative, 'oa-answer').dimensions[1] = { nodes: { 'distinguishing-features': 35, 'technical-teaching': -5 } }
    expect(validateProblemSpace(negative, gold).join('\n')).toContain('权重 -5 必须为正')
    const zero = cloneSpace()
    mappingOf(zero, 'oa-answer').dimensions[1] = { nodes: { 'distinguishing-features': 30, 'technical-teaching': 0 } }
    expect(validateProblemSpace(zero, gold).join('\n')).toContain('权重 0 必须为正')
  })

  it('映射到未声明的节点即失败', () => {
    const broken = cloneSpace()
    mappingOf(broken, 'oa-answer').dimensions[1] = { nodes: { 'no-such-node': 30 } }
    expect(validateProblemSpace(broken, gold).join('\n')).toContain('未声明的节点 "no-such-node"')
  })

  it('节点没有观测面即失败', () => {
    const broken = cloneSpace()
    broken.nodes['unobservable'] = {
      id: 'unobservable', domain: 'search', label: '无观测面', observable: '无法观测', dependsOn: [],
    }
    expect(validateProblemSpace(broken, gold).join('\n')).toContain('"unobservable" 没有任何 rubric 维度映射')
  })

  it('先决关系成环即失败', () => {
    const broken = cloneSpace()
    nodeOf(broken, 'prior-art-search').dependsOn = ['conclusion-and-statute']
    expect(validateProblemSpace(broken, gold).join('\n')).toContain('先决关系成环')
    expect(findCycles(broken).length).toBeGreaterThan(0)
  })

  it('rubric 满分合计不为 100 即失败', () => {
    const shrunken = gold.map(goldCase => goldCase.caseId === 'oa-answer'
      ? { ...goldCase, rubric: goldCase.rubric.replace('(30 分)', '(20 分)') }
      : goldCase)
    expect(validateProblemSpace(space, shrunken).join('\n')).toContain('映射权重合计 30,rubric 满分为 20')
  })
})

describe('金标摘要', () => {
  it('任一 statement 或 rubric 改动都会改变摘要', () => {
    const digest = goldDigest(gold)
    const changedStatement = gold.map(entry => entry.caseId === 'oa-answer' ? { ...entry, statement: `${entry.statement} ` } : entry)
    const changedRubric = gold.map(entry => entry.caseId === 'oa-answer' ? { ...entry, rubric: `${entry.rubric} ` } : entry)
    expect(goldDigest(changedStatement)).not.toBe(digest)
    expect(goldDigest(changedRubric)).not.toBe(digest)
    expect(goldDigest([...gold].reverse())).toBe(digest)
  })
})

describe('门槛策略', () => {
  it('当前策略可满足,且已记录的金标摘要与金标相符', () => {
    expect(validateGateConfig(config, space, gold, undefined, 'baseline')).toEqual([])
    expect(config.goldDigest).toBe(goldDigest(gold))
  })

  it('金标摘要过期即失败', () => {
    const stale: GateConfig = { ...config, goldDigest: 'sha256:stale' }
    expect(validateGateConfig(stale, space, gold, undefined, 'baseline').join('\n')).toContain('goldDigest 与当前金标不符')
  })

  it('未记录金标摘要即失败', () => {
    const missing: GateConfig = { ...config, goldDigest: null }
    expect(validateGateConfig(missing, space, gold, undefined, 'baseline').join('\n')).toContain('未记录 goldDigest')
  })

  it('门槛取值越界或为负即失败', () => {
    const outOfRange: GateConfig = {
      ...config,
      thresholds: { ...config.thresholds, node: { minScore: 120, maxDrop: -1 } },
    }
    const problems = validateGateConfig(outOfRange, space, gold, undefined, 'baseline').join('\n')
    expect(problems).toContain('thresholds.node.minScore 120 超出 0–100')
    expect(problems).toContain('thresholds.node.maxDrop -1 不能为负')
  })

  it('逐节点覆盖指向不存在的节点即失败', () => {
    const typo: GateConfig = {
      ...config,
      thresholds: { ...config.thresholds, nodes: { 'distinguishing-feature': { minScore: 75 } } },
    }
    expect(validateGateConfig(typo, space, gold, undefined, 'baseline').join('\n')).toContain('不存在的节点 "distinguishing-feature"')
  })

  it('基线自身低于门槛即失败', () => {
    const weak = recordFrom(gold, () => 40)
    const problems = validateGateConfig(config, space, gold, weak, 'weak-baseline').join('\n')
    expect(problems).toContain('门槛不可能被满足')
  })
})

describe('run 记录校验', () => {
  it('维度名与 rubric 不符即失败', () => {
    const tampered = recordFrom(gold, () => 90)
    const target = tampered.cases.find(entry => entry.caseId === 'oa-answer')
    expect(target).toBeDefined()
    if (target !== undefined) first(target.dimensions).label = '自己编的维度'
    expect(validateRunRecord(tampered, space, gold, 'run.json').join('\n')).toContain('rubric 为「区别特征认定」')
  })

  it('满分与 rubric 不符即失败', () => {
    const tampered = recordFrom(gold, () => 90)
    const target = tampered.cases.find(entry => entry.caseId === 'oa-answer')
    expect(target).toBeDefined()
    if (target !== undefined) first(target.dimensions).points = 99
    expect(validateRunRecord(tampered, space, gold, 'run.json').join('\n')).toContain('满分 99,rubric 为 30')
  })

  it('缺少某个 case 的观测即失败', () => {
    const partial = recordFrom(gold, () => 90)
    partial.cases = partial.cases.filter(entry => entry.caseId !== 'claim-drafting')
    expect(validateRunRecord(partial, space, gold, 'run.json').join('\n')).toContain('缺少 case "claim-drafting" 的观测')
  })

  it('分数越界即失败', () => {
    const outOfRange = recordFrom(gold, (caseId, index) => caseId === 'oa-answer' && index === 1 ? 120 : 90)
    expect(validateRunRecord(outOfRange, space, gold, 'run.json').join('\n')).toContain('超出 0–100')
  })
})

describe('判定与归因', () => {
  it('节点分按 DAG 权重聚合,跨 case 的同一节点合并计权', () => {
    const run = recordFrom(gold, (caseId, index) => (caseId === 'oa-answer' && index === 1 ? 80 : 60))
    const scores = nodeScores(space, run)
    // oa-answer#1 权重 30 记 80,novelty-creative#2 权重 20 记 60。
    expect(scores.get('distinguishing-features')).toBeCloseTo((80 * 30 + 60 * 20) / 50, 10)
    expect(scores.get('infringement-all-elements')).toBeCloseTo(60, 10)
  })

  it('拆到两个节点的维度分别计入两侧', () => {
    const run = recordFrom(gold, (caseId, index) => (caseId === 'oa-answer' && index === 5 ? 100 : 70))
    const scores = nodeScores(space, run)
    expect(scores.get('prior-art-search')).toBeCloseTo(100, 10)
    expect(scores.get('deliverable-format')).toBeCloseTo(100, 10)
    const scores70 = caseScores(run)
    expect(scores70.find(entry => entry.caseId === 'oa-answer')?.score).toBeCloseTo((30 * 70 + 20 * 70 + 20 * 70 + 15 * 70 + 15 * 100) / 100, 10)
  })

  it('回退超过 maxDrop 的节点判为 regressed 并排在最前', () => {
    const baseline = recordFrom(gold, () => 90)
    const run = recordFrom(gold, (caseId, index) =>
      (caseId === 'oa-answer' && index === 1) || (caseId === 'novelty-creative' && index === 2) ? 80 : 90)
    const verdict = evaluateRun(space, config, run, baseline)
    expect(verdictPassed(verdict)).toBe(false)
    expect(first(verdict.nodes).id).toBe('distinguishing-features')
    expect(first(verdict.nodes).verdict).toBe('regressed')
    expect(first(verdict.nodes).delta).toBeCloseTo(-10, 10)
    expect(formatVerdict(verdict)).toContain('[regressed] distinguishing-features')
    expect(verdict.nodes.filter(node => node.verdict === 'pass').length).toBe(Object.keys(space.nodes).length - 1)
  })

  it('case 层抓住被节点均值摊薄的整案掉分', () => {
    const baseline = recordFrom(gold, () => 90)
    const run = recordFrom(gold, (caseId, index) => caseId === 'oa-answer' && index <= 4 ? 84 : 90)
    const verdict = evaluateRun(space, config, run, baseline)
    expect(verdict.cases.find(entry => entry.id === 'oa-answer')?.verdict).toBe('regressed')
    expect(verdict.nodes.every(node => node.verdict === 'pass')).toBe(true)
    expect(verdict.aggregateVerdict).toBe('pass')
    expect(verdictPassed(verdict)).toBe(false)
  })

  it('低于绝对下限判为 below-floor', () => {
    const run = recordFrom(gold, (caseId, index) => caseId === 'claim-drafting' && index === 1 ? 50 : 90)
    const verdict = evaluateRun(space, config, run, undefined)
    expect(verdict.nodes.find(node => node.id === 'claim-essential-features')?.verdict).toBe('below-floor')
    expect(verdictPassed(verdict)).toBe(false)
  })

  it('回退在容忍内且不低于下限时通过', () => {
    const baseline = recordFrom(gold, () => 90)
    const run = recordFrom(gold, () => 88)
    const verdict = evaluateRun(space, config, run, baseline)
    expect(verdict.aggregateVerdict).toBe('pass')
    expect(verdictPassed(verdict)).toBe(true)
    expect(verdict.aggregateBaselineScore).toBeCloseTo(90, 10)
  })

  it('聚合同样受门槛约束', () => {
    const run = recordFrom(gold, () => 72)
    const verdict = evaluateRun(space, config, run, undefined)
    expect(verdict.aggregateScore).toBeCloseTo(72, 10)
    expect(verdict.aggregateVerdict).toBe('below-floor')
    expect(verdictPassed(verdict)).toBe(false)
  })
})

describe('门禁进程', () => {
  it('基线缺席时报休眠、记录后报已记录,两种状态都以 0 退出', () => {
    // 基线一旦按 README 记录下来,这条用例必须继续成立,而不是因为「下一步动作」变红。
    const recorded = existsSync(resolve(root, config.baselinePath))
    const result = runGate()
    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.status, String(result.stderr)).toBe(0)
    expect(String(result.stdout)).toContain('17 节点')
    expect(String(result.stdout)).toContain(recorded ? '基线已记录' : '回归层休眠')
  })

  it('基线路径越出仓库即被判定', () => {
    expect(isOutsideRoot('/repo', 'packages/self-evolve/evaluation/baseline.json')).toBe(false)
    expect(isOutsideRoot('/repo', '/etc/baseline.json')).toBe(true)
    expect(isOutsideRoot('/repo', '../../etc/baseline.json')).toBe(true)
    expect(isOutsideRoot('/repo', '../repo-other/baseline.json')).toBe(true)
  })

  it('低于下限的 run 记录以 1 退出并按节点归因', () => {
    const record = writeRecord(recordFrom(gold, () => 10))
    const result = runGate('--run', record)
    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.status, String(result.stderr)).toBe(1)
    expect(String(result.stdout)).toContain('[below-floor]')
    expect(String(result.stderr)).toContain('未通过门槛')
  })

  it('低于下限的 run 记录不会被提升为基线', () => {
    const result = runGate('--accept', writeRecord(recordFrom(gold, () => 10)))
    expect(result.status, String(result.stderr)).toBe(1)
    expect(String(result.stderr)).toContain('拒绝把')
  })

  it('与金标不符的 run 记录以 1 退出且不进入判定', () => {
    const record = recordFrom(gold, () => 90)
    first(first(record.cases).dimensions).points = 1
    const result = runGate('--run', writeRecord(record))
    expect(result.status, String(result.stderr)).toBe(1)
    expect(String(result.stderr)).toContain('满分 1,rubric 为 30')
  })

  it('记录的内容摘要与金标一致,门禁读到的正是仓库里的金标', () => {
    expect(goldDigest(gold)).toBe(readFileSync(gatePath, 'utf8').match(/^goldDigest: "(.+)"$/mu)?.[1])
  })
})
