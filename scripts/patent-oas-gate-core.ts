/**
 * `patent-oas` 问题空间 DAG 与带门槛回归门禁的共同核心。
 *
 * 金标(`examples/patent-oas/cases/<case>/statement|rubric`)只描述「每个 case 得几分」;
 * 一个问题空间节点被哪些 case、哪些 rubric 维度观测,记在 `problem-space.yaml` 里。
 * 本模块把两者钉在一起:任一侧漂移(改了 rubric 却没改映射、映射指向不存在的节点、
 * 映射权重与 rubric 满分不符、图里出现环)都是可判定的失败,而不是只有总分一个信号。
 *
 * 分数只从原始证据推导,不重复存储:run 记录保存逐维度的原始观测分,case 分与节点分
 * 由 DAG 现算。这样「节点分」不可能是另一处手工维护的副本。
 *
 * @module
 */

import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { JSON_SCHEMA, load as loadYaml } from 'js-yaml'

/** 问题空间图上的一个节点:一个可被交付物观测的实务切面。 */
export interface ProblemSpaceNode {
  /** 节点 id,同时是 gate 输出里归因用的稳定键。 */
  id: string
  /** 所属问题域(检索/创造性/撰写/侵权/交付物),用于分组输出。 */
  domain: string
  /** 中文短名。 */
  label: string
  /** 该节点在交付物里的可观测要求。 */
  observable: string
  /** 先决节点:这些节点不过关时,本节点的判定不可信。 */
  dependsOn: string[]
}

/** 一个 rubric 维度到节点的分数拆解;权重之和必须等于该维度满分。 */
export interface DimensionMapping {
  /** 节点 id → 该维度分配给它的分值。 */
  nodes: Record<string, number>
}

/** 一个 case 的全部维度映射。 */
export interface CaseMapping {
  /** 中文短名。 */
  label: string
  /** rubric 维度序号(1 起) → 拆解。 */
  dimensions: Record<number, DimensionMapping>
}

/** 问题空间 DAG:节点、先决边、以及 case/rubric 维度到节点的绑定。 */
export interface ProblemSpace {
  /** 图所属的 benchmark id。 */
  benchmarkId: string
  /** case 映射。 */
  cases: Record<string, CaseMapping>
  /** 节点表。 */
  nodes: Record<string, ProblemSpaceNode>
}

/** 单条门槛:绝对下限与允许的基线回退量。 */
export interface GateThreshold {
  /** 该节点分数不得低于的下限(0–100)。 */
  minScore?: number
  /** 相对基线允许的最大回退分。 */
  maxDrop?: number
}

/** 门禁策略。 */
export interface GateConfig {
  /** 策略所属的 benchmark id。 */
  benchmarkId: string
  /** 金标内容摘要;未记录时为 null,门禁据此判定「金标未钉住」。 */
  goldDigest: string | null
  /** 基线 run 记录路径(相对仓库根)。 */
  baselinePath: string
  /** 门槛:默认值、聚合门槛、逐节点覆盖。 */
  thresholds: {
    node: Required<GateThreshold>
    case: Required<GateThreshold>
    aggregate: Required<GateThreshold>
    nodes: Record<string, GateThreshold>
  }
}

/** 从 rubric 文本解析出的一个评分维度。 */
export interface RubricDimension {
  /** 维度序号(1 起,取自 rubric 正文)。 */
  index: number
  /** 维度名。 */
  label: string
  /** 该维度满分。 */
  points: number
  /** 维度正文(满分/部分/零分描述),用于逐维度评估。 */
  body: string
}

/** 一个金标 case 的公开与私密两面。 */
export interface GoldCase {
  /** case id。 */
  caseId: string
  /** 公开任务文本。 */
  statement: string
  /** 私密评分标准。 */
  rubric: string
}

/** run 记录里的一个维度观测。 */
export interface RunDimension {
  /** 维度序号,必须与金标 rubric 一致。 */
  index: number
  /** 维度名,必须与金标 rubric 一致。 */
  label: string
  /** 维度满分,必须与金标 rubric 一致。 */
  points: number
  /** 评估者给出的该维度分数(0–100)。 */
  score: number
}

/** run 记录里的一个 case。 */
export interface RunCase {
  /** case id。 */
  caseId: string
  /** 该 case 的逐维度观测。 */
  dimensions: RunDimension[]
}

/** 一次实测的原始记录;基线与被检运行同构。 */
export interface RunRecord {
  /** 所属 benchmark id。 */
  benchmarkId: string
  /** 记录时间(ISO 8601)。 */
  recordedAt: string
  /** 评估运行使用的 provider;未报告时省略。 */
  provider?: string
  /** 评估运行使用的模型 id;未报告时省略。 */
  modelId?: string
  /** 每个 case 的运行次数。 */
  runsPerCase: number
  /** 逐 case 的原始观测。 */
  cases: RunCase[]
}

/** 单节点判定结果。 */
export type NodeVerdict = 'pass' | 'below-floor' | 'regressed'

/** 一个观测单元的判定:问题空间节点,或一个 case。 */
export interface UnitOutcome {
  /** 节点 id 或 case id。 */
  id: string
  /** 本次运行的分数。 */
  score: number
  /** 基线分数;无基线时省略。 */
  baselineScore?: number
  /** 相对基线的变化(本次 − 基线);无基线时省略。 */
  delta?: number
  /** 判定。 */
  verdict: NodeVerdict
}

/** 一个节点的判定。 */
export type NodeOutcome = UnitOutcome

/** 一个 case 的判定。 */
export type CaseOutcome = UnitOutcome

/** 一次运行的完整判定。 */
export interface GateVerdict {
  /** case 均值(与引擎的 ScoreboardEntry.score 同定义)。 */
  aggregateScore: number
  /** 聚合基线分;无基线时省略。 */
  aggregateBaselineScore?: number
  /** 聚合判定。 */
  aggregateVerdict: NodeVerdict
  /** 逐节点判定,按问题域与节点 id 排序,失败的在前。 */
  nodes: NodeOutcome[]
  /** 逐 case 判定,按 case id 排序。 */
  cases: CaseOutcome[]
}

/** rubric 维度标题行:`1. 区别特征认定(30 分):`。 */
const RUBRIC_DIMENSION = /^(\d+)\.\s*(.+?)\((\d+)\s*分\)\s*[:：]\s*$/

/** 金标 example 目录(仓库相对路径)。 */
export const PATENT_OAS_EXAMPLE_DIR = 'packages/self-evolve/self-evolve-benchmark/examples/patent-oas'

/** 问题空间 DAG 文件(仓库相对路径)。 */
export const PROBLEM_SPACE_FILE = `${PATENT_OAS_EXAMPLE_DIR}/problem-space.yaml`

/** 门禁策略文件(仓库相对路径)。 */
export const GATE_FILE = `${PATENT_OAS_EXAMPLE_DIR}/gate.yaml`

/** 判断一个值是否是普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 读一个必填字符串字段,缺失或类型不符即抛错并指明位置。 */
function requireString(source: Record<string, unknown>, key: string, where: string): string {
  const value = source[key]
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${where}: 字段 "${key}" 必须是非空字符串`)
  return value
}

/** 读一个必填有限数字段。 */
function requireNumber(source: Record<string, unknown>, key: string, where: string): number {
  const value = source[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${where}: 字段 "${key}" 必须是有限数`)
  return value
}

/** 读一个可选字符串字段。 */
function optionalString(source: Record<string, unknown>, key: string, where: string): string | undefined {
  const value = source[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new Error(`${where}: 字段 "${key}" 必须是字符串`)
  return value
}

/** 读一个必填对象字段。 */
function requireRecord(source: Record<string, unknown>, key: string, where: string): Record<string, unknown> {
  const value = source[key]
  if (!isRecord(value)) throw new Error(`${where}: 字段 "${key}" 必须是对象`)
  return value
}

/** 解析一个 YAML 文档为对象;非对象文档即抛错。 */
async function loadYamlObject(path: string): Promise<Record<string, unknown>> {
  const parsed: unknown = loadYaml(await readFile(path, 'utf8'), { schema: JSON_SCHEMA })
  if (!isRecord(parsed)) throw new Error(`${path}: 顶层必须是映射`)
  return parsed
}

/** 计算文本的十六进制 sha256。 */
function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * 解析 rubric 文本里的评分维度。
 *
 * 维度标题形如 `1. 区别特征认定(30 分):`,正文延续到下一个标题。找不到任何维度即抛错,
 * 因为一份没有维度的 rubric 无法支撑逐维度归因。
 *
 * @param rubric rubric 原文。
 * @returns 按出现顺序排列的维度。
 */
export function parseRubricDimensions(rubric: string): RubricDimension[] {
  const dimensions: RubricDimension[] = []
  let current: { index: number; label: string; points: number; lines: string[] } | undefined
  for (const line of rubric.split('\n')) {
    const match = RUBRIC_DIMENSION.exec(line.trimEnd())
    if (match !== null) {
      const [, rawIndex, rawLabel, rawPoints] = match
      if (rawIndex === undefined || rawLabel === undefined || rawPoints === undefined) {
        // 三个捕获组由 RUBRIC_DIMENSION 固定给出;这一步只为让类型收窄。
        throw new Error(`rubric: 维度标题无法解析:${line}`)
      }
      if (current !== undefined) dimensions.push({ ...current, body: current.lines.join('\n').trim() })
      current = { index: Number(rawIndex), label: rawLabel.trim(), points: Number(rawPoints), lines: [] }
      continue
    }
    if (current !== undefined) current.lines.push(line)
  }
  if (current !== undefined) dimensions.push({ ...current, body: current.lines.join('\n').trim() })
  if (dimensions.length === 0) throw new Error('rubric: 未解析出任何评分维度(期望形如 "1. 维度名(30 分):")')
  return dimensions
}

/**
 * 金标内容摘要:按 case id 排序,对每个 case 的 statement/rubric 逐文件取 sha256 后汇总。
 *
 * 摘要用于把「金标被改动过」变成一次显式的重录动作,而不是悄悄生效。
 *
 * @param cases 金标 case 集。
 * @returns `sha256:<hex>` 形式的摘要。
 */
export function goldDigest(cases: readonly GoldCase[]): string {
  const canonical = [...cases]
    .sort((a, b) => a.caseId.localeCompare(b.caseId))
    .map(entry => `${entry.caseId}\n${sha256(entry.statement)}\n${sha256(entry.rubric)}\n`)
    .join('')
  return `sha256:${sha256(canonical)}`
}

/**
 * 从 example 目录读取金标 case(创作布局:`cases/<caseId>/statement|rubric`)。
 *
 * 每个 case 目录必须恰好是这两种文件:多出来的文件既可能是残留草稿,也可能是本该被
 * 物理隔离的答案,门禁不能默许。
 *
 * @param exampleDir `examples/patent-oas` 的绝对路径。
 * @returns 按 case id 排序的金标 case 集。
 */
export async function loadGold(exampleDir: string): Promise<GoldCase[]> {
  const casesDir = join(exampleDir, 'cases')
  const entries = await readdir(casesDir, { withFileTypes: true })
  const caseIds = entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
  if (caseIds.length === 0) throw new Error(`${casesDir}: 没有任何 case 目录`)
  const cases: GoldCase[] = []
  for (const caseId of caseIds) {
    const files = (await readdir(join(casesDir, caseId), { withFileTypes: true }))
      .map(entry => entry.name)
      .sort()
    if (files.join(',') !== 'rubric,statement') {
      throw new Error(`cases/${caseId}: 目录必须恰好含 statement 与 rubric,实际为 [${files.join(', ')}]`)
    }
    cases.push({
      caseId,
      statement: await readFile(join(casesDir, caseId, 'statement'), 'utf8'),
      rubric: await readFile(join(casesDir, caseId, 'rubric'), 'utf8'),
    })
  }
  return cases
}

/**
 * 读取并校验 problem-space.yaml 的结构。
 *
 * @param path 文件路径。
 * @returns 问题空间 DAG。
 */
export async function loadProblemSpace(path: string): Promise<ProblemSpace> {
  const root = await loadYamlObject(path)
  const benchmarkId = requireString(root, 'benchmarkId', path)
  const rawCases = requireRecord(root, 'cases', path)
  const rawNodes = requireRecord(root, 'nodes', path)
  const cases: Record<string, CaseMapping> = {}
  for (const [caseId, rawCase] of Object.entries(rawCases)) {
    const where = `${path}: cases.${caseId}`
    if (!isRecord(rawCase)) throw new Error(`${where}: 必须是对象`)
    const label = requireString(rawCase, 'label', where)
    const rawDimensions = requireRecord(rawCase, 'dimensions', where)
    const dimensions: Record<number, DimensionMapping> = {}
    for (const [index, rawDimension] of Object.entries(rawDimensions)) {
      const dimensionWhere = `${where}.dimensions.${index}`
      const numeric = Number(index)
      if (!Number.isInteger(numeric) || numeric < 1) throw new Error(`${dimensionWhere}: 维度序号必须是正整数`)
      if (!isRecord(rawDimension)) throw new Error(`${dimensionWhere}: 必须是对象`)
      const rawNodes = requireRecord(rawDimension, 'nodes', dimensionWhere)
      const nodes: Record<string, number> = {}
      for (const [nodeId, weight] of Object.entries(rawNodes)) {
        if (typeof weight !== 'number' || !Number.isFinite(weight)) {
          throw new Error(`${dimensionWhere}.nodes.${nodeId}: 权重必须是有限数`)
        }
        nodes[nodeId] = weight
      }
      dimensions[numeric] = { nodes }
    }
    cases[caseId] = { label, dimensions }
  }
  const nodes: Record<string, ProblemSpaceNode> = {}
  for (const [nodeId, rawNode] of Object.entries(rawNodes)) {
    const where = `${path}: nodes.${nodeId}`
    if (!isRecord(rawNode)) throw new Error(`${where}: 必须是对象`)
    const rawDependsOn = rawNode.dependsOn
    if (!Array.isArray(rawDependsOn)) throw new Error(`${where}: dependsOn 必须是数组`)
    const dependsOn = rawDependsOn.map((entry, index) => {
      if (typeof entry !== 'string') throw new Error(`${where}.dependsOn[${index}]: 必须是节点 id 字符串`)
      return entry
    })
    nodes[nodeId] = {
      id: nodeId,
      domain: requireString(rawNode, 'domain', where),
      label: requireString(rawNode, 'label', where),
      observable: requireString(rawNode, 'observable', where),
      dependsOn,
    }
  }
  return { benchmarkId, cases, nodes }
}

/**
 * 读取并校验 gate.yaml 的结构。
 *
 * @param path 文件路径。
 * @returns 门禁策略。
 */
export async function loadGateConfig(path: string): Promise<GateConfig> {
  const root = await loadYamlObject(path)
  const benchmarkId = requireString(root, 'benchmarkId', path)
  const baselinePath = requireString(root, 'baselinePath', path)
  const digest = optionalString(root, 'goldDigest', path) ?? null
  const rawThresholds = requireRecord(root, 'thresholds', path)
  const readThreshold = (value: unknown, where: string): Required<GateThreshold> => {
    if (!isRecord(value)) throw new Error(`${where}: 必须是对象`)
    return { minScore: requireNumber(value, 'minScore', where), maxDrop: requireNumber(value, 'maxDrop', where) }
  }
  const rawNodes = rawThresholds.nodes ?? {}
  if (!isRecord(rawNodes)) throw new Error(`${path}: thresholds.nodes 必须是对象`)
  const nodes: Record<string, GateThreshold> = {}
  for (const [nodeId, value] of Object.entries(rawNodes)) {
    if (!isRecord(value)) throw new Error(`${path}: thresholds.nodes.${nodeId} 必须是对象`)
    nodes[nodeId] = {
      ...value.minScore === undefined ? {} : { minScore: requireNumber(value, 'minScore', `${path}: thresholds.nodes.${nodeId}`) },
      ...value.maxDrop === undefined ? {} : { maxDrop: requireNumber(value, 'maxDrop', `${path}: thresholds.nodes.${nodeId}`) },
    }
  }
  return {
    benchmarkId,
    goldDigest: digest,
    baselinePath,
    thresholds: {
      node: readThreshold(rawThresholds.node, `${path}: thresholds.node`),
      case: readThreshold(rawThresholds.case, `${path}: thresholds.case`),
      aggregate: readThreshold(rawThresholds.aggregate, `${path}: thresholds.aggregate`),
      nodes,
    },
  }
}

/**
 * 读取并校验一次 run 记录(基线或实测)的结构。
 *
 * @param path JSON 文件路径。
 * @returns run 记录。
 */
export async function loadRunRecord(path: string): Promise<RunRecord> {
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (!isRecord(parsed)) throw new Error(`${path}: 顶层必须是对象`)
  const rawCases = parsed.cases
  if (!Array.isArray(rawCases)) throw new Error(`${path}: cases 必须是数组`)
  const cases: RunCase[] = rawCases.map((rawCase, caseIndex) => {
    const where = `${path}: cases[${caseIndex}]`
    if (!isRecord(rawCase)) throw new Error(`${where}: 必须是对象`)
    const caseId = requireString(rawCase, 'caseId', where)
    const rawDimensions = rawCase.dimensions
    if (!Array.isArray(rawDimensions)) throw new Error(`${where}: dimensions 必须是数组`)
    const dimensions: RunDimension[] = rawDimensions.map((rawDimension, dimensionIndex) => {
      const dimensionWhere = `${where}.dimensions[${dimensionIndex}]`
      if (!isRecord(rawDimension)) throw new Error(`${dimensionWhere}: 必须是对象`)
      return {
        index: requireNumber(rawDimension, 'index', dimensionWhere),
        label: requireString(rawDimension, 'label', dimensionWhere),
        points: requireNumber(rawDimension, 'points', dimensionWhere),
        score: requireNumber(rawDimension, 'score', dimensionWhere),
      }
    })
    return { caseId, dimensions }
  })
  const record: RunRecord = {
    benchmarkId: requireString(parsed, 'benchmarkId', path),
    recordedAt: requireString(parsed, 'recordedAt', path),
    runsPerCase: requireNumber(parsed, 'runsPerCase', path),
    cases,
  }
  const provider = optionalString(parsed, 'provider', path)
  if (provider !== undefined) record.provider = provider
  const modelId = optionalString(parsed, 'modelId', path)
  if (modelId !== undefined) record.modelId = modelId
  return record
}

/**
 * 分数取两位小数,与引擎计分板的 `ScoreboardEntry` 口径一致。
 *
 * 记录里的每一条分数都经这里落盘,因此「记录的分数」与「引擎计分板的分数」不会因为
 * 两处各写一遍四舍五入而分叉。
 *
 * @param value 原始分数。
 * @returns 两位小数后的分数。
 */
export function roundScore(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * 判断一个仓库相对路径是否会写出仓库根之外。
 *
 * `gate.yaml` 的 `baselinePath` 是配置,绝对路径或足够多的 `../` 都能把基线写到仓库外;
 * 采集出来的证据应当落在版本库内,因此写盘前先做这一步检查。
 *
 * @param root 仓库根绝对路径。
 * @param relativePath 配置里的路径。
 * @returns 目标是否落在仓库根之外。
 */
export function isOutsideRoot(root: string, relativePath: string): boolean {
  const target = resolve(root, relativePath)
  return target !== root && !target.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)
}

/** 判定的严重度排序键:越严重越靠前。 */
function verdictRank(verdict: NodeVerdict): number {
  switch (verdict) {
    case 'regressed': return 0
    case 'below-floor': return 1
    case 'pass': return 2
  }
}

/**
 * 校验问题空间 DAG 与金标是否互相钉住。
 *
 * 覆盖:双向 case 覆盖、每个 rubric 维度都被映射、映射权重等于维度满分、case 权重合计
 * 100、映射目标节点存在、每个节点都有观测面、先决边指向存在节点且全图无环。
 *
 * @param space 问题空间 DAG。
 * @param gold 金标 case 集。
 * @returns 一条问题一条消息;为空表示互相一致。
 */
export function validateProblemSpace(space: ProblemSpace, gold: readonly GoldCase[]): string[] {
  const problems: string[] = []
  const goldIds = new Set(gold.map(entry => entry.caseId))
  for (const caseId of goldIds) {
    if (space.cases[caseId] === undefined) problems.push(`problem-space: 金标 case "${caseId}" 没有维度映射`)
  }
  for (const caseId of Object.keys(space.cases)) {
    if (!goldIds.has(caseId)) problems.push(`problem-space: 映射了不存在的 case "${caseId}"`)
  }
  const observedNodes = new Set<string>()
  for (const goldCase of gold) {
    const mapping = space.cases[goldCase.caseId]
    if (mapping === undefined) continue
    const dimensions = parseRubricDimensions(goldCase.rubric)
    const mappedIndices = Object.keys(mapping.dimensions).map(Number)
    for (const dimension of dimensions) {
      const entry = mapping.dimensions[dimension.index]
      if (entry === undefined) {
        problems.push(`problem-space: case "${goldCase.caseId}" 的维度 ${dimension.index}「${dimension.label}」没有映射`)
        continue
      }
      const weight = Object.values(entry.nodes).reduce((sum, value) => sum + value, 0)
      if (weight !== dimension.points) {
        problems.push(
          `problem-space: case "${goldCase.caseId}" 维度 ${dimension.index} 映射权重合计 ${weight},rubric 满分为 ${dimension.points}`,
        )
      }
      for (const [nodeId, weight] of Object.entries(entry.nodes)) {
        if (space.nodes[nodeId] === undefined) problems.push(`problem-space: 映射到未声明的节点 "${nodeId}"`)
        // 求和尚等于满分不足以说明映射有效:负权重能从别处抵消出一个"合法"合计,
        // 而节点分是加权均值,负权重会把归因整个扭偏;零权重则让节点看似有观测面却不计权重。
        if (weight <= 0) {
          problems.push(`problem-space: case "${goldCase.caseId}" 维度 ${dimension.index} 的节点 "${nodeId}" 权重 ${weight} 必须为正`)
        }
        observedNodes.add(nodeId)
      }
    }
    for (const index of mappedIndices) {
      if (!dimensions.some(dimension => dimension.index === index)) {
        problems.push(`problem-space: case "${goldCase.caseId}" 映射了 rubric 中不存在的维度 ${index}`)
      }
    }
    const totalPoints = dimensions.reduce((sum, dimension) => sum + dimension.points, 0)
    if (totalPoints !== 100) problems.push(`problem-space: case "${goldCase.caseId}" 的 rubric 满分合计 ${totalPoints},应为 100`)
  }
  for (const nodeId of Object.keys(space.nodes)) {
    if (!observedNodes.has(nodeId)) problems.push(`problem-space: 节点 "${nodeId}" 没有任何 rubric 维度映射,无法打分`)
  }
  for (const node of Object.values(space.nodes)) {
    for (const dependency of node.dependsOn) {
      if (space.nodes[dependency] === undefined) problems.push(`problem-space: 节点 "${node.id}" 的先决节点 "${dependency}" 不存在`)
      if (dependency === node.id) problems.push(`problem-space: 节点 "${node.id}" 依赖自身`)
    }
  }
  problems.push(...findCycles(space))
  return problems
}

/**
 * 检测问题空间图上的环,返回每个环的路径。
 *
 * @param space 问题空间 DAG。
 * @returns 每条环一条消息。
 */
export function findCycles(space: ProblemSpace): string[] {
  const problems: string[] = []
  const state = new Map<string, 'visiting' | 'done'>()
  const path: string[] = []
  const visit = (nodeId: string): void => {
    const seen = state.get(nodeId)
    if (seen === 'done') return
    if (seen === 'visiting') {
      problems.push(`problem-space: 先决关系成环 ${[...path.slice(path.indexOf(nodeId)), nodeId].join(' → ')}`)
      return
    }
    state.set(nodeId, 'visiting')
    path.push(nodeId)
    for (const dependency of space.nodes[nodeId]?.dependsOn ?? []) {
      if (space.nodes[dependency] !== undefined) visit(dependency)
    }
    path.pop()
    state.set(nodeId, 'done')
  }
  for (const nodeId of Object.keys(space.nodes)) visit(nodeId)
  return problems
}

/**
 * 校验一次 run 记录的维度观测是否与该金标一致。
 *
 * @param run run 记录。
 * @param space 问题空间 DAG。
 * @param gold 金标 case 集。
 * @param label 用于诊断的标签(如文件路径)。
 * @returns 一条问题一条消息。
 */
export function validateRunRecord(
  run: RunRecord,
  space: ProblemSpace,
  gold: readonly GoldCase[],
  label: string,
): string[] {
  const problems: string[] = []
  if (run.benchmarkId !== space.benchmarkId) {
    problems.push(`${label}: benchmarkId "${run.benchmarkId}" 与问题空间 "${space.benchmarkId}" 不一致`)
  }
  if (!Number.isInteger(run.runsPerCase) || run.runsPerCase < 1) problems.push(`${label}: runsPerCase 必须是正整数`)
  const seen = new Set<string>()
  for (const runCase of run.cases) {
    if (seen.has(runCase.caseId)) problems.push(`${label}: case "${runCase.caseId}" 重复出现`)
    seen.add(runCase.caseId)
    const goldCase = gold.find(entry => entry.caseId === runCase.caseId)
    if (goldCase === undefined) {
      problems.push(`${label}: case "${runCase.caseId}" 不在金标中`)
      continue
    }
    if (space.cases[runCase.caseId] === undefined) {
      problems.push(`${label}: case "${runCase.caseId}" 没有问题空间映射`)
      continue
    }
    const dimensions = parseRubricDimensions(goldCase.rubric)
    for (const runDimension of runCase.dimensions) {
      if (!Number.isInteger(runDimension.index)) {
        problems.push(`${label}: case "${runCase.caseId}" 存在非整数维度序号 ${runDimension.index}`)
        continue
      }
      const expected = dimensions.find(dimension => dimension.index === runDimension.index)
      if (expected === undefined) {
        problems.push(`${label}: case "${runCase.caseId}" 观测了 rubric 中不存在的维度 ${runDimension.index}`)
        continue
      }
      if (expected.label !== runDimension.label) {
        problems.push(`${label}: case "${runCase.caseId}" 维度 ${runDimension.index} 名为「${runDimension.label}」,rubric 为「${expected.label}」`)
      }
      if (expected.points !== runDimension.points) {
        problems.push(`${label}: case "${runCase.caseId}" 维度 ${runDimension.index} 满分 ${runDimension.points},rubric 为 ${expected.points}`)
      }
      if (runDimension.score < 0 || runDimension.score > 100) {
        problems.push(`${label}: case "${runCase.caseId}" 维度 ${runDimension.index} 分数 ${runDimension.score} 超出 0–100`)
      }
    }
    const observed = new Set(runCase.dimensions.map(dimension => dimension.index))
    for (const dimension of dimensions) {
      if (!observed.has(dimension.index)) problems.push(`${label}: case "${runCase.caseId}" 缺少维度 ${dimension.index} 的观测`)
    }
  }
  for (const goldCase of gold) {
    if (!seen.has(goldCase.caseId)) problems.push(`${label}: 缺少 case "${goldCase.caseId}" 的观测`)
  }
  return problems
}

/**
 * 校验门槛策略与基线自身的可满足性。
 *
 * 包含:benchmarkId 一致、金标摘要已记录且与当前金标相符、门槛取值域合法、逐节点覆盖
 * 指向真实节点、基线(如有)结构合法且本身不得低于自己声明的下限——一个永远不可能绿的
 * 门禁比没有门禁更糟。
 *
 * @param config 门禁策略。
 * @param space 问题空间 DAG。
 * @param gold 金标 case 集。
 * @param baseline 已记录的基线;未记录时为 undefined。
 * @param baselineLabel 基线来源标签(用于诊断)。
 * @returns 一条问题一条消息。
 */
export function validateGateConfig(
  config: GateConfig,
  space: ProblemSpace,
  gold: readonly GoldCase[],
  baseline: RunRecord | undefined,
  baselineLabel: string,
): string[] {
  const problems: string[] = []
  if (config.benchmarkId !== space.benchmarkId) {
    problems.push(`gate: benchmarkId "${config.benchmarkId}" 与问题空间 "${space.benchmarkId}" 不一致`)
  }
  const digest = goldDigest(gold)
  if (config.goldDigest === null) {
    problems.push(`gate: 未记录 goldDigest;金标改动无法被察觉。用 --write 重录(${digest})`)
  } else if (config.goldDigest !== digest) {
    problems.push(`gate: goldDigest 与当前金标不符(记录 ${config.goldDigest},实际 ${digest})`)
  }
  const thresholds: Array<[string, Required<GateThreshold> | GateThreshold]> = [
    ['thresholds.node', config.thresholds.node],
    ['thresholds.case', config.thresholds.case],
    ['thresholds.aggregate', config.thresholds.aggregate],
    ...Object.entries(config.thresholds.nodes).map(([nodeId, value]) => [`thresholds.nodes.${nodeId}`, value] as [string, GateThreshold]),
  ]
  for (const [where, threshold] of thresholds) {
    if (threshold.minScore !== undefined && (threshold.minScore < 0 || threshold.minScore > 100)) {
      problems.push(`gate: ${where}.minScore ${threshold.minScore} 超出 0–100`)
    }
    if (threshold.maxDrop !== undefined && threshold.maxDrop < 0) {
      problems.push(`gate: ${where}.maxDrop ${threshold.maxDrop} 不能为负`)
    }
  }
  for (const nodeId of Object.keys(config.thresholds.nodes)) {
    if (space.nodes[nodeId] === undefined) problems.push(`gate: thresholds.nodes 指向不存在的节点 "${nodeId}"`)
  }
  if (baseline !== undefined) {
    problems.push(...validateRunRecord(baseline, space, gold, baselineLabel))
    const baselineVerdict = evaluateRun(space, config, baseline, undefined)
    for (const outcome of [...baselineVerdict.nodes, ...baselineVerdict.cases]) {
      if (outcome.verdict !== 'pass') {
        problems.push(`gate: 基线自身在 "${outcome.id}" 上 ${outcome.verdict}(分数 ${outcome.score}),门槛不可能被满足`)
      }
    }
    if (baselineVerdict.aggregateVerdict !== 'pass') {
      problems.push(`gate: 基线自身聚合判定为 ${baselineVerdict.aggregateVerdict}(分数 ${baselineVerdict.aggregateScore}),门槛不可能被满足`)
    }
  }
  return problems
}

/** 解析某个节点实际生效的门槛。 */
function nodeThreshold(config: GateConfig, nodeId: string): Required<GateThreshold> {
  const override = config.thresholds.nodes[nodeId] ?? {}
  return {
    minScore: override.minScore ?? config.thresholds.node.minScore,
    maxDrop: override.maxDrop ?? config.thresholds.node.maxDrop,
  }
}

/** 按门槛判定一个分数。 */
function judge(score: number, baseline: number | undefined, threshold: Required<GateThreshold>): NodeVerdict {
  if (score < threshold.minScore) return 'below-floor'
  if (baseline !== undefined && baseline - score > threshold.maxDrop) return 'regressed'
  return 'pass'
}

/**
 * 由一次 run 的原始观测算出逐 case 分数。
 *
 * case 分 = 各维度分按其满分加权平均;与引擎的 `ScoreboardEntry.cases[].score` 同定义。
 *
 * @param run run 记录。
 * @returns 按 case id 排序的分数。
 */
export function caseScores(run: RunRecord): Array<{ caseId: string; score: number }> {
  return [...run.cases]
    .sort((a, b) => a.caseId.localeCompare(b.caseId))
    .map((runCase) => {
      const points = runCase.dimensions.reduce((sum, dimension) => sum + dimension.points, 0)
      const weighted = runCase.dimensions.reduce((sum, dimension) => sum + dimension.score * dimension.points, 0)
      return { caseId: runCase.caseId, score: points === 0 ? 0 : weighted / points }
    })
}

/**
 * 由一次 run 的原始观测算出逐节点分数。
 *
 * 节点分按该节点在各维度上分到的权重加权平均;没有观测面的节点不会出现在结果里
 * (问题空间校验会先拒绝这种图)。
 *
 * @param space 问题空间 DAG。
 * @param run run 记录。
 * @returns 节点 id → 分数。
 */
export function nodeScores(space: ProblemSpace, run: RunRecord): Map<string, number> {
  const weighted = new Map<string, number>()
  const weights = new Map<string, number>()
  for (const runCase of run.cases) {
    const mapping = space.cases[runCase.caseId]
    if (mapping === undefined) continue
    for (const runDimension of runCase.dimensions) {
      const entry = mapping.dimensions[runDimension.index]
      if (entry === undefined) continue
      for (const [nodeId, weight] of Object.entries(entry.nodes)) {
        weighted.set(nodeId, (weighted.get(nodeId) ?? 0) + runDimension.score * weight)
        weights.set(nodeId, (weights.get(nodeId) ?? 0) + weight)
      }
    }
  }
  const scores = new Map<string, number>()
  for (const [nodeId, total] of weighted) {
    const weight = weights.get(nodeId) ?? 0
    scores.set(nodeId, weight === 0 ? 0 : total / weight)
  }
  return scores
}

/**
 * 判定一次 run:逐 case、逐问题空间节点以及聚合的门槛检查,以及与基线的回退比较。
 *
 * 三个层级都判:节点层给出问题空间归因,case 层防止「单个 case 掉分被节点均值摊薄」,
 * 聚合层守住整体水平。任一层不过即整体不过。
 *
 * @param space 问题空间 DAG。
 * @param config 门禁策略。
 * @param run 被判定的一次运行。
 * @param baseline 基线;未记录时为 undefined(此时只做绝对下限判定)。
 * @returns 判定结果。
 */
export function evaluateRun(
  space: ProblemSpace,
  config: GateConfig,
  run: RunRecord,
  baseline: RunRecord | undefined,
): GateVerdict {
  const scores = nodeScores(space, run)
  const baselineScores = baseline === undefined ? undefined : nodeScores(space, baseline)
  const nodes: NodeOutcome[] = [...scores]
    .map(([nodeId, score]) => {
      const baselineScore = baselineScores?.get(nodeId)
      return {
        id: nodeId,
        score,
        ...baselineScore === undefined ? {} : { baselineScore, delta: score - baselineScore },
        verdict: judge(score, baselineScore, nodeThreshold(config, nodeId)),
      }
    })
    .sort((a, b) => {
      const byVerdict = verdictRank(a.verdict) - verdictRank(b.verdict)
      if (byVerdict !== 0) return byVerdict
      const byDomain = (space.nodes[a.id]?.domain ?? '').localeCompare(space.nodes[b.id]?.domain ?? '')
      return byDomain !== 0 ? byDomain : a.id.localeCompare(b.id)
    })
  const caseList = caseScores(run)
  const baselineCaseList = baseline === undefined ? undefined : caseScores(baseline)
  const cases: CaseOutcome[] = caseList.map((entry) => {
    const baselineScore = baselineCaseList?.find(candidate => candidate.caseId === entry.caseId)?.score
    return {
      id: entry.caseId,
      score: entry.score,
      ...baselineScore === undefined ? {} : { baselineScore, delta: entry.score - baselineScore },
      verdict: judge(entry.score, baselineScore, config.thresholds.case),
    }
  })
  const aggregateScore = mean(caseList.map(entry => entry.score))
  const aggregateBaseline = baselineCaseList === undefined ? undefined : mean(baselineCaseList.map(entry => entry.score))
  return {
    aggregateScore,
    ...aggregateBaseline === undefined ? {} : { aggregateBaselineScore: aggregateBaseline },
    aggregateVerdict: judge(aggregateScore, aggregateBaseline, config.thresholds.aggregate),
    nodes,
    cases,
  }
}

/**
 * 算术平均;空列表为 0。
 *
 * @param values 数值列表。
 * @returns 平均值。
 */
export function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
}

/** 判定是否全部通过。 */
export function verdictPassed(verdict: GateVerdict): boolean {
  return verdict.aggregateVerdict === 'pass'
    && verdict.cases.every(entry => entry.verdict === 'pass')
    && verdict.nodes.every(entry => entry.verdict === 'pass')
}

/**
 * 把判定渲染成门禁输出:先聚合,再 case,再按问题域列节点,失败的在前。
 *
 * @param verdict 判定结果。
 * @returns 多行文本。
 */
export function formatVerdict(verdict: GateVerdict): string {
  const lines: string[] = []
  const baseline = verdict.aggregateBaselineScore === undefined ? '' : `基线 ${verdict.aggregateBaselineScore.toFixed(2)}, `
  lines.push(`聚合:${verdict.aggregateScore.toFixed(2)}(${baseline}判定 ${verdict.aggregateVerdict})`)
  for (const entry of verdict.cases) lines.push(`[${entry.verdict}] case ${describeOutcome(entry)}`)
  for (const node of verdict.nodes) lines.push(`[${node.verdict}] ${node.id} ${describeOutcome(node)}`)
  return lines.join('\n')
}

/** 渲染一个观测单元的分数与基线对比。 */
function describeOutcome(outcome: UnitOutcome): string {
  const baseline = outcome.baselineScore === undefined ? '' : ` 基线 ${outcome.baselineScore.toFixed(1)} Δ${outcome.delta?.toFixed(1)}`
  return `= ${outcome.score.toFixed(1)}${baseline}`
}
