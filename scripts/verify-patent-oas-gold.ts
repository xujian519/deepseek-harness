/**
 * 无 key 门禁:把 `patent-oas` 金标与它的问题空间 DAG、门槛策略钉在一起。
 *
 * 判定三件事:
 *   1. 金标与 DAG 互相钉住(rubric 维度全部有映射、映射权重等于满分、节点都有观测面、
 *      先决边无环);
 *   2. 门槛策略可满足(金标摘要已记录且相符、门槛取值合法、已记录的基线自身不低于门槛);
 *   3. 若给出 run 记录(`--run <path>`),按门槛判定它是否回退,失败按节点归因。
 *
 * 基线未记录时第三件事无从判定,脚本如实报告「回归层休眠」而不是静默通过——与
 * scripts/verify-self-evolve-eval.ts 对未落地的评估记录取同一姿态。
 *
 * 用法:
 *   tsx scripts/verify-patent-oas-gold.ts [--run <run.json>]
 *   tsx scripts/verify-patent-oas-gold.ts --accept <run.json>
 *   tsx scripts/verify-patent-oas-gold.ts --write
 */

import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import {
  GATE_FILE,
  PATENT_OAS_EXAMPLE_DIR,
  PROBLEM_SPACE_FILE,
  evaluateRun,
  formatVerdict,
  goldDigest,
  loadGateConfig,
  loadGold,
  loadProblemSpace,
  loadRunRecord,
  validateGateConfig,
  validateProblemSpace,
  validateRunRecord,
  verdictPassed,
  type GoldCase,
  type RunRecord,
} from './patent-oas-gate-core.ts'

const root = resolve(import.meta.dirname, '..')
const exampleDir = resolve(root, PATENT_OAS_EXAMPLE_DIR)
const gatePath = resolve(root, GATE_FILE)
const problemSpacePath = resolve(root, PROBLEM_SPACE_FILE)

/**
 * 用当前金标重录 gate.yaml 的 goldDigest 行,保留文件其余内容与注释。
 *
 * @param cases 当前金标 case 集。
 */
async function writeGoldDigest(cases: readonly GoldCase[]): Promise<void> {
  const digest = goldDigest(cases)
  const text = await readFile(gatePath, 'utf8')
  if (!/^goldDigest:/mu.test(text)) throw new Error(`${GATE_FILE}: 没有 goldDigest 行可重录`)
  await writeFile(gatePath, text.replace(/^goldDigest:.*$/mu, `goldDigest: "${digest}"`), 'utf8')
  console.log(`verify-patent-oas-gold: 已重录 goldDigest ${digest}`)
}

/**
 * 读取基线记录;文件不存在表示尚未记录,不是错误。
 *
 * @param baselinePath 基线文件绝对路径。
 * @returns 基线记录,或 undefined。
 */
async function readBaseline(baselinePath: string): Promise<RunRecord | undefined> {
  try {
    return await loadRunRecord(baselinePath)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/**
 * 解析一个需要路径参数的命令行开关。
 *
 * @param args 命令行参数。
 * @param flag 开关名,如 `--run`。
 * @returns 记录内容与诊断标签;未给出该开关时返回 undefined。
 */
async function readRecordFlag(args: string[], flag: string): Promise<{ run: RunRecord; label: string; path: string } | undefined> {
  const index = args.indexOf(flag)
  if (index === -1) return undefined
  const value = args[index + 1]
  if (value === undefined) throw new Error(`${flag} 需要一个 run 记录路径`)
  const path = resolve(process.cwd(), value)
  return { run: await loadRunRecord(path), label: value, path }
}

/**
 * 把一次实测记录提升为基线:先校验维度与门槛,分数不达下限就拒绝落盘。
 *
 * 拒绝而不是照抄,是因为低于门槛的基线会让门禁此后永远红——那种门禁比没有门禁更糟。
 *
 * @param record 待提升的记录。
 * @param gold 金标 case 集。
 * @param space 问题空间 DAG。
 * @param config 门禁策略。
 * @param baselineTarget 基线目标绝对路径。
 */
async function acceptBaseline(
  record: { run: RunRecord; label: string; path: string },
  gold: readonly GoldCase[],
  space: Awaited<ReturnType<typeof loadProblemSpace>>,
  config: Awaited<ReturnType<typeof loadGateConfig>>,
  baselineTarget: string,
): Promise<void> {
  const problems = [
    ...validateProblemSpace(space, gold),
    ...validateGateConfig(config, space, gold, undefined, record.label),
    ...validateRunRecord(record.run, space, gold, record.label),
  ]
  const verdict = evaluateRun(space, config, record.run, undefined)
  for (const outcome of verdict.nodes) {
    if (outcome.verdict !== 'pass') problems.push(`${record.label}: 节点 "${outcome.id}" ${outcome.verdict}(分数 ${outcome.score})`)
  }
  for (const outcome of verdict.cases) {
    if (outcome.verdict !== 'pass') problems.push(`${record.label}: case "${outcome.id}" ${outcome.verdict}(分数 ${outcome.score})`)
  }
  if (verdict.aggregateVerdict !== 'pass') {
    problems.push(`${record.label}: 聚合判定 ${verdict.aggregateVerdict}(分数 ${verdict.aggregateScore})`)
  }
  if (problems.length > 0) {
    for (const problem of problems) console.error(`verify-patent-oas-gold: ${problem}`)
    throw new Error(`拒绝把 ${record.label} 提升为基线`)
  }
  await mkdir(dirname(baselineTarget), { recursive: true })
  await copyFile(record.path, baselineTarget)
  console.log(`verify-patent-oas-gold: 已把 ${record.label} 落为基线(${config.baselinePath},聚合 ${verdict.aggregateScore.toFixed(2)})`)
}

async function main(args: string[]): Promise<number> {
  const gold = await loadGold(exampleDir)
  const space = await loadProblemSpace(problemSpacePath)
  const config = await loadGateConfig(gatePath)
  const baselineTarget = resolve(root, config.baselinePath)

  if (args.includes('--write')) {
    await writeGoldDigest(gold)
    return 0
  }

  const accepted = await readRecordFlag(args, '--accept')
  if (accepted !== undefined) {
    await acceptBaseline(accepted, gold, space, config, baselineTarget)
    return 0
  }

  const flaggedRun = await readRecordFlag(args, '--run')
  const baseline = await readBaseline(baselineTarget)
  const problems = [
    ...validateProblemSpace(space, gold),
    ...validateGateConfig(config, space, gold, baseline, config.baselinePath),
    ...flaggedRun === undefined ? [] : validateRunRecord(flaggedRun.run, space, gold, flaggedRun.label),
  ]
  if (problems.length > 0) {
    for (const problem of problems) console.error(`verify-patent-oas-gold: ${problem}`)
    return 1
  }

  const domains = new Map<string, number>()
  for (const node of Object.values(space.nodes)) domains.set(node.domain, (domains.get(node.domain) ?? 0) + 1)
  const domainSummary = [...domains].map(([domain, count]) => `${domain}:${count}`).join(' ')
  console.log(
    `verify-patent-oas-gold: DAG ${Object.keys(space.nodes).length} 节点 / ${gold.length} case(${domainSummary});node minScore=${config.thresholds.node.minScore} maxDrop=${config.thresholds.node.maxDrop},case minScore=${config.thresholds.case.minScore},aggregate minScore=${config.thresholds.aggregate.minScore}`,
  )
  if (baseline === undefined) {
    console.log(`verify-patent-oas-gold: 基线未记录(${config.baselinePath});回归层休眠——记录一次实测后本门禁才比对分数。`)
  } else {
    console.log(`verify-patent-oas-gold: 基线已记录 ${baseline.recordedAt};基线自身满足门槛。`)
  }
  if (flaggedRun !== undefined) {
    const verdict = evaluateRun(space, config, flaggedRun.run, baseline)
    console.log(formatVerdict(verdict))
    if (!verdictPassed(verdict)) {
      console.error(`verify-patent-oas-gold: ${flaggedRun.label} 未通过门槛`)
      return 1
    }
  }
  return 0
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(`verify-patent-oas-gold: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  })
}
